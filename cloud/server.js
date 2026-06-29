#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const APP_DIR = __dirname;
loadEnv(path.join(APP_DIR, '.env'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLOUD_ROOT = process.env.CLOUD_HIDDENROOM_ROOT || process.env.CLOUD_ROOT;
const PORT = Number(process.env.CLOUD_PORT || process.env.PORT || 3001);
const MAX_UPLOAD_BYTES = Number(process.env.CLOUD_MAX_UPLOAD_BYTES || 100 * 1024 * 1024);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CLOUD_ROOT) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or CLOUD_HIDDENROOM_ROOT/CLOUD_ROOT');
  process.exit(1);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}
function sendJson(res, status, body) { send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8' }); }
function fail(res, status, message) { sendJson(res, status, { success: false, error: message }); }

function normalizeCloudPath(input) {
  if (!input || input === '/') return '/';
  let normalized = String(input).replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function resolveCloudPath(requestPath) {
  const normalized = normalizeCloudPath(requestPath);
  const root = path.resolve(CLOUD_ROOT);
  const resolved = path.resolve(root, `.${normalized}`);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Ruta no permitida.');
  return { normalized, resolved, root };
}

function safeChildName(raw) {
  const name = String(raw || '').trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Nombre no permitido.');
  return name;
}

function resolveChild(parentPath, rawName) {
  const name = safeChildName(rawName);
  const parent = path.resolve(parentPath);
  const child = path.resolve(parent, name);
  if (path.dirname(child) !== parent) throw new Error('Ruta no permitida.');
  return { name, child };
}

function parseRoles(rawRoles) {
  return String(rawRoles || '').split(',').map((role) => role.trim().toLowerCase()).filter(Boolean);
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function supabaseFetch(pathname, options = {}) {
  const url = new URL(pathname, SUPABASE_URL);
  const res = await fetch(url, options);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.msg || body?.message || body?.error_description || body?.error || `Supabase ${res.status}`);
  return body;
}

async function requireAdmin(req) {
  const token = getBearerToken(req);
  if (!token) { const err = new Error('Sesion requerida.'); err.status = 401; throw err; }

  const userData = await supabaseFetch('/auth/v1/user', {
    headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE_KEY },
  });
  const userId = userData?.id;
  if (!userId) { const err = new Error('Sesion invalida.'); err.status = 401; throw err; }

  const profile = await supabaseFetch(`/rest/v1/users?select=roles&id=eq.${encodeURIComponent(userId)}&limit=1`, {
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY, Accept: 'application/json' },
  });
  const roles = parseRoles(profile?.[0]?.roles);
  if (!roles.includes('admin')) { const err = new Error('No autorizado para MysAuth Cloud.'); err.status = 403; throw err; }
  return { id: userId, roles };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Payload demasiado grande.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readUpload(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) { const err = new Error('Archivo demasiado grande.'); err.status = 413; throw err; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function listFiles(res, url) {
  const { normalized, resolved } = resolveCloudPath(url.searchParams.get('path'));
  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  const folders = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(resolved, entry.name);
    const stats = await fsp.stat(fullPath);
    if (entry.isDirectory()) {
      folders.push({ name: entry.name, modified: stats.mtime.toISOString() });
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({ name: entry.name, size: stats.size, modified: stats.mtime.toISOString() });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  sendJson(res, 200, { success: true, path: normalized, folders, files });
}

async function createFolder(req, res) {
  const body = await readJson(req);
  const { resolved } = resolveCloudPath(body.path);
  const { name, child } = resolveChild(resolved, body.name);
  await fsp.mkdir(child, { recursive: false });
  sendJson(res, 201, { success: true, name });
}

async function uploadFile(req, res, url) {
  const { resolved } = resolveCloudPath(url.searchParams.get('path'));
  const { name, child } = resolveChild(resolved, decodeURIComponent(String(req.headers['x-file-name'] || '')));
  await fsp.mkdir(resolved, { recursive: true });
  const buffer = await readUpload(req);
  await fsp.writeFile(child, buffer, { flag: 'wx' });
  const stats = await fsp.stat(child);
  sendJson(res, 201, { success: true, file: { name, size: stats.size, modified: stats.mtime.toISOString() } });
}

async function renameItem(req, res) {
  const body = await readJson(req);
  const { resolved } = resolveCloudPath(body.path);
  const { name, child: from } = resolveChild(resolved, body.name);
  const { name: newName, child: to } = resolveChild(resolved, body.newName);
  const itemType = String(body.type || '').toLowerCase();
  const stats = await fsp.stat(from);
  if (itemType === 'folder' && !stats.isDirectory()) throw new Error('El origen no es carpeta.');
  if (itemType === 'file' && !stats.isFile()) throw new Error('El origen no es archivo.');
  await fsp.access(to).then(() => { throw new Error('Ya existe un elemento con ese nombre.'); }).catch((err) => { if (err && err.code !== 'ENOENT') throw err; });
  await fsp.rename(from, to);
  sendJson(res, 200, { success: true, name, newName });
}

async function deleteItem(res, url) {
  const { resolved } = resolveCloudPath(url.searchParams.get('path'));
  const itemType = String(url.searchParams.get('type') || '').toLowerCase();
  const { name, child } = resolveChild(resolved, url.searchParams.get('name'));
  const stats = await fsp.stat(child);
  if (itemType === 'folder') {
    if (!stats.isDirectory()) throw new Error('El elemento no es carpeta.');
    await fsp.rm(child, { recursive: true, force: false });
  } else if (itemType === 'file') {
    if (!stats.isFile()) throw new Error('El elemento no es archivo.');
    await fsp.rm(child, { force: false });
  } else {
    throw new Error('Tipo no permitido.');
  }
  sendJson(res, 200, { success: true, type: itemType, name });
}

async function downloadFile(res, url) {
  const { resolved } = resolveCloudPath(url.searchParams.get('path'));
  const { name, child } = resolveChild(resolved, url.searchParams.get('name'));
  const stats = await fsp.stat(child);
  if (!stats.isFile()) throw new Error('El elemento no es archivo.');
  const encoded = encodeURIComponent(name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': stats.size,
    'Content-Disposition': `attachment; filename="${name.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(child).pipe(res);
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(APP_DIR, 'public', `.${pathname}`);
  const publicRoot = path.resolve(APP_DIR, 'public');
  const relative = path.relative(publicRoot, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return fail(res, 404, 'No encontrado.');
  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile()) return fail(res, 404, 'No encontrado.');
    send(res, 200, await fsp.readFile(filePath), {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': pathname === '/index.html' ? 'no-store' : 'public, max-age=300',
    });
  } catch {
    send(res, 200, await fsp.readFile(path.join(APP_DIR, 'public', 'index.html')), {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'mysauth-cloud' });
    if (url.pathname.startsWith('/api/')) {
      await requireAdmin(req);
      if (req.method === 'GET' && url.pathname === '/api/files') return listFiles(res, url);
      if (req.method === 'POST' && url.pathname === '/api/folders') return createFolder(req, res);
      if (req.method === 'POST' && url.pathname === '/api/upload') return uploadFile(req, res, url);
      if (req.method === 'POST' && url.pathname === '/api/rename') return renameItem(req, res);
      if (req.method === 'DELETE' && url.pathname === '/api/item') return deleteItem(res, url);
      if (req.method === 'GET' && url.pathname === '/api/download') return downloadFile(res, url);
      return fail(res, 404, 'Ruta API no encontrada.');
    }
    return serveStatic(req, res, url);
  } catch (err) {
    const status = Number(err.status || 500);
    fail(res, status >= 400 && status < 600 ? status : 500, err.message || 'Error interno.');
  }
}

http.createServer(route).listen(PORT, '0.0.0.0', () => {
  console.log(`MysAuth Cloud listening on ${PORT}`);
  console.log(`Cloud root: ${path.resolve(CLOUD_ROOT)}`);
});
