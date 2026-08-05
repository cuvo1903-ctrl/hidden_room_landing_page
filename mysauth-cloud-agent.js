#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');
const { URL } = require('url');

function loadEnvFile(filePath) {
  try {
    const raw = require('fs').readFileSync(filePath, 'utf8');
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
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

loadEnvFile(require('path').join(__dirname, '.env'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLOUD_HIDDENROOM_ROOT = process.env.CLOUD_HIDDENROOM_ROOT || process.env.CLOUD_ROOT;
const CLOUD_HIDDENROOM_URL = process.env.CLOUD_HIDDENROOM_URL || 'https://cloud.hiddenroom.mx/files';
const CLOUD_STAGING_BUCKET = process.env.CLOUD_STAGING_BUCKET || 'cloud-staging';
const POLL_INTERVAL_MS = Number(process.env.CLOUD_JOBS_POLL_INTERVAL_MS || 2000);
const JOB_BATCH_SIZE = Number(process.env.CLOUD_JOBS_BATCH_SIZE || 10);
const JOB_LOCK_TIMEOUT_MS = Number(process.env.CLOUD_JOBS_LOCK_TIMEOUT_MS || 10_000);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CLOUD_HIDDENROOM_ROOT) {
  console.error('Missing required environment variables. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CLOUD_HIDDENROOM_ROOT.');
  process.exit(1);
}

function supabaseHeaders() {
  return {
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    apikey: SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

function normalizeRequestPath(requestPath) {
  if (!requestPath || requestPath === '/') return '/';
  let normalized = String(requestPath).replace(/\\/g, '/');
  normalized = normalized.replace(/\/+/g, '/');
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function getTargetPath(requestPath) {
  const normalized = normalizeRequestPath(requestPath);
  const resolved = path.resolve(CLOUD_HIDDENROOM_ROOT, `.${normalized}`);
  const rootResolved = path.resolve(CLOUD_HIDDENROOM_ROOT);
  const relative = path.relative(rootResolved, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid cloud path.');
  }
  return resolved;
}

function getSafeChildPath(parentPath, childName) {
  const name = String(childName ?? '').trim();
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Invalid file or folder name.');
  }
  const resolvedParent = path.resolve(parentPath);
  const resolvedChild = path.resolve(resolvedParent, name);
  if (path.dirname(resolvedChild) !== resolvedParent) throw new Error('Invalid file or folder path.');
  return resolvedChild;
}

function encodeStorageObjectPath(storagePath) {
  const normalized = String(storagePath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (normalized.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid staging storage path.');
  }
  return parts.map(encodeURIComponent).join('/');
}

function buildPublicFileUrl(requestPath, fileName) {
  const normalized = normalizeRequestPath(requestPath);
  const segments = normalized === '/' ? [] : normalized.split('/').filter(Boolean).map(encodeURIComponent);
  const encodedFileName = encodeURIComponent(fileName);
  return `${CLOUD_HIDDENROOM_URL}/${segments.concat(encodedFileName).join('/')}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSupabase(pathname, options = {}) {
  const url = new URL(pathname, SUPABASE_URL);
  const res = await fetch(url.toString(), options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase REST request failed ${res.status}: ${body}`);
  }
  return res.json();
}

async function downloadStagedFile(storagePath) {
  const encodedPath = encodeStorageObjectPath(storagePath);
  const url = new URL(`/storage/v1/object/${encodeURIComponent(CLOUD_STAGING_BUCKET)}/${encodedPath}`, SUPABASE_URL);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to download staged file: ${res.status} ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function removeStagedFile(storagePath) {
  encodeStorageObjectPath(storagePath);
  const url = new URL(`/storage/v1/object/${encodeURIComponent(CLOUD_STAGING_BUCKET)}`, SUPABASE_URL);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: supabaseHeaders(),
    body: JSON.stringify({ prefixes: [storagePath] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to remove staged file: ${res.status} ${body}`);
  }
}

async function fetchPendingJobs() {
  const url = new URL('/rest/v1/cloud_jobs', SUPABASE_URL);
  url.searchParams.set('status', 'eq.pending');
  url.searchParams.set('order', 'created_at.asc');
  url.searchParams.set('limit', String(JOB_BATCH_SIZE));
  const res = await fetch(url.toString(), { headers: supabaseHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch pending jobs: ${res.status} ${body}`);
  }
  return res.json();
}

async function updateJob(jobId, patch) {
  const url = new URL('/rest/v1/cloud_jobs', SUPABASE_URL);
  url.searchParams.set('id', `eq.${jobId}`);
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: supabaseHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to update job ${jobId}: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data[0];
}

async function markJobProcessing(jobId) {
  return updateJob(jobId, { status: 'processing' });
}

async function processJob(job) {
  const jobId = job.id;
  const action = String(job.action);
  const payload = job.payload ?? {};
  const pathValue = normalizeRequestPath(String(job.path ?? '/'));
  let result = null;

  const targetRoot = path.resolve(CLOUD_HIDDENROOM_ROOT);
  const requestPath = pathValue;
  const fullPath = getTargetPath(requestPath);

  switch (action) {
    case 'list': {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const folders = [];
      const files = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          folders.push(entry.name);
          continue;
        }
        if (!entry.isFile()) continue;
        const filePath = path.join(fullPath, entry.name);
        const stats = await fs.stat(filePath);
        files.push({
          type: 'file',
          name: entry.name,
          size: String(stats.size),
          modified: stats.mtime.toISOString(),
          url: buildPublicFileUrl(requestPath, entry.name),
        });
      }
      result = { path: requestPath, folders, files };
      break;
    }
    case 'upload': {
      const filename = String(payload.filename ?? '').trim();
      const storagePath = String(payload.storage_path ?? '').trim();
      const expectedSize = Number(payload.size);
      if (!storagePath) throw new Error('La ruta temporal del archivo es requerida.');
      const targetPath = getSafeChildPath(fullPath, filename);
      const fileBuffer = await downloadStagedFile(storagePath);
      if (!fileBuffer.length) throw new Error('El archivo temporal esta vacio.');
      if (Number.isSafeInteger(expectedSize) && expectedSize > 0 && fileBuffer.length !== expectedSize) {
        throw new Error(`El tamaño descargado (${fileBuffer.length}) no coincide con el esperado (${expectedSize}).`);
      }
      await fs.mkdir(fullPath, { recursive: true });
      await fs.writeFile(targetPath, fileBuffer);
      await removeStagedFile(storagePath);
      const stats = await fs.stat(targetPath);
      result = {
        name: filename,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        url: buildPublicFileUrl(requestPath, filename),
      };
      break;
    }
    case 'folder': {
      const folderName = String(payload.folderName ?? '').trim();
      if (!folderName) throw new Error('El nombre de la carpeta es requerido.');
      const targetPath = getSafeChildPath(fullPath, folderName);
      await fs.mkdir(targetPath, { recursive: true });
      result = { folderName, path: requestPath };
      break;
    }
    case 'delete': {
      const itemType = String(payload.type ?? '').trim();
      const itemName = String(payload.name ?? '').trim();
      if (!itemType || !itemName) throw new Error('Tipo y nombre son requeridos.');
      const targetPath = getSafeChildPath(fullPath, itemName);
      if (itemType === 'folder') {
        await fs.rm(targetPath, { recursive: true, force: false });
      } else {
        await fs.rm(targetPath, { force: false });
      }
      result = { success: true, path: requestPath, type: itemType, name: itemName };
      break;
    }
    default:
      throw new Error(`Accion no soportada: ${action}`);
  }

  return result;
}

async function main() {
  console.log('Starting MysAuth cloud agent');
  console.log(`Cloud root: ${CLOUD_HIDDENROOM_ROOT}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);

  let running = true;
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    try {
      const jobs = await fetchPendingJobs();
      if (Array.isArray(jobs) && jobs.length > 0) {
        for (const job of jobs) {
          if (!running) break;
          try {
            await markJobProcessing(job.id);
            console.log(`Processing job ${job.id} action=${job.action} path=${job.path}`);
            const result = await processJob(job);
            await updateJob(job.id, {
              status: 'done',
              result,
              error: null,
              completed_at: new Date().toISOString(),
            });
            console.log(`Job ${job.id} completed.`);
          } catch (err) {
            console.error(`Job ${job.id} failed:`, err.message || err);
            try {
              await updateJob(job.id, {
                status: 'error',
                error: String(err.message ?? err),
                completed_at: new Date().toISOString(),
              });
            } catch (updateErr) {
              console.error(`Failed to update job ${job.id} to error state:`, updateErr.message || updateErr);
            }
          }
        }
        continue;
      }
    } catch (err) {
      console.error('Agent error:', err.message || err);
    }
    await delay(POLL_INTERVAL_MS);
  }

  console.log('MysAuth cloud agent stopping.');
}

main().catch((err) => {
  console.error('Uncaught agent error:', err.message || err);
  process.exit(1);
});
