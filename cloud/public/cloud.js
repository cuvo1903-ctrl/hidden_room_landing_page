import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://rpcunbkstadgngqrjafp.supabase.co";
const SUPABASE_KEY = "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const state = { path: '/', entries: null, meta: null };
const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');
const statusMessage = document.getElementById('status-message');
const fileBody = document.getElementById('file-body');
const breadcrumb = document.getElementById('breadcrumb');
const fileInput = document.getElementById('file-input');
const uploadButton = document.querySelector('.upload-button');
const folderButton = document.getElementById('folder-button');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}
function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function normalizePath(path) {
  if (!path || path === '/') return '/';
  let normalized = String(path).replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}
function childPath(name) { return state.path === '/' ? `/${name}` : `${state.path}/${name}`; }
function parentPath() {
  const current = normalizePath(state.path);
  if (current === '/') return '/';
  const parts = current.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
}
function setMessage(message, isError = false) {
  statusMessage.textContent = message || '';
  statusMessage.classList.toggle('error', Boolean(isError));
}
function setActionsEnabled(canUpload) {
  if (uploadButton) uploadButton.hidden = !canUpload;
  if (folderButton) folderButton.hidden = !canUpload;
}
function applyMeta(meta) {
  if (!meta) return;
  state.meta = meta;
  setActionsEnabled(Boolean(meta.canUpload));
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sesion requerida.');
  return { Authorization: `Bearer ${session.access_token}` };
}
async function api(path, options = {}) {
  const headers = { ...(await authHeaders()), ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || `Error ${response.status}`);
  }
  return response;
}
async function apiJson(path, options = {}) { return (await api(path, options)).json(); }

function renderBreadcrumb() {
  const current = normalizePath(state.path);
  const parts = current === '/' ? [] : current.slice(1).split('/');
  const items = [{ label: state.meta?.rootLabel || 'Root', path: '/' }];
  let walk = '';
  for (const part of parts) {
    walk += `/${part}`;
    items.push({ label: part, path: walk });
  }
  breadcrumb.innerHTML = items.map((item) => `<button type="button" data-path="${escapeHtml(item.path)}">${escapeHtml(item.label)}</button>`).join('');
}
function rowTemplate(item, type) {
  const isFolder = type === 'folder';
  const writeActions = state.meta?.canUpload ? `
        <button type="button" data-action="rename" data-type="${type}" data-name="${escapeHtml(item.name)}">Renombrar</button>
        <button class="danger" type="button" data-action="delete" data-type="${type}" data-name="${escapeHtml(item.name)}">Eliminar</button>` : '';
  return `
    <tr>
      <td class="name">${escapeHtml(item.name)}</td>
      <td>${isFolder ? 'Carpeta' : 'Archivo'}</td>
      <td>${isFolder ? '-' : escapeHtml(formatSize(item.size))}</td>
      <td>${escapeHtml(formatDate(item.modified))}</td>
      <td><div class="row-actions">
        ${isFolder ? `<button type="button" data-action="open" data-name="${escapeHtml(item.name)}">Abrir</button>` : `<button type="button" data-action="download" data-name="${escapeHtml(item.name)}">Descargar</button>`}
        ${writeActions}
      </div></td>
    </tr>`;
}
function renderFiles(data) {
  const folders = Array.isArray(data.folders) ? data.folders : [];
  const files = Array.isArray(data.files) ? data.files : [];
  renderBreadcrumb();
  if (!folders.length && !files.length) {
    fileBody.innerHTML = '<tr><td class="empty" colspan="5">No hay archivos en esta carpeta.</td></tr>';
    return;
  }
  fileBody.innerHTML = [...folders.map((folder) => rowTemplate(folder, 'folder')), ...files.map((file) => rowTemplate(file, 'file'))].join('');
}
async function loadFiles(path = state.path) {
  state.path = normalizePath(path);
  setMessage('Cargando...');
  const data = await apiJson(`/api/files?path=${encodeURIComponent(state.path)}`);
  applyMeta(data.meta);
  state.entries = data;
  renderFiles(data);
  setMessage('');
}
async function createFolder() {
  if (!state.meta?.canUpload) return;
  const name = prompt('Nombre de la carpeta');
  if (!name) return;
  await apiJson('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: state.path, name }) });
  await loadFiles();
}
async function uploadFile(file) {
  if (!file || !state.meta?.canUpload) return;
  setMessage(`Subiendo ${file.name}...`);
  await apiJson(`/api/upload?path=${encodeURIComponent(state.path)}`, { method: 'POST', headers: { 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  fileInput.value = '';
  await loadFiles();
}
async function renameItem(type, name) {
  if (!state.meta?.canUpload) return;
  const newName = prompt('Nuevo nombre', name);
  if (!newName || newName === name) return;
  await apiJson('/api/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: state.path, type, name, newName }) });
  await loadFiles();
}
async function deleteItem(type, name) {
  if (!state.meta?.canUpload) return;
  if (!confirm(`Eliminar ${name}?`)) return;
  await apiJson(`/api/item?path=${encodeURIComponent(state.path)}&type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  await loadFiles();
}
async function downloadFile(name) {
  setMessage(`Preparando ${name}...`);
  const response = await api(`/api/download?path=${encodeURIComponent(state.path)}&name=${encodeURIComponent(name)}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setMessage('');
}
async function showAppIfSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    loginView.hidden = false;
    appView.hidden = true;
    setActionsEnabled(false);
    return;
  }

  loginView.hidden = true;
  appView.hidden = false;
  try {
    applyMeta(await apiJson('/api/session'));
    await loadFiles(state.meta?.homePath || '/');
  } catch (err) {
    setMessage(err.message || 'No se pudo cargar MysAuth Cloud.', true);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginMessage.textContent = 'Entrando...';
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { loginMessage.textContent = error.message; return; }
  loginMessage.textContent = '';
  await showAppIfSession();
});
document.getElementById('logout-button').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
document.getElementById('refresh-button').addEventListener('click', () => loadFiles().catch((err) => setMessage(err.message, true)));
folderButton.addEventListener('click', () => createFolder().catch((err) => setMessage(err.message, true)));
document.getElementById('up-button').addEventListener('click', () => loadFiles(parentPath()).catch((err) => setMessage(err.message, true)));
fileInput.addEventListener('change', () => uploadFile(fileInput.files?.[0]).catch((err) => setMessage(err.message, true)));
breadcrumb.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-path]');
  if (button) loadFiles(button.dataset.path).catch((err) => setMessage(err.message, true));
});
fileBody.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, type, name } = button.dataset;
  if (action === 'open') loadFiles(childPath(name)).catch((err) => setMessage(err.message, true));
  if (action === 'download') downloadFile(name).catch((err) => setMessage(err.message, true));
  if (action === 'rename') renameItem(type, name).catch((err) => setMessage(err.message, true));
  if (action === 'delete') deleteItem(type, name).catch((err) => setMessage(err.message, true));
});
showAppIfSession().catch((err) => { loginView.hidden = false; appView.hidden = true; setActionsEnabled(false); loginMessage.textContent = err.message; });
