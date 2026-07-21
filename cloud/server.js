#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { URL } = require('url');
const sharp = require('sharp');

const APP_DIR = __dirname;
loadEnv(path.join(APP_DIR, '.env'));
sharp.cache(false);
sharp.concurrency(Number(process.env.SHARP_CONCURRENCY || 1));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLOUD_ROOT = process.env.CLOUD_HIDDENROOM_ROOT || process.env.CLOUD_ROOT;
const PORT = Number(process.env.CLOUD_PORT || process.env.PORT || 3001);
const MAX_UPLOAD_BYTES = Number(process.env.CLOUD_MAX_UPLOAD_BYTES || 100 * 1024 * 1024);
const FFMPEG_PATH = process.env.FFMPEG_PATH || resolveFfmpegStaticPath() || 'ffmpeg';
const BEAT_PREVIEW_MAX_UPLOAD_BYTES = Number(process.env.BEAT_PREVIEW_MAX_UPLOAD_BYTES || MAX_UPLOAD_BYTES);
const BEAT_COVER_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const BEAT_COVER_MAX_DIMENSION = 8000;
const BEAT_COVER_MAIN_SIZE = 1200;
const BEAT_COVER_THUMB_SIZE = 300;
const SERVER_STATUS_INTERVAL_MS = Number(process.env.SERVER_STATUS_INTERVAL_MS || 20_000);
const SERVER_STATUS_HISTORY_LIMIT = Number(process.env.SERVER_STATUS_HISTORY_LIMIT || 50);
const SERVER_STATUS_TABLE = process.env.SERVER_STATUS_TABLE || 'server_status_history';
const SERVER_STATUS_DISK_PATH = process.env.SERVER_STATUS_DISK_PATH || CLOUD_ROOT || '/';
const CLOUD_UPLOAD_PERMISSION = 'cloud.upload';
const DOWNLOAD_TOKEN_TTL_MS = Number(process.env.CLOUD_DOWNLOAD_TOKEN_TTL_MS || 2 * 60 * 1000);
const BEAT_PERMISSION_KEYS = ['beat.store', 'beats.store', 'store.beats', 'store.beat', 'beat_store', 'beats', 'Beat Store', 'module.beats', 'module.beat-store'];
const BEAT_STORE_DIR = 'beats_store';
const BEAT_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.aac', '.aif', '.aiff']);
const BEAT_PREVIEW_AUDIO_EXTENSIONS = new Set(['.mp3']);
const BEAT_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const BEAT_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const PUBLIC_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Range, Content-Type, X-Beat-Product-Id, X-Beat-Slug, X-Beat-Crop, X-File-Name',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Disposition',
};
const API_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
};
let lastCpuSnapshot = null;
let latestServerStatus = null;
let serverStatusHistory = [];
let serverStatusPersisting = false;

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

function resolveFfmpegStaticPath() {
  try { return require('ffmpeg-static'); } catch { return ''; }
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
function sendJson(res, status, body) { send(res, status, JSON.stringify(body), { ...API_CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }); }
function sendPublicJson(res, status, body) { send(res, status, JSON.stringify(body), { ...PUBLIC_CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }); }
function fail(res, status, message) { sendJson(res, status, { success: false, error: message }); }
function failPublic(res, status, message) { sendPublicJson(res, status, { success: false, error: message }); }

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function signDownloadPayload(payload) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', SERVICE_ROLE_KEY).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyDownloadToken(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) throw new Error('Enlace de descarga invalido.');
  const expected = crypto.createHmac('sha256', SERVICE_ROLE_KEY).update(body).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) throw new Error('Enlace de descarga invalido.');
  const payload = JSON.parse(base64UrlDecode(body));
  if (!payload.exp || Date.now() > Number(payload.exp)) throw new Error('El enlace de descarga expiro.');
  return payload;
}

function streamFile(req, res, filePath, stats, headers = {}) {
  const range = req.headers.range;
  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    ...headers,
  };

  function pipeReadStream(options = {}) {
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath, options);
    stream.on('error', (err) => {
      console.error('File stream failed:', err.message || err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'No se pudo leer el archivo.' }));
        return;
      }
      res.destroy(err);
    });
    return stream.pipe(res);
  }

  if (range) {
    const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stats.size}` });
      return res.end();
    }
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stats.size - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(stats.size - suffix, 0);
      end = stats.size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
      res.writeHead(416, { ...baseHeaders, 'Content-Range': `bytes */${stats.size}` });
      return res.end();
    }
    end = Math.min(end, stats.size - 1);
    res.writeHead(206, { ...baseHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stats.size}` });
    return pipeReadStream({ start, end });
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': stats.size });
  return pipeReadStream();
}

function normalizeCloudPath(input) {
  if (!input || input === '/') return '/';
  let normalized = String(input).replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized.startsWith('/../') || normalized === '/..') throw new Error('Ruta no permitida.');
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  if (normalized.split('/').some((part) => part === '..')) throw new Error('Ruta no permitida.');
  return normalized;
}

function safeChildName(raw) {
  const name = String(raw || '').trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Nombre no permitido.');
  return name;
}

function parseRoles(rawRoles) {
  return String(rawRoles || '').split(',').map((role) => role.trim().toLowerCase()).filter(Boolean);
}

function isAdminRole(roles) {
  return roles.includes('admin');
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function supabaseHeaders() {
  return { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY, Accept: 'application/json' };
}

async function supabaseFetch(pathname, options = {}) {
  const url = new URL(pathname, SUPABASE_URL);
  const res = await fetch(url, options);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.msg || body?.message || body?.error_description || body?.error || `Supabase ${res.status}`);
  return body;
}

function slugifyUsername(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[-._]{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || fallback;
}

function permissionsInclude(permissions, keys) {
  const normalized = new Set(permissions.map((permission) => String(permission).toLowerCase()));
  return keys.some((key) => normalized.has(String(key).toLowerCase()));
}

async function fetchPermissions(userId) {
  const rows = await supabaseFetch(`/rest/v1/user_permissions?select=permission_key&user_id=eq.${encodeURIComponent(userId)}`, {
    headers: supabaseHeaders(),
  }).catch((err) => {
    console.error('Permissions lookup failed:', err.message || err);
    return [];
  });
  return Array.isArray(rows) ? rows.map((row) => row.permission_key).filter(Boolean) : [];
}

async function hasBeatStoreDownload(userId) {
  const downloads = await supabaseFetch(`/rest/v1/store_downloads?select=product_id&user_id=eq.${encodeURIComponent(userId)}&available=eq.true&limit=50`, {
    headers: supabaseHeaders(),
  }).catch(() => []);
  const productIds = [...new Set((Array.isArray(downloads) ? downloads : []).map((row) => row.product_id).filter(Boolean))];
  if (!productIds.length) return false;
  const ids = productIds.map((id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '')).filter(Boolean).join(',');
  const products = await supabaseFetch(`/rest/v1/store_products?select=id&id=in.(${ids})&category=eq.beats&limit=1`, {
    headers: supabaseHeaders(),
  }).catch(() => []);
  return Array.isArray(products) && products.length > 0;
}

async function requireCloudUser(req) {
  const token = getBearerToken(req);
  if (!token) { const err = new Error('Sesión requerida.'); err.status = 401; throw err; }

  const userData = await supabaseFetch('/auth/v1/user', {
    headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE_KEY, Accept: 'application/json' },
  });
  const userId = userData?.id;
  if (!userId) { const err = new Error('Sesión inválida.'); err.status = 401; throw err; }

  const encodedUserId = encodeURIComponent(userId);
  const profiles = await supabaseFetch(`/rest/v1/users?select=id,user_id,username,display_name,email,roles&or=(id.eq.${encodedUserId},user_id.eq.${encodedUserId})&limit=1`, {
    headers: supabaseHeaders(),
  });
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile) { const err = new Error('Perfil no encontrado.'); err.status = 403; throw err; }

  const roles = parseRoles(profile.roles);
  const permissions = await fetchPermissions(userId);
  const isAdmin = isAdminRole(roles);
  const hasBeatStore = isAdmin || permissionsInclude(permissions, BEAT_PERMISSION_KEYS) || await hasBeatStoreDownload(userId);
  const user = {
    id: userId,
    profile,
    roles,
    permissions,
    isAdmin,
    canUpload: isAdmin || permissionsInclude(permissions, [CLOUD_UPLOAD_PERMISSION]),
    hasBeatStore,
  };

  if (!isAdmin) await ensureUserCloudFolder(user);
  return user;
}

function getUserCloudRoot(user) {
  const label = user.profile?.username || user.profile?.display_name || user.profile?.email || user.id;
  const slug = slugifyUsername(label, 'user');
  return path.join(path.resolve(CLOUD_ROOT), 'users', `${user.id}__${slug}`);
}

async function ensureUserCloudFolder(user) {
  const userRoot = getUserCloudRoot(user);
  const folders = ['uploads', 'downloads', 'private'];
  if (user.hasBeatStore) folders.push('beats');
  await fsp.mkdir(userRoot, { recursive: true });
  await Promise.all(folders.map((folder) => fsp.mkdir(path.join(userRoot, folder), { recursive: true })));
  return userRoot;
}

function getCloudBaseRoot(user) {
  return user.isAdmin ? path.resolve(CLOUD_ROOT) : getUserCloudRoot(user);
}

function getPublicPath(user, normalizedPath) {
  return normalizedPath;
}

async function getRealRoot(baseRoot) {
  await fsp.mkdir(baseRoot, { recursive: true });
  return fsp.realpath(baseRoot);
}

function assertInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Ruta no permitida.');
}

async function resolveSafePath(baseRoot, requestedPath, options = {}) {
  const normalized = normalizeCloudPath(requestedPath);
  const realRoot = await getRealRoot(baseRoot);
  const candidate = path.resolve(realRoot, `.${normalized}`);
  assertInsideRoot(realRoot, candidate);

  if (options.mustExist === false) {
    const parentReal = await fsp.realpath(path.dirname(candidate));
    assertInsideRoot(realRoot, parentReal);
    return { normalized, resolved: candidate, root: realRoot };
  }

  const realCandidate = await fsp.realpath(candidate);
  assertInsideRoot(realRoot, realCandidate);
  return { normalized, resolved: realCandidate, root: realRoot };
}

async function resolveSafeChild(baseRoot, requestedPath, rawName, options = {}) {
  const parent = await resolveSafePath(baseRoot, requestedPath, { mustExist: true });
  const name = safeChildName(rawName);
  const child = path.resolve(parent.resolved, name);
  if (path.dirname(child) !== parent.resolved) throw new Error('Ruta no permitida.');
  assertInsideRoot(parent.root, child);

  if (options.mustExist === false) {
    return { ...parent, name, child };
  }

  const realChild = await fsp.realpath(child);
  assertInsideRoot(parent.root, realChild);
  return { ...parent, name, child };
}

async function resolveDownloadChild(user, baseRoot, requestedPath, rawName) {
  try {
    return await resolveSafeChild(baseRoot, requestedPath, rawName, { mustExist: true });
  } catch (err) {
    const normalizedPath = normalizeCloudPath(requestedPath);
    const name = safeChildName(rawName);
    const canSearchLegacyUserDownloads = user.isAdmin && /^\/users\/[^/]+\/downloads$/i.test(normalizedPath);
    if (!canSearchLegacyUserDownloads) throw err;

    const root = await getRealRoot(baseRoot);
    const usersRoot = path.resolve(root, 'users');
    assertInsideRoot(root, usersRoot);
    const entries = await fsp.readdir(usersRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.resolve(usersRoot, entry.name, 'downloads', name);
      assertInsideRoot(root, candidate);
      const stats = await fsp.stat(candidate).catch(() => null);
      if (!stats?.isFile()) continue;
      const realChild = await fsp.realpath(candidate);
      assertInsideRoot(root, realChild);
      return { normalized: '/users/' + entry.name + '/downloads', resolved: path.dirname(realChild), root, name, child: realChild };
    }

    const notFound = new Error('Archivo no encontrado en Cloud. Vuelve a subirlo o corrige la ruta en BB.DD > descargas.');
    notFound.status = 404;
    throw notFound;
  }
}
function requireUploadPermission(user) {
  if (!user.canUpload) { const err = new Error('No tienes permiso cloud.upload.'); err.status = 403; throw err; }
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
async function readLimitedUploadToTemp(req, limitBytes) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hr-beat-cover-'));
  const tempPath = path.join(tempDir, 'upload.bin');
  let size = 0;
  const out = fs.createWriteStream(tempPath, { flags: 'wx' });
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limitBytes) {
        const err = new Error('La imagen supera el límite de 12 MB');
        err.status = 413;
        throw err;
      }
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
    }
    await new Promise((resolve, reject) => out.end((err) => err ? reject(err) : resolve()));
    return { tempDir, tempPath, size };
  } catch (err) {
    out.destroy();
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
async function readLimitedUploadToTempNamed(req, limitBytes, prefix) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  const tempPath = path.join(tempDir, 'upload.bin');
  let size = 0;
  const out = fs.createWriteStream(tempPath, { flags: 'wx' });
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limitBytes) {
        const err = new Error('El audio supera el limite permitido.');
        err.status = 413;
        throw err;
      }
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
    }
    await new Promise((resolve, reject) => out.end((err) => err ? reject(err) : resolve()));
    return { tempDir, tempPath, size };
  } catch (err) {
    out.destroy();
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

function parseBeatCoverCrop(raw) {
  if (!raw) return null;
  let crop;
  try { crop = JSON.parse(String(raw)); } catch { return null; }
  const x = Number(crop?.x);
  const y = Number(crop?.y);
  const size = Number(crop?.size);
  if (![x, y, size].every(Number.isFinite) || size <= 0) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), size: Math.max(0.05, Math.min(1, size)) };
}

function beatCoverProductId(req) {
  const raw = String(req.headers['x-beat-product-id'] || '').trim();
  if (!raw) return '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    const err = new Error('Beat invalido.');
    err.status = 400;
    throw err;
  }
  return raw;
}

async function fetchBeatProduct(productId) {
  if (!productId) return null;
  const rows = await supabaseFetch(`/rest/v1/store_products?select=id,category,image_url,beat_cover_path,beat_thumb_path&id=eq.${encodeURIComponent(productId)}&limit=1`, { headers: supabaseHeaders() });
  return Array.isArray(rows) ? rows[0] : null;
}

async function assertCanMutateBeatCover(user, productId) {
  if (!user.isAdmin) {
    const err = new Error('Solo admin puede actualizar portadas de beats.');
    err.status = 403;
    throw err;
  }
  const product = await fetchBeatProduct(productId);
  if (productId && (!product || product.category !== 'beats')) {
    const err = new Error('Beat no encontrado.');
    err.status = 404;
    throw err;
  }
  return product;
}

function coverPathIsManaged(value) {
  return /^covers\/[0-9a-f-]{36}\/(cover|thumb)\.webp$/i.test(String(value || ''));
}

async function removeManagedBeatCover(product) {
  if (!product) return;
  const root = await fsp.realpath(beatStoreRoot());
  for (const value of [product.image_url, product.beat_cover_path, product.beat_thumb_path]) {
    if (!coverPathIsManaged(value)) continue;
    const target = path.resolve(root, value);
    assertInsideRoot(root, target);
    await fsp.rm(target, { force: true }).catch(() => {});
  }
}

function sharpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function writeBeatCoverImages(tempPath, crop, outputDir) {
  let meta;
  try {
    meta = await sharp(tempPath, { animated: true, limitInputPixels: BEAT_COVER_MAX_DIMENSION * BEAT_COVER_MAX_DIMENSION }).metadata();
  } catch {
    throw sharpError('La portada debe ser una imagen válida');
  }
  if (!meta?.width || !meta?.height) throw sharpError('La portada debe ser una imagen válida');
  if (meta.format === 'svg') throw sharpError('Formato de imagen no permitido');
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) throw sharpError('Formato de imagen no permitido');
  if ((meta.pages || 1) > 1) throw sharpError('Formato de imagen no permitido');
  if (meta.width > BEAT_COVER_MAX_DIMENSION || meta.height > BEAT_COVER_MAX_DIMENSION) throw sharpError('La imagen tiene dimensiones demasiado grandes', 413);

  const squareMax = Math.min(meta.width, meta.height);
  const cropSize = crop ? Math.min(squareMax, Math.max(1, Math.round(crop.size * squareMax))) : squareMax;
  const maxLeft = Math.max(0, meta.width - cropSize);
  const maxTop = Math.max(0, meta.height - cropSize);
  const left = crop ? Math.max(0, Math.min(maxLeft, Math.round(crop.x * maxLeft))) : Math.round((meta.width - cropSize) / 2);
  const top = crop ? Math.max(0, Math.min(maxTop, Math.round(crop.y * maxTop))) : Math.round((meta.height - cropSize) / 2);
  const extract = { left, top, width: cropSize, height: cropSize };
  const inputOptions = { limitInputPixels: BEAT_COVER_MAX_DIMENSION * BEAT_COVER_MAX_DIMENSION };

  await sharp(tempPath, inputOptions)
    .rotate()
    .extract(extract)
    .resize(BEAT_COVER_MAIN_SIZE, BEAT_COVER_MAIN_SIZE, { fit: 'cover' })
    .webp({ quality: 84 })
    .toFile(path.join(outputDir, 'cover.webp'));
  await sharp(tempPath, inputOptions)
    .rotate()
    .extract(extract)
    .resize(BEAT_COVER_THUMB_SIZE, BEAT_COVER_THUMB_SIZE, { fit: 'cover' })
    .webp({ quality: 78 })
    .toFile(path.join(outputDir, 'thumb.webp'));
}
let activeBeatCoverProcesses = 0;
const MAX_ACTIVE_BEAT_COVER_PROCESSES = Number(process.env.BEAT_COVER_MAX_CONCURRENCY || 2);

async function uploadBeatCover(user, req, res) {
  if (activeBeatCoverProcesses >= MAX_ACTIVE_BEAT_COVER_PROCESSES) {
    const err = new Error('El procesador de portadas está ocupado. Intenta de nuevo en unos segundos.');
    err.status = 429;
    throw err;
  }
  activeBeatCoverProcesses += 1;
  let temp;
  let outputDir = '';
  try {
    const productId = beatCoverProductId(req);
    const product = await assertCanMutateBeatCover(user, productId);
    const crop = parseBeatCoverCrop(req.headers['x-beat-crop']);
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > BEAT_COVER_MAX_UPLOAD_BYTES) throw sharpError('La imagen supera el límite de 12 MB', 413);
    temp = await readLimitedUploadToTemp(req, BEAT_COVER_MAX_UPLOAD_BYTES);
    if (!temp.size) throw sharpError('La portada debe ser una imagen válida');
    const coverId = crypto.randomUUID();
    const root = await getRealRoot(beatStoreRoot());
    outputDir = path.resolve(root, 'covers', coverId);
    assertInsideRoot(root, outputDir);
    await fsp.mkdir(outputDir, { recursive: false });
    await writeBeatCoverImages(temp.tempPath, crop, outputDir);
    const coverPath = `covers/${coverId}/cover.webp`;
    const thumbPath = `covers/${coverId}/thumb.webp`;
    if (productId) {
      await supabaseFetch(`/rest/v1/store_products?id=eq.${encodeURIComponent(productId)}`, {
        method: 'PATCH',
        headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ image_url: coverPath, beat_cover_path: coverPath, beat_thumb_path: thumbPath }),
      });
      await removeManagedBeatCover(product);
    }
    sendJson(res, 201, { success: true, image_url: coverPath, beat_cover_path: coverPath, beat_thumb_path: thumbPath });
  } catch (err) {
    if (outputDir) await fsp.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    if (err.message && /Input image exceeds pixel limit|unsupported image format|corrupt|invalid/i.test(err.message)) throw sharpError('No se pudo procesar la imagen');
    throw err;
  } finally {
    activeBeatCoverProcesses = Math.max(0, activeBeatCoverProcesses - 1);
    if (temp?.tempDir) await fsp.rm(temp.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function safeBeatSlug(rawSlug, fallback) {
  const slug = String(rawSlug || fallback || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!slug) {
    const err = new Error('Slug de beat requerido.');
    err.status = 400;
    throw err;
  }
  return slug;
}
function safeBeatUploadName(rawName) {
  const decoded = decodeURIComponent(String(rawName || 'beat').trim());
  const ext = path.extname(decoded).toLowerCase();
  if (!BEAT_AUDIO_EXTENSIONS.has(ext)) {
    const err = new Error('Formato de audio no permitido.');
    err.status = 400;
    throw err;
  }
  const base = path.basename(decoded, ext)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/[-._]{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'beat';
  return { base, ext };
}

function beatManagedPath(kind, id, name) {
  return `${kind}/${id}/${name}`;
}

async function moveUploadIntoPlace(fromPath, toPath) {
  await fsp.rm(toPath, { force: true }).catch(() => {});
  try {
    await fsp.rename(fromPath, toPath);
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err;
    await fsp.copyFile(fromPath, toPath);
    await fsp.unlink(fromPath);
  }
}
async function convertBeatPreview(inputPath, outputPath) {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const tempOutput = `${outputPath}.tmp-${process.pid}-${Date.now()}.mp3`;
  try {
    await new Promise((resolve, reject) => {
      execFile(FFMPEG_PATH, [
        '-y',
        '-i', inputPath,
        '-vn',
        '-ar', '44100',
        '-ac', '2',
        '-b:a', '160k',
        '-map_metadata', '-1',
        tempOutput,
      ], { timeout: Number(process.env.BEAT_PREVIEW_FFMPEG_TIMEOUT_MS || 180000) }, (error, stdout, stderr) => {
        if (error) {
          error.ffmpegStderr = String(stderr || '').slice(-2000);
          return reject(error);
        }
        resolve();
      });
    });
    await fsp.rename(tempOutput, outputPath);
  } catch (err) {
    await fsp.rm(tempOutput, { force: true }).catch(() => {});
    throw err;
  }
}

async function patchBeatProduct(productId, payload) {
  if (!productId) return;
  await supabaseFetch(`/rest/v1/store_products?id=eq.${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(payload),
  });
}

async function uploadBeatAudio(user, req, res) {
  if (!user.isAdmin) {
    const err = new Error('Solo admin puede subir beats.');
    err.status = 403;
    throw err;
  }
  const productId = beatCoverProductId(req);
  const sourceName = safeBeatUploadName(req.headers['x-file-name']);
  const beatSlug = safeBeatSlug(req.headers['x-beat-slug'], sourceName.base);
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > BEAT_PREVIEW_MAX_UPLOAD_BYTES) {
    const err = new Error('El audio supera el limite permitido.');
    err.status = 413;
    throw err;
  }

  let temp;
  const root = await getRealRoot(beatStoreRoot());
  const originalRelative = beatManagedPath('originals', beatSlug, `${beatSlug}${sourceName.ext}`);
  const previewRelative = beatManagedPath('previews', beatSlug, 'preview.mp3');
  const originalPath = path.resolve(root, originalRelative);
  const previewPath = path.resolve(root, previewRelative);
  assertInsideRoot(root, originalPath);
  assertInsideRoot(root, previewPath);

  try {
    temp = await readLimitedUploadToTempNamed(req, BEAT_PREVIEW_MAX_UPLOAD_BYTES, 'hr-beat-audio-');
    if (!temp.size) {
      const err = new Error('Selecciona un archivo de audio valido.');
      err.status = 400;
      throw err;
    }
    await fsp.mkdir(path.dirname(originalPath), { recursive: true });
    await moveUploadIntoPlace(temp.tempPath, originalPath);
    temp.tempPath = '';
    await convertBeatPreview(originalPath, previewPath);
    await patchBeatProduct(productId, {
      file_url: `/${BEAT_STORE_DIR}/${originalRelative}`,
      beat_original_path: originalRelative,
      beat_preview_path: previewRelative,
      beat_preview_status: 'ready',
      beat_preview_error: null,
    });
    sendJson(res, 201, {
      success: true,
      file_url: `/${BEAT_STORE_DIR}/${originalRelative}`,
      beat_original_path: originalRelative,
      beat_preview_path: previewRelative,
      beat_preview_status: 'ready',
      preview_url: beatPublicPath(previewRelative),
    });
  } catch (err) {
    console.error('Beat preview conversion failed:', {
      original: originalRelative,
      ffmpegPath: FFMPEG_PATH,
      message: err.message || String(err),
      stderr: err.ffmpegStderr || '',
    });
    if (!err.status || err.status === 422) err.message = 'No se pudo generar el preview MP3. El original se conservo, pero el beat no se publico.';
    await patchBeatProduct(productId, {
      file_url: `/${BEAT_STORE_DIR}/${originalRelative}`,
      beat_original_path: originalRelative,
      beat_preview_path: null,
      beat_preview_status: 'error',
      beat_preview_error: 'No se pudo generar el preview MP3.',
      is_active: false,
    }).catch((patchErr) => console.error('Beat preview status patch failed:', patchErr.message || patchErr));
    err.status = err.status || 422;
    err.original_file_url = `/${BEAT_STORE_DIR}/${originalRelative}`;
    err.original_path = originalRelative;
    throw err;
  } finally {
    if (temp?.tempPath) await fsp.rm(temp.tempPath, { force: true }).catch(() => {});
    if (temp?.tempDir) await fsp.rm(temp.tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
function downloadTokenUser(payload) {
  return {
    id: payload.uid,
    profile: payload.profile || { id: payload.uid, user_id: payload.uid },
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    permissions: [],
    isAdmin: Boolean(payload.isAdmin),
    canUpload: false,
    hasBeatStore: false,
  };
}

function sessionPayload(user) {
  return {
    success: true,
    user: {
      id: user.id,
      username: user.profile?.username ?? null,
      display_name: user.profile?.display_name ?? null,
      roles: user.roles,
    },
    isAdmin: user.isAdmin,
    canUpload: user.canUpload,
    hasBeatStore: user.hasBeatStore,
    rootLabel: user.isAdmin ? 'Raíz Cloud' : 'Mi Cloud',
    homePath: '/',
  };
}

async function listFiles(user, res, url) {
  const baseRoot = getCloudBaseRoot(user);
  const { normalized, resolved } = await resolveSafePath(baseRoot, url.searchParams.get('path'), { mustExist: true });
  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  const folders = [];
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childPath = path.join(resolved, entry.name);
    let stats;
    try {
      stats = await fsp.stat(childPath);
      const realChild = await fsp.realpath(childPath);
      assertInsideRoot(await getRealRoot(baseRoot), realChild);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      folders.push({ name: entry.name, modified: stats.mtime.toISOString() });
      continue;
    }
    if (!stats.isFile()) continue;
    files.push({ name: entry.name, size: stats.size, modified: stats.mtime.toISOString() });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  sendJson(res, 200, { success: true, path: getPublicPath(user, normalized), folders, files, meta: sessionPayload(user) });
}

async function createFolder(user, req, res) {
  requireUploadPermission(user);
  const body = await readJson(req);
  const baseRoot = getCloudBaseRoot(user);
  const { name, child } = await resolveSafeChild(baseRoot, body.path, body.name, { mustExist: false });
  await fsp.mkdir(child, { recursive: false });
  sendJson(res, 201, { success: true, name });
}

async function uploadFile(user, req, res, url) {
  requireUploadPermission(user);
  const baseRoot = getCloudBaseRoot(user);
  const { name, child } = await resolveSafeChild(baseRoot, url.searchParams.get('path'), decodeURIComponent(String(req.headers['x-file-name'] || '')), { mustExist: false });
  await fsp.mkdir(path.dirname(child), { recursive: true });
  const buffer = await readUpload(req);
  await fsp.writeFile(child, buffer, { flag: 'wx' });
  const stats = await fsp.stat(child);
  sendJson(res, 201, { success: true, file: { name, size: stats.size, modified: stats.mtime.toISOString() } });
}

async function renameItem(user, req, res) {
  requireUploadPermission(user);
  const body = await readJson(req);
  const baseRoot = getCloudBaseRoot(user);
  const fromInfo = await resolveSafeChild(baseRoot, body.path, body.name, { mustExist: true });
  const toInfo = await resolveSafeChild(baseRoot, body.path, body.newName, { mustExist: false });
  const itemType = String(body.type || '').toLowerCase();
  const stats = await fsp.stat(fromInfo.child);
  if (itemType === 'folder' && !stats.isDirectory()) throw new Error('El origen no es carpeta.');
  if (itemType === 'file' && !stats.isFile()) throw new Error('El origen no es archivo.');
  await fsp.access(toInfo.child).then(() => { throw new Error('Ya existe un elemento con ese nombre.'); }).catch((err) => { if (err && err.code !== 'ENOENT') throw err; });
  await fsp.rename(fromInfo.child, toInfo.child);
  sendJson(res, 200, { success: true, name: fromInfo.name, newName: toInfo.name });
}

async function deleteItem(user, res, url) {
  requireUploadPermission(user);
  const baseRoot = getCloudBaseRoot(user);
  const itemType = String(url.searchParams.get('type') || '').toLowerCase();
  const { name, child } = await resolveSafeChild(baseRoot, url.searchParams.get('path'), url.searchParams.get('name'), { mustExist: true });
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


function beatStoreRoot() {
  return path.join(path.resolve(CLOUD_ROOT), BEAT_STORE_DIR);
}

function beatPublicPath(relativeFile) {
  return `/api/beat-store/stream?file=${encodeURIComponent(relativeFile)}`;
}

function titleFromBeatFile(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Beat';
}

function normalizeBeatRelativePath(rawFile, options = {}) {
  const file = String(rawFile || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!file || file.startsWith('/') || file.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Archivo no permitido.');
  if (/[\u0000-\u001f\u007f]/.test(file)) throw new Error('Archivo no permitido.');
  const ext = path.extname(file).toLowerCase();
  const allowed = options.allowImages ? (BEAT_AUDIO_EXTENSIONS.has(ext) || BEAT_IMAGE_EXTENSIONS.has(ext)) : BEAT_AUDIO_EXTENSIONS.has(ext);
  if (!allowed) throw new Error(options.allowImages ? 'Formato Beat Store no permitido.' : 'Formato de audio no permitido.');
  return file;
}

async function resolveBeatFile(rawFile) {
  const relativeFile = normalizeBeatRelativePath(rawFile, { allowImages: true });
  const root = beatStoreRoot();
  const realRoot = await fsp.realpath(root);
  const candidate = path.resolve(realRoot, relativeFile);
  assertInsideRoot(realRoot, candidate);
  const realCandidate = await fsp.realpath(candidate);
  assertInsideRoot(realRoot, realCandidate);
  const stats = await fsp.stat(realCandidate);
  if (!stats.isFile()) throw new Error('Beat no encontrado.');
  return { relativeFile, resolved: realCandidate, stats };
}

async function walkBeatFiles(currentDir, rootDir, depth = 0) {
  if (depth > 4) return [];
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(currentDir, entry.name);
    const relativeEntry = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (depth === 0 && ['originals', 'covers'].includes(entry.name)) continue;
      files.push(...await walkBeatFiles(fullPath, rootDir, depth + 1));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    const isPreview = relativeEntry.toLowerCase().startsWith('previews/');
    if (isPreview ? !BEAT_PREVIEW_AUDIO_EXTENSIONS.has(ext) : !BEAT_AUDIO_EXTENSIONS.has(ext)) continue;
    const stats = await fsp.stat(fullPath);
    const relativeFile = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    files.push({
      file: relativeFile,
      slug: slugifyUsername(path.basename(relativeFile, ext), 'beat'),
      title: titleFromBeatFile(relativeFile),
      size: stats.size,
      modified: stats.mtime.toISOString(),
      stream_url: beatPublicPath(relativeFile),
      mime: BEAT_MIME_TYPES[ext] || 'audio/mpeg',
    });
  }
  return files;
}

async function backfillBeatPreviews(user, res) {
  if (!user.isAdmin) {
    const err = new Error('Solo admin puede generar previews.');
    err.status = 403;
    throw err;
  }
  const root = await getRealRoot(beatStoreRoot());
  const candidates = (await walkBeatFiles(root, root))
    .map((beat) => beat.file)
    .filter((file) => !file.toLowerCase().startsWith('previews/'));
  const results = [];
  for (const relativeFile of candidates) {
    try {
      const source = await resolveBeatFile(relativeFile);
      const id = crypto.createHash('sha1').update(relativeFile).digest('hex').slice(0, 16);
      const previewRelative = beatManagedPath('previews', id, 'preview.mp3');
      const previewPath = path.resolve(root, previewRelative);
      assertInsideRoot(root, previewPath);
      const previewStats = await fsp.stat(previewPath).catch(() => null);
      if (!previewStats?.isFile()) await convertBeatPreview(source.resolved, previewPath);
      const variants = [relativeFile, `/${BEAT_STORE_DIR}/${relativeFile}`];
      for (const original of variants) {
        await supabaseFetch(`/rest/v1/store_products?category=eq.beats&file_url=eq.${encodeURIComponent(original)}`, {
          method: 'PATCH',
          headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            beat_original_path: relativeFile,
            beat_preview_path: previewRelative,
            beat_preview_status: 'ready',
            beat_preview_error: null,
          }),
        }).catch(() => {});
      }
      results.push({ file: relativeFile, preview: previewRelative, status: 'ready' });
    } catch (err) {
      results.push({ file: relativeFile, status: 'error', error: err.message || 'No se pudo convertir.' });
    }
  }
  sendJson(res, 200, { success: true, results });
}
async function listBeatStore(res) {
  const root = beatStoreRoot();
  try {
    const realRoot = await fsp.realpath(root);
    const beats = await walkBeatFiles(realRoot, realRoot);
    beats.sort((a, b) => b.modified.localeCompare(a.modified) || a.title.localeCompare(b.title));
    return sendPublicJson(res, 200, { success: true, root: BEAT_STORE_DIR, beats });
  } catch (err) {
    if (err && err.code === 'ENOENT') return sendPublicJson(res, 200, { success: true, root: BEAT_STORE_DIR, beats: [] });
    throw err;
  }
}

async function streamBeatFile(req, res, url) {
  const { relativeFile, resolved, stats } = await resolveBeatFile(url.searchParams.get('file'));
  const ext = path.extname(relativeFile).toLowerCase();
  const range = req.headers.range;
  const baseHeaders = {
    ...PUBLIC_CORS_HEADERS,
    'Content-Type': BEAT_MIME_TYPES[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  };

  if (range) {
    const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
    if (!match) return send(res, 416, '', { ...baseHeaders, 'Content-Range': `bytes */${stats.size}` });
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stats.size - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(stats.size - suffix, 0);
      end = stats.size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
      return send(res, 416, '', { ...baseHeaders, 'Content-Range': `bytes */${stats.size}` });
    }
    end = Math.min(end, stats.size - 1);
    res.writeHead(206, { ...baseHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stats.size}` });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(resolved, { start, end }).pipe(res);
  }

  res.writeHead(200, { ...baseHeaders, 'Content-Length': stats.size });
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(resolved).pipe(res);
}

function execFileText(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: options.timeout || 2500 }, (error, stdout) => {
      if (error) return reject(error);
      resolve(String(stdout || '').trim());
    });
  });
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${days} d ${hours} h ${minutes} m`;
}

function readCpuSnapshot() {
  const totals = os.cpus().map((cpu) => {
    const times = cpu.times;
    const idle = times.idle;
    const total = Object.values(times).reduce((sum, value) => sum + value, 0);
    return { idle, total };
  });
  const idle = totals.reduce((sum, item) => sum + item.idle, 0);
  const total = totals.reduce((sum, item) => sum + item.total, 0);
  return { idle, total };
}

function readCpuPercent() {
  const current = readCpuSnapshot();
  if (!lastCpuSnapshot) {
    lastCpuSnapshot = current;
    return null;
  }
  const idleDelta = current.idle - lastCpuSnapshot.idle;
  const totalDelta = current.total - lastCpuSnapshot.total;
  lastCpuSnapshot = current;
  if (totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

function findTemperaturesInObject(value, readings = []) {
  if (!value || typeof value !== 'object') return readings;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number' && /(^|_)temp\d*_input$|^temp\d+_input$/i.test(key)) {
      readings.push(child);
      continue;
    }
    if (child && typeof child === 'object') findTemperaturesInObject(child, readings);
  }
  return readings;
}

function parseSensorsText(output) {
  const preferred = [];
  const fallback = [];
  String(output || '').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^:]+):\s*\+?(-?\d+(?:\.\d+)?)\s*(?:°\s*)?C\b/i);
    if (!match) return;
    const label = match[1].toLowerCase();
    const value = Number(match[2]);
    if (!Number.isFinite(value)) return;
    if (/package|tctl|tdie|cpu|composite|temp1/.test(label)) preferred.push(value);
    else fallback.push(value);
  });
  const values = preferred.length ? preferred : fallback;
  return values.length ? Math.max(...values) : null;
}

async function readSysTemperature() {
  const root = '/sys/class/thermal';
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const readings = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('thermal_zone')) continue;
      const raw = await fsp.readFile(path.join(root, entry.name, 'temp'), 'utf8').catch(() => '');
      const value = Number(String(raw).trim());
      if (Number.isFinite(value)) readings.push(value > 1000 ? value / 1000 : value);
    }
    return readings.length ? Math.max(...readings) : null;
  } catch {
    return null;
  }
}

async function readTemperatureCelsius() {
  const rawEnvTemperature = String(process.env.SERVER_STATUS_TEMPERATURE || '').trim();
  const envTemperature = rawEnvTemperature ? Number(rawEnvTemperature.replace(/[^\d.-]/g, '')) : NaN;
  if (Number.isFinite(envTemperature)) return envTemperature;

  try {
    const sensorsJson = await execFileText('sensors', ['-j']);
    const readings = findTemperaturesInObject(JSON.parse(sensorsJson));
    if (readings.length) return Math.max(...readings);
  } catch {
    // Fall back to classic lm-sensors text output.
  }

  try {
    const sensorsText = await execFileText('sensors');
    const parsed = parseSensorsText(sensorsText);
    if (parsed !== null) return parsed;
  } catch {
    // Fall back to sysfs thermal zones.
  }

  return readSysTemperature();
}

async function readDiskUsage() {
  try {
    const output = await execFileText('df', ['-Pk', SERVER_STATUS_DISK_PATH || '/']);
    const lines = output.split(/\r?\n/).filter(Boolean);
    const parts = lines[1]?.trim().split(/\s+/) ?? [];
    const total = Number(parts[1]) * 1024;
    const used = Number(parts[2]) * 1024;
    const available = Number(parts[3]) * 1024;
    const percent = total > 0 ? (used / total) * 100 : null;
    return { total, used, available, percent };
  } catch {
    return null;
  }
}

async function readTailscaleIp() {
  try {
    const ip = await execFileText('tailscale', ['ip', '-4'], { timeout: 1500 });
    if (ip) return ip.split(/\s+/)[0];
  } catch {
    // hostname -I is enough as a fallback.
  }
  try {
    const ips = await execFileText('hostname', ['-I'], { timeout: 1500 });
    return ips.split(/\s+/).find((item) => item.startsWith('100.')) || ips.split(/\s+/).find(Boolean) || null;
  } catch {
    return null;
  }
}

function normalizeMetricSample(status) {
  return {
    at: status.checkedAt,
    cpu: status.cpuPercent,
    ram: status.memory?.percent ?? null,
    disk: status.diskUsage?.percent ?? null,
    temperature: status.temperatureCelsius,
  };
}

async function persistServerStatus(status) {
  if (serverStatusPersisting) return;
  serverStatusPersisting = true;
  try {
    const payload = {
      created_at: status.checkedAt,
      hostname: status.hostname,
      cpu_percent: status.cpuPercent,
      ram_percent: status.memory?.percent ?? null,
      disk_percent: status.diskUsage?.percent ?? null,
      temperature_celsius: status.temperatureCelsius,
      payload: status,
    };
    await supabaseFetch(`/rest/v1/${SERVER_STATUS_TABLE}`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });

    const oldRows = await supabaseFetch(`/rest/v1/${SERVER_STATUS_TABLE}?select=id&order=created_at.desc&offset=${SERVER_STATUS_HISTORY_LIMIT}`, {
      headers: supabaseHeaders(),
    }).catch(() => []);
    const oldIds = Array.isArray(oldRows) ? oldRows.map((row) => row.id).filter(Boolean) : [];
    if (oldIds.length) {
      await supabaseFetch(`/rest/v1/${SERVER_STATUS_TABLE}?id=in.(${oldIds.join(',')})`, {
        method: 'DELETE',
        headers: supabaseHeaders(),
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('Server status Supabase history skipped:', err.message || err);
  } finally {
    serverStatusPersisting = false;
  }
}

async function collectServerStatus({ persist = true } = {}) {
  const cpuPercent = readCpuPercent();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryPercent = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : null;
  const [diskUsage, temperatureCelsius, tailscaleIp] = await Promise.all([
    readDiskUsage(),
    readTemperatureCelsius(),
    readTailscaleIp(),
  ]);
  const checkedAt = new Date().toISOString();
  const status = {
    online: true,
    hostname: os.hostname(),
    tailscaleIp,
    uptime: formatUptime(os.uptime()),
    uptimeSeconds: Math.floor(os.uptime()),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    checkedAt,
    cpu: cpuPercent === null ? `${os.cpus().length} nucleos` : `${Math.round(cpuPercent)}% / ${os.cpus().length} nucleos`,
    cpuPercent,
    loadAverage: os.loadavg(),
    cores: os.cpus().length,
    ram: `${formatBytes(usedMemory)} / ${formatBytes(totalMemory)}`,
    memory: { total: totalMemory, used: usedMemory, free: freeMemory, percent: memoryPercent },
    memoryPercent,
    disk: diskUsage ? `${formatBytes(diskUsage.used)} / ${formatBytes(diskUsage.total)}` : null,
    diskUsage,
    diskPercent: diskUsage?.percent ?? null,
    temperature: temperatureCelsius === null ? 'Sin sensor' : `${temperatureCelsius.toFixed(1)} C`,
    temperatureCelsius,
  };

  serverStatusHistory = [...serverStatusHistory, normalizeMetricSample(status)].slice(-SERVER_STATUS_HISTORY_LIMIT);
  latestServerStatus = { ...status, samples: serverStatusHistory };
  if (persist) persistServerStatus(status);
  return latestServerStatus;
}

function startServerStatusCollector() {
  collectServerStatus({ persist: true }).catch((err) => console.warn('Initial server status failed:', err.message || err));
  setInterval(() => {
    collectServerStatus({ persist: true }).catch((err) => console.warn('Server status collection failed:', err.message || err));
  }, Math.max(5000, SERVER_STATUS_INTERVAL_MS));
}

async function serverStatus(user, res) {
  if (!user.isAdmin) { const err = new Error('Solo admin puede leer estado de servidor.'); err.status = 403; throw err; }
  const status = latestServerStatus || await collectServerStatus({ persist: false });
  sendJson(res, 200, status);
}
async function createDownloadLink(user, res, url) {
  const requestedPath = normalizeCloudPath(url.searchParams.get('path'));
  const name = safeChildName(url.searchParams.get('name'));
  const baseRoot = getCloudBaseRoot(user);
  await resolveDownloadChild(user, baseRoot, requestedPath, name);
  const token = signDownloadPayload({
    uid: user.id,
    isAdmin: user.isAdmin,
    roles: user.roles,
    profile: {
      id: user.profile?.id || user.id,
      user_id: user.profile?.user_id || user.id,
      username: user.profile?.username || null,
      display_name: user.profile?.display_name || null,
      email: user.profile?.email || null,
    },
    path: requestedPath,
    name,
    exp: Date.now() + DOWNLOAD_TOKEN_TTL_MS,
  });
  sendJson(res, 200, { success: true, url: `/api/download-public?token=${encodeURIComponent(token)}`, expiresInMs: DOWNLOAD_TOKEN_TTL_MS });
}

async function downloadPublic(req, res, url) {
  const payload = verifyDownloadToken(url.searchParams.get('token'));
  const user = downloadTokenUser(payload);
  const tokenUrl = new URL(`/api/download?path=${encodeURIComponent(payload.path)}&name=${encodeURIComponent(payload.name)}`, `http://${req.headers.host || 'localhost'}`);
  return downloadFile(user, req, res, tokenUrl);
}

async function downloadFile(user, req, res, url) {
  const baseRoot = getCloudBaseRoot(user);
  const { name, child } = await resolveDownloadChild(user, baseRoot, url.searchParams.get('path'), url.searchParams.get('name'));
  const stats = await fsp.stat(child);
  if (!stats.isFile()) throw new Error('El elemento no es archivo.');
  const encoded = encodeURIComponent(name).replace(/['()]/g, escape).replace(/\*/g, '%2A');
  const safeName = name.replace(/[\"\r\n]/g, '_');
  return streamFile(req, res, child, stats, {
    ...API_CORS_HEADERS,
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
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
    if (url.pathname.startsWith('/api/beat-store')) {
      if (req.method === 'OPTIONS') return send(res, 204, '', PUBLIC_CORS_HEADERS);
      if (req.method === 'POST' && url.pathname === '/api/beat-store/cover') return await uploadBeatCover(await requireCloudUser(req), req, res);
      if (req.method === 'POST' && url.pathname === '/api/beat-store/upload-audio') return await uploadBeatAudio(await requireCloudUser(req), req, res);
      if (req.method === 'POST' && url.pathname === '/api/beat-store/previews/backfill') return await backfillBeatPreviews(await requireCloudUser(req), res);
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/api/beat-store') return await listBeatStore(res);
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/api/beat-store/stream') return await streamBeatFile(req, res, url);
      return failPublic(res, 404, 'Ruta Beat Store no encontrada.');
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/api/download-public') return await downloadPublic(req, res, url);
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'OPTIONS') return send(res, 204, '', API_CORS_HEADERS);
      const user = await requireCloudUser(req);
      if (req.method === 'GET' && url.pathname === '/api/session') return sendJson(res, 200, sessionPayload(user));
      if (req.method === 'GET' && url.pathname === '/api/server-status') return await serverStatus(user, res);
      if (req.method === 'GET' && url.pathname === '/api/files') return await listFiles(user, res, url);
      if (req.method === 'POST' && url.pathname === '/api/folders') return await createFolder(user, req, res);
      if (req.method === 'POST' && url.pathname === '/api/upload') return await uploadFile(user, req, res, url);
      if (req.method === 'POST' && url.pathname === '/api/rename') return await renameItem(user, req, res);
      if (req.method === 'DELETE' && url.pathname === '/api/item') return await deleteItem(user, res, url);
      if (req.method === 'GET' && url.pathname === '/api/download-link') return await createDownloadLink(user, res, url);
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/api/download') return await downloadFile(user, req, res, url);
      return fail(res, 404, 'Ruta API no encontrada.');
    }
    return serveStatic(req, res, url);
  } catch (err) {
    const status = Number(err.status || 500);
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    const body = { success: false, error: err.message || 'Error interno.' };
    if (err.original_file_url) body.original_file_url = err.original_file_url;
    if (err.original_path) body.beat_original_path = err.original_path;
    if (err.original_file_url || err.original_path) body.beat_preview_status = 'error';
    sendJson(res, safeStatus, body);
  }
}

http.createServer(route).listen(PORT, '0.0.0.0', () => {
  console.log(`MysAuth Cloud listening on ${PORT}`);
  console.log(`Cloud root: ${path.resolve(CLOUD_ROOT)}`);
  startServerStatusCollector();
});

