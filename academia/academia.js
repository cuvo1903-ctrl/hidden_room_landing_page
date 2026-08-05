const state = {
  supabase: null,
  user: null,
  profile: null,
  isAdmin: false,
  courses: [],
  modules: [],
  contents: [],
  courseAccess: [],
  moduleAccess: [],
  downloadAccess: [],
  contentFiles: [],
  users: [],
  tableEditorTable: "academy_courses",
  tableEditorSearch: "",
  view: new URLSearchParams(window.location.search).get("view") || "courses",
};

const els = {
  app: document.getElementById("academy-app"),
  detail: document.getElementById("academy-detail"),
  admin: document.getElementById("academy-admin"),
  status: document.getElementById("academy-status"),
  user: document.querySelector("[data-academia-user]"),
  count: document.querySelector("[data-academia-count]"),
  hero: document.querySelector(".academia-hero"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value) {
  return String(value || "curso")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "curso";
}

function setStatus(message, tone = "") {
  if (!els.status) return;
  els.status.textContent = message || "";
  els.status.dataset.tone = tone;
}

function supabaseErrorMessage(error) {
  if (!error) return "Error desconocido.";
  return [error.message, error.details, error.hint, error.code].filter(Boolean).join(" | ");
}

const CLOUD_HIDDENROOM_URL = "https://cloud.hiddenroom.mx/";
const CLOUD_FUNCTION_BASE = `${window.HiddenRoomSupabase?.url || "https://rpcunbkstadgngqrjafp.supabase.co"}/functions/v1`;
const CLOUD_STAGING_BUCKET = "cloud-staging";

const ACADEMY_TABLE_EDITOR_CONFIG = {
  academy_courses: {
    label: "Cursos",
    source: "courses",
    primaryKey: "id",
    lockedFields: ["id", "created_by", "created_at", "updated_at", "published_at"],
    editableFields: ["slug", "title", "summary", "description", "status", "cover_image"],
    hiddenColumns: ["id", "created_by", "updated_at", "published_at"],
  },
  academy_course_modules: {
    label: "Modulos",
    source: "modules",
    primaryKey: "id",
    lockedFields: ["id", "created_at", "updated_at"],
    editableFields: ["course_id", "cycle", "title", "summary", "position", "status"],
    hiddenColumns: ["id", "updated_at"],
  },
  academy_module_contents: {
    label: "Contenidos",
    source: "contents",
    primaryKey: "id",
    lockedFields: ["id", "created_by", "created_at", "updated_at"],
    editableFields: ["module_id", "title", "content_type", "url", "body", "position", "status"],
    hiddenColumns: ["id", "created_by", "updated_at"],
  },
  academy_content_files: {
    label: "Archivos contenido",
    source: "contentFiles",
    primaryKey: "id",
    lockedFields: ["id", "content_id", "uploaded_by", "created_at"],
    editableFields: ["file_name", "storage_path", "cloud_path", "mime_type", "file_size"],
    hiddenColumns: ["id", "uploaded_by"],
  },
  academy_course_access: {
    label: "Acceso cursos",
    source: "courseAccess",
    primaryKey: "id",
    lockedFields: ["id", "granted_by", "granted_at"],
    editableFields: ["course_id", "user_id", "status", "expires_at"],
    hiddenColumns: ["id", "granted_by"],
  },
  academy_module_access: {
    label: "Acceso modulos",
    source: "moduleAccess",
    primaryKey: "id",
    lockedFields: ["id", "granted_by", "granted_at"],
    editableFields: ["module_id", "user_id", "status", "expires_at"],
    hiddenColumns: ["id", "granted_by"],
  },
  academy_content_download_access: {
    label: "Acceso descargas",
    source: "downloadAccess",
    primaryKey: "id",
    lockedFields: ["id", "granted_by", "granted_at"],
    editableFields: ["content_id", "user_id", "status", "expires_at"],
    hiddenColumns: ["id", "granted_by"],
  },
};

function tableEditorConfig(tableName = state.tableEditorTable) {
  return ACADEMY_TABLE_EDITOR_CONFIG[tableName] || ACADEMY_TABLE_EDITOR_CONFIG.academy_courses;
}

function tableEditorRows(tableName = state.tableEditorTable) {
  const config = tableEditorConfig(tableName);
  return [...(state[config.source] || [])];
}

function academyTableFieldLabel(field) {
  const labels = {
    id: "ID",
    course_id: "Curso",
    module_id: "Modulo",
    content_id: "Contenido",
    user_id: "Usuario",
    title: "Titulo",
    summary: "Resumen",
    description: "Descripcion",
    status: "Estado",
    cycle: "CICLO",
    position: "Orden",
    content_type: "Tipo",
    cover_image: "Portada",
    expires_at: "Expira",
    granted_at: "Asignado",
    created_at: "Creado",
    updated_at: "Actualizado",
    published_at: "Publicado",
    created_by: "Creado por",
    granted_by: "Asignado por",
  };
  return labels[field] || field;
}

function normalizeTableValue(field, value) {
  const text = String(value ?? "").trim();
  if (["position"].includes(field)) return text ? Number(text) : 1;
  if (["summary", "description", "cover_image", "url", "body", "cycle", "expires_at"].includes(field)) return text || null;
  return text;
}

function academyRowLabel(row) {
  return row.title || row.slug || row.id || row.user_id || "fila";
}

function normalizeCloudPath(path) {
  if (!path || path === "/") return "/";
  let normalized = String(path).replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized !== "/" && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  return normalized;
}

function sanitizeCloudSegment(value, fallback = "item") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function safeCloudFileName(fileName) {
  const raw = String(fileName || "archivo").replace(/[\\/]/g, "_");
  const dotIndex = raw.lastIndexOf(".");
  const base = dotIndex > 0 ? raw.slice(0, dotIndex) : raw;
  const ext = dotIndex > 0 ? raw.slice(dotIndex + 1) : "";
  const safeBase = sanitizeCloudSegment(base, "archivo");
  const safeExt = ext.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16);
  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}

function buildCloudStagingPath(userId, fileName) {
  const safeFileName = safeCloudFileName(fileName);
  const uniquePart = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${userId}/${Date.now()}-${uniquePart}-${safeFileName}`;
}

function buildCloudFileFallbackUrl(path, fileName) {
  const safePath = normalizeCloudPath(path);
  const fullPath = safePath === "/" ? `/${fileName}` : `${safePath}/${fileName}`;
  return `${CLOUD_HIDDENROOM_URL.replace(/\/$/, "")}${fullPath.split("/").map(encodeURIComponent).join("/")}`;
}

function cloudUploadResultUrl(payload) {
  return payload?.url || payload?.public_url || payload?.publicUrl || payload?.file_url || payload?.fileUrl || payload?.result?.url || null;
}

async function getCloudAuthHeaders() {
  const { data: { session } } = await state.supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sesion de Supabase no disponible.");
  return { Accept: "application/json", Authorization: `Bearer ${token}` };
}

async function cloudApiFetch(url, options = {}) {
  const headers = { ...(await getCloudAuthHeaders()), ...(options.headers || {}) };
  return fetch(url, { ...options, headers });
}

function setUploadProgress(form, scope, percent, label) {
  const progress = form?.querySelector(`[data-${scope}-upload-progress]`);
  const bar = form?.querySelector(`[data-${scope}-upload-progress-bar]`);
  const labelEl = form?.querySelector(`[data-${scope}-upload-progress-label]`);
  const valueEl = form?.querySelector(`[data-${scope}-upload-progress-value]`);
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (progress) progress.hidden = false;
  if (bar) bar.style.width = `${safePercent}%`;
  if (labelEl) labelEl.textContent = label;
  if (valueEl) valueEl.textContent = `${Math.round(safePercent)}%`;
}

function resetUploadProgress(form, scope, label = "Esperando archivo") {
  setUploadProgress(form, scope, 0, label);
  const progress = form?.querySelector(`[data-${scope}-upload-progress]`);
  if (progress) progress.hidden = true;
}

function setContentUploadProgress(form, percent, label) {
  setUploadProgress(form, "content", percent, label);
}

function resetContentUploadProgress(form) {
  resetUploadProgress(form, "content", "Esperando archivo");
}

function setFormPending(form, pending, label = "Procesando...") {
  form?.querySelectorAll('button[type="submit"]').forEach((button) => {
    if (pending) {
      button.dataset.originalText = button.dataset.originalText || button.textContent || "";
      button.disabled = true;
      button.textContent = label;
    } else {
      button.disabled = false;
      if (button.dataset.originalText) button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  });
}
async function uploadAcademiaCloudFile(file, targetPath) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new Error("Selecciona un archivo valido.");
  const { data: { user } } = await state.supabase.auth.getUser();
  if (!user) throw new Error("Sesion de Supabase no disponible.");
  const storagePath = buildCloudStagingPath(user.id, file.name);
  let storageResult;
  try {
    storageResult = await state.supabase.storage.from(CLOUD_STAGING_BUCKET).upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  } catch (error) {
    throw new Error(`No se pudo preparar el archivo en Storage: ${error?.message || error}`);
  }
  const storageError = storageResult?.error;
  if (storageError) throw new Error(`No se pudo preparar el archivo en Storage: ${storageError.message}`);

  const currentPath = normalizeCloudPath(targetPath);
  let response;
  try {
    response = await cloudApiFetch(`${CLOUD_FUNCTION_BASE}/cloud-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: currentPath,
        filename: file.name,
        storage_path: storagePath,
        size: file.size,
        mime_type: file.type || "application/octet-stream",
      }),
    });
  } catch (error) {
    await state.supabase.storage.from(CLOUD_STAGING_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(`No se pudo contactar Cloud Upload: ${error?.message || error}`);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    if (response.status >= 400 && response.status < 500) await state.supabase.storage.from(CLOUD_STAGING_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(error?.error || `No se pudo subir el archivo (${response.status}).`);
  }
  const payload = await response.json().catch(() => ({}));
  return {
    url: cloudUploadResultUrl(payload) || buildCloudFileFallbackUrl(currentPath, file.name),
    cloudPath: currentPath,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || "application/octet-stream",
  };
}

function academyContentCloudPath(course, module) {
  return normalizeCloudPath(`/academia/${sanitizeCloudSegment(course?.slug || course?.title || course?.id, "curso")}/${sanitizeCloudSegment(module?.cycle || "sin-ciclo", "sin-ciclo")}/${sanitizeCloudSegment(module?.title || module?.id, "modulo")}`);
}
function currentView() {
  return new URLSearchParams(window.location.search).get("view") || state.view || "courses";
}

function waitForHiddenRoomSupabase(retries = 40) {
  if (window.HiddenRoomSupabase?.getClient) return Promise.resolve(window.HiddenRoomSupabase);
  if (retries <= 0) return Promise.reject(new Error("Cliente Supabase global no disponible."));
  return new Promise((resolve, reject) => {
    window.setTimeout(() => waitForHiddenRoomSupabase(retries - 1).then(resolve).catch(reject), 100);
  });
}

function firstError(results) {
  return results.find((result) => result?.error)?.error || null;
}

function optionList(items, getLabel) {
  return items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(getLabel(item))}</option>`).join("");
}

function courseModules(courseId, cycle = "") {
  return state.modules
    .filter((item) => item.course_id === courseId && (!cycle || (item.cycle || "") === cycle))
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

function courseCycles(courseId) {
  return [...new Set(state.modules
    .filter((item) => item.course_id === courseId && item.cycle)
    .map((item) => item.cycle))]
    .sort((a, b) => String(a).localeCompare(String(b), "es"));
}

function moduleContents(moduleId) {
  return state.contents
    .filter((item) => item.module_id === moduleId)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

function moduleFileContents(moduleId) {
  return moduleContents(moduleId).filter((content) => contentFileFor(content.id));
}

function contentOptionLabel(content) {
  const file = contentFileFor(content.id);
  return `${content.title}${file?.file_name ? ` - ${file.file_name}` : ""}`;
}

function canSeeCourse(course) {
  if (state.isAdmin || course.status === "published") return true;
  return state.courseAccess.some((grant) => grant.course_id === course.id && ["active", "completed"].includes(grant.status));
}

function hasModuleAccess(moduleId) {
  if (state.isAdmin) return true;
  return state.moduleAccess.some((grant) => grant.module_id === moduleId && ["active", "completed"].includes(grant.status));
}

function activeCourseAccessForUser(userId) {
  return state.courseAccess.filter((grant) => String(grant.user_id) === String(userId) && grant.status === "active");
}

function visibleCourses() {
  return state.courses.filter((course) => {
    if (!canSeeCourse(course)) return false;
    if (currentView() !== "my" || state.isAdmin) return true;
    return state.courseAccess.some((grant) => grant.course_id === course.id && ["active", "completed"].includes(grant.status));
  });
}

function courseCard(course) {
  const moduleCount = courseModules(course.id).length;
  return `
    <article class="academia-card" data-course-id="${escapeHtml(course.id)}">
      <div class="academia-card__top">
        <span class="hr-badge">Curso</span>
        <span class="academia-kicker">${escapeHtml(course.status || "draft")}</span>
      </div>
      <div>
        <h2>${escapeHtml(course.title)}</h2>
        <p>${escapeHtml(course.summary || "Sin resumen todavia.")}</p>
      </div>
      <div class="academia-card__meta"><span>${moduleCount} modulos</span></div>
      <button class="academia-button" type="button" data-action="open-course" data-course-id="${escapeHtml(course.id)}">Ver curso</button>
    </article>
  `;
}

function renderCourses() {
  state.view = currentView();
  if (els.hero) els.hero.hidden = state.view !== "courses";
  const courses = visibleCourses();
  if (els.count) els.count.textContent = `${courses.length} curso${courses.length === 1 ? "" : "s"} disponibles`;
  els.app.hidden = false;
  els.app.innerHTML = courses.length
    ? courses.map(courseCard).join("")
    : '<div class="academia-card"><h2>Sin cursos</h2><p>No hay cursos disponibles.</p></div>';
}

function contentFileFor(contentId) {
  return state.contentFiles.find((file) => file.content_id === contentId) || null;
}

function cloudDownloadRequestFromHref(href) {
  const url = new URL(href, window.location.href);
  const cloudRoot = new URL(CLOUD_HIDDENROOM_URL);
  if (url.origin !== cloudRoot.origin) return null;
  let parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  if (parts[0] === "files") parts = parts.slice(1);
  const name = parts.pop();
  if (!name) return null;
  return { path: normalizeCloudPath(`/${parts.join("/")}`), name };
}

async function fetchAcademiaCloudBlob(link, accept = "application/octet-stream", mode = "view") {
  const request = cloudDownloadRequestFromHref(link?.href);
  if (!request) throw new Error("Ruta de archivo Cloud invalida.");
  const safeMode = mode === "download" ? "download" : "view";
  const apiUrl = `${CLOUD_HIDDENROOM_URL.replace(/\/$/, "")}/api/academy-download?path=${encodeURIComponent(request.path)}&name=${encodeURIComponent(request.name)}&mode=${safeMode}`;
  const response = await cloudApiFetch(apiUrl, { headers: { Accept: accept } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `No se pudo abrir el archivo (${response.status}).`);
  }
  return { request, blob: await response.blob() };
}

async function viewAcademiaCloudFile(link) {
  const viewer = window.open("", "_blank");
  if (!viewer) throw new Error("El navegador bloqueo la pestana de visualizacion.");
  viewer.document.title = "Cargando PDF...";
  viewer.document.body.innerHTML = "<p style='font-family:sans-serif;padding:24px'>Cargando PDF...</p>";
  link.setAttribute("aria-busy", "true");
  try {
    const { blob } = await fetchAcademiaCloudBlob(link, "application/pdf", "view");
    const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(pdfBlob);
    viewer.location.href = objectUrl;
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    setStatus("PDF abierto en una nueva pestana.");
  } catch (error) {
    viewer.close();
    throw error;
  } finally {
    link.removeAttribute("aria-busy");
  }
}

async function downloadAcademiaCloudFile(link) {
  link.setAttribute("aria-busy", "true");
  try {
    const { request, blob } = await fetchAcademiaCloudBlob(link, "application/octet-stream", "download");
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = request.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    setStatus("Descarga iniciada.");
  } finally {
    link.removeAttribute("aria-busy");
  }
}

function isPdfFile(file) {
  return String(file?.mime_type || "").toLowerCase().includes("pdf") || String(file?.file_name || file?.storage_path || "").toLowerCase().endsWith(".pdf");
}

function canDownloadContentFile(file) {
  return state.downloadAccess.some((grant) => String(grant.content_id) === String(file?.content_id) && ["active", "completed"].includes(grant.status));
}

function renderAcademiaFileActions(file) {
  if (!file?.storage_path) return "";
  const href = escapeHtml(file.storage_path);
  const canDownload = canDownloadContentFile(file);
  return `
    <div class="academia-file-actions">
      ${isPdfFile(file) ? `<a class="academia-button academia-download-action" href="${href}" data-academia-cloud-view="true" target="_blank" rel="noopener">Ver</a>` : ""}
      ${canDownload ? `<a class="academia-button secondary academia-download-action" href="${href}" data-academia-cloud-download="true">Descargar</a>` : ""}
    </div>
  `;
}

function contentCard(content) {
  const file = contentFileFor(content.id);
  return `
    <div class="academia-content">
      <div class="academia-row">
        <strong>${escapeHtml(content.title)}</strong>
        <span class="academia-kicker">${escapeHtml(content.content_type)}</span>
      </div>
      ${file ? `<div class="academia-content__meta"><span>${escapeHtml(file.file_name)}</span></div>` : ""}
      ${content.body ? `<p>${escapeHtml(content.body)}</p>` : ""}
      ${content.url ? `<a class="academia-button secondary" href="${escapeHtml(content.url)}" target="_blank" rel="noopener">Abrir material</a>` : ""}
      ${file ? renderAcademiaFileActions(file) : ""}
    </div>
  `;
}

function moduleCard(module) {
  const unlocked = hasModuleAccess(module.id);
  const contentMarkup = moduleContents(module.id).map(contentCard).join("") || "<p>Este modulo aun no tiene contenido.</p>";
  return `
    <article class="academia-module${unlocked ? "" : " is-locked"}">
      <div class="academia-row">
        <h3>${escapeHtml(module.title)}</h3>
        <span class="academia-kicker">${unlocked ? `Modulo ${Number(module.position || 0)}` : "Bloqueado"}</span>
      </div>
      <p>${escapeHtml(module.summary || "")}</p>
      ${unlocked ? `<div class="academia-list">${contentMarkup}</div>` : "<p>Este modulo todavia no esta liberado para tu cuenta.</p>"}
    </article>
  `;
}

function renderDetail(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course || !canSeeCourse(course)) return;
  const modules = courseModules(courseId);
  els.detail.hidden = false;
  els.detail.innerHTML = `
    <div class="academia-row">
      <div>
        <span class="academia-kicker">Curso</span>
        <h2>${escapeHtml(course.title)}</h2>
        ${course.description || course.summary ? `<p>${escapeHtml(course.description || course.summary)}</p>` : ""}
      </div>
      <button class="academia-button secondary" type="button" data-action="close-detail">Cerrar</button>
    </div>
    <div class="academia-modules">${modules.length ? modules.map(moduleCard).join("") : "<p>Este curso aun no tiene modulos.</p>"}</div>
  `;
  els.detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function uniqueUsers(users = []) {
  const seen = new Set();
  return users.filter((user) => {
    const key = String(user?.id || user?.user_id || user?.email || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function userName(user) {
  return user?.display_name || user?.username || user?.email || "Usuario";
}

function userPickerSearchText(user) {
  return normalizeSearchText([user.display_name, user.email, user.username, user.user_id].filter(Boolean).join(" "));
}

function renderUserPickerOptions(users = [], valueField = "id") {
  return users.map((user) => {
    const display = `${userName(user)} - ${user.email || user.user_id || "sin email"}`;
    return `
      <button class="db-user-option" type="button" data-user-id="${escapeHtml(user.user_id || "")}" data-user-value="${escapeHtml(user[valueField] || "")}" data-user-display="${escapeHtml(display)}" data-search-text="${escapeHtml(userPickerSearchText(user))}">
        <span>${escapeHtml(userName(user))}</span>
        <small>${escapeHtml(user.email || user.user_id || "sin email")}</small>
      </button>
    `;
  }).join("");
}

function renderUserPicker(name, label) {
  const users = uniqueUsers(state.users).slice(0, 80);
  const inputId = `user-picker-${name}-${Math.random().toString(36).slice(2, 8)}`;
  return `
    <div class="db-field db-user-picker" data-user-value-field="id" data-user-picker-limit="80">
      <label for="${escapeHtml(inputId)}">${escapeHtml(label)}</label>
      <input id="${escapeHtml(inputId)}" data-user-search autocomplete="off" placeholder="Buscar usuario" />
      <input type="hidden" name="${escapeHtml(name)}" required />
      <div class="db-user-picker__menu" hidden>
        ${renderUserPickerOptions(users)}
        <div class="db-user-picker__empty" data-user-picker-empty hidden>Sin usuarios encontrados.</div>
      </div>
    </div>
  `;
}

function filterUserPicker(search, clearSelection = false) {
  const picker = search.closest(".db-user-picker");
  const menu = picker?.querySelector(".db-user-picker__menu");
  const hidden = picker?.querySelector('input[type="hidden"]');
  if (clearSelection && hidden) hidden.value = "";
  if (!menu) return;
  const query = normalizeSearchText(search.value);
  const users = uniqueUsers(state.users).filter((user) => !query || userPickerSearchText(user).includes(query)).slice(0, 80);
  menu.querySelectorAll(".db-user-option").forEach((item) => item.remove());
  menu.insertAdjacentHTML("afterbegin", renderUserPickerOptions(users));
  const empty = menu.querySelector("[data-user-picker-empty]");
  if (empty) empty.hidden = users.length > 0;
  menu.hidden = false;
}

function setSelectOptions(select, items, getLabel) {
  if (!select) return;
  select.innerHTML = optionList(items, getLabel);
}

function syncContentModuleSelect(form) {
  const courseId = form?.querySelector("[data-content-course-select]")?.value || state.courses[0]?.id || "";
  const cycleSelect = form?.querySelector("[data-content-cycle-select]");
  const previousCycle = cycleSelect?.value || "";
  const cycles = courseCycles(courseId);
  if (cycleSelect) {
    cycleSelect.innerHTML = cycles.map((cycle) => `<option value="${escapeHtml(cycle)}">${escapeHtml(cycle)}</option>`).join("");
    if (cycles.includes(previousCycle)) cycleSelect.value = previousCycle;
  }
  const selectedCycle = cycleSelect?.value || cycles[0] || "";
  setSelectOptions(form?.querySelector("[data-content-module-select]"), courseModules(courseId, selectedCycle), (module) => module.title);
}

function syncAccessSelectors(form) {
  if (!form) return;
  const type = form.querySelector("[data-access-type]")?.value || "course";
  const needsModule = type === "module" || type === "download";
  const userId = form.querySelector('.db-user-picker input[type="hidden"][name="user_id"]')?.value || "";
  const courseSelect = form.querySelector("[data-access-course-select]");
  const cycleField = form.querySelector("[data-access-cycle-field]");
  const cycleSelect = form.querySelector("[data-access-cycle-select]");
  const moduleField = form.querySelector("[data-access-module-field]");
  const moduleSelect = form.querySelector("[data-access-module-select]");
  const contentField = form.querySelector("[data-access-content-field]");
  const contentSelect = form.querySelector("[data-access-content-select]");
  const availableCourses = needsModule && userId
    ? activeCourseAccessForUser(userId).map((grant) => state.courses.find((course) => course.id === grant.course_id)).filter(Boolean)
    : state.courses;
  const previousCourse = courseSelect?.value || "";
  setSelectOptions(courseSelect, availableCourses, (course) => course.title);
  if (courseSelect && availableCourses.some((course) => course.id === previousCourse)) courseSelect.value = previousCourse;
  const selectedCourse = courseSelect?.value || availableCourses[0]?.id || "";
  const previousCycle = cycleSelect?.value || "";
  const cycles = courseCycles(selectedCourse);
  if (cycleField) cycleField.hidden = !needsModule;
  if (cycleSelect) {
    cycleSelect.innerHTML = cycles.map((cycle) => `<option value="${escapeHtml(cycle)}">${escapeHtml(cycle)}</option>`).join("");
    if (cycles.includes(previousCycle)) cycleSelect.value = previousCycle;
  }
  const selectedCycle = cycleSelect?.value || cycles[0] || "";
  const previousModule = moduleSelect?.value || "";
  const modules = courseModules(selectedCourse, selectedCycle);
  if (moduleField) moduleField.hidden = !needsModule;
  if (moduleSelect) {
    moduleSelect.required = needsModule;
    setSelectOptions(moduleSelect, modules, (module) => module.title);
    if (modules.some((module) => module.id === previousModule)) moduleSelect.value = previousModule;
  }
  const selectedModule = moduleSelect?.value || modules[0]?.id || "";
  const contents = moduleFileContents(selectedModule);
  if (contentField) contentField.hidden = type !== "download";
  if (contentSelect) {
    contentSelect.required = type === "download";
    setSelectOptions(contentSelect, contents, contentOptionLabel);
  }
}

function renderAcademiaTableInput(field, value, formId) {
  const inputValue = escapeHtml(value ?? "");
  if (["summary", "description", "body"].includes(field)) {
    return `<textarea class="db-table-input hr-input" form="${escapeHtml(formId)}" name="${escapeHtml(field)}" rows="2">${inputValue}</textarea>`;
  }
  return `<input class="db-table-input hr-input" form="${escapeHtml(formId)}" name="${escapeHtml(field)}" value="${inputValue}" />`;
}

function renderAcademiaTableRow(tableName, config, row, index, visibleColumns) {
  const formId = `academy-table-form-${index}`;
  const original = encodeURIComponent(JSON.stringify(row));
  const searchText = [...config.lockedFields, ...config.editableFields]
    .map((field) => row[field])
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase();

  return `
    <tr data-search-row data-search-text="${escapeHtml(searchText)}">
      ${visibleColumns.map((field) => {
        const value = row[field] ?? "";
        const editable = config.editableFields.includes(field);
        if (!editable) return `<td class="db-table-cell--readonly"><code>${escapeHtml(value)}</code></td>`;
        return `<td class="db-table-cell--editable hr-cell-editable">${renderAcademiaTableInput(field, value, formId)}</td>`;
      }).join("")}
      <td class="db-table-cell--actions">
        <form class="db-inline-form" id="${escapeHtml(formId)}" data-academy-table-form>
          <input type="hidden" name="table_name" value="${escapeHtml(tableName)}" />
          <input type="hidden" name="original" value="${escapeHtml(original)}" />
          <button class="academia-button secondary" type="submit">Guardar</button>
        </form>
        <button class="academia-button danger" type="button" data-action="academy-table-delete" data-table-name="${escapeHtml(tableName)}" data-row-original="${escapeHtml(original)}">Eliminar</button>
      </td>
    </tr>
  `;
}

function renderAcademiaTableEditor() {
  const tableName = tableEditorConfig(state.tableEditorTable) ? state.tableEditorTable : "academy_courses";
  const config = tableEditorConfig(tableName);
  const columns = [...config.lockedFields, ...config.editableFields]
    .filter((field, index, arr) => arr.indexOf(field) === index);
  const visibleColumns = columns.filter((field) => !(config.hiddenColumns || []).includes(field));
  const query = normalizeSearchText(state.tableEditorSearch);
  const rows = tableEditorRows(tableName).filter((row) => {
    if (!query) return true;
    return columns.some((field) => normalizeSearchText(row[field]).includes(query));
  });
  const body = rows.length
    ? rows.slice(0, 200).map((row, index) => renderAcademiaTableRow(tableName, config, row, index, visibleColumns)).join("")
    : `<tr class="db-table__empty-row hr-table-empty"><td colspan="99" class="db-empty hr-table-empty">Sin filas disponibles.</td></tr>`;

  return `
    <section class="academia-table-editor" aria-label="Editor de tablas">
      <div class="academia-row">
        <div><span class="academia-kicker">BB.DD</span><h3>Editor de tablas</h3></div>
        <button class="academia-button secondary" type="button" data-action="academy-table-save-all">Guardar todo</button>
      </div>
      <div class="db-toolbar hr-table-toolbar academia-table-toolbar">
        <label class="db-field db-field--compact">
          <span>Tabla</span>
          <select data-academy-table-select aria-label="Seleccionar tabla">
            ${Object.entries(ACADEMY_TABLE_EDITOR_CONFIG).map(([key, item]) => `<option value="${escapeHtml(key)}"${key === tableName ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
        <label class="db-field db-field--compact db-field--search">
          <span>Buscar</span>
          <input data-academy-table-search placeholder="Buscar en la tabla" value="${escapeHtml(state.tableEditorSearch)}" />
          <small class="db-field__hint">${rows.length} fila${rows.length === 1 ? "" : "s"}</small>
        </label>
      </div>
      <div class="db-table-wrap hr-table-wrap">
        <table class="db-table hr-table hr-table-editable db-table--editor" aria-label="Editor de ${escapeHtml(config.label)}">
          <thead><tr>${visibleColumns.map((field) => `<th scope="col">${escapeHtml(academyTableFieldLabel(field))}</th>`).join("")}<th scope="col">Acciones</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
}
function renderAdmin() {
  const showAdmin = currentView() === "admin";
  els.admin.hidden = !showAdmin || !state.isAdmin;
  if (showAdmin && !state.isAdmin) setStatus("Necesitas permisos admin para gestionar Academia.", "error");
  if (els.admin.hidden) return;
  els.admin.innerHTML = `
    <div class="academia-row">
      <div><span class="academia-kicker">Panel admin</span><h2>Gestionar Academia</h2></div>
      <button class="academia-button secondary" type="button" data-action="refresh">Actualizar</button>
    </div>
    <div class="academia-admin-grid">
      <form class="academia-form" data-admin-form="course">
        <h3>Crear curso</h3>
        <label><span>Titulo</span><input name="title" required /></label>
        <label><span>Resumen</span><textarea name="summary" rows="3"></textarea></label>
        <label><span>Descripcion</span><textarea name="description" rows="5"></textarea></label>
        <label><span>Estado</span><select name="status"><option value="draft">Draft</option><option value="published">Publicado</option><option value="archived">Archivado</option></select></label>
        <button class="academia-button" type="submit">Crear curso</button>
      </form>
      <form class="academia-form" data-admin-form="module">
        <h3>Crear modulo</h3>
        <label><span>Curso</span><select name="course_id" required>${optionList(state.courses, (course) => course.title)}</select></label>
        <label><span>CICLO</span><input name="cycle" placeholder="Ciclo 1" /></label>
        <label><span>Titulo</span><input name="title" required /></label>
        <label><span>Resumen</span><textarea name="summary" rows="3"></textarea></label>
        <label><span>Orden</span><input name="position" type="number" min="1" value="1" /></label>
        <button class="academia-button" type="submit">Agregar modulo</button>
      </form>
      <form class="academia-form" data-admin-form="content">
        <h3>Agregar contenido</h3>
        <label><span>Curso</span><select name="content_course_id" data-content-course-select required>${optionList(state.courses, (course) => course.title)}</select></label>
        <label><span>CICLO</span><select name="content_cycle" data-content-cycle-select>${courseCycles(state.courses[0]?.id).map((cycle) => `<option value="${escapeHtml(cycle)}">${escapeHtml(cycle)}</option>`).join("")}</select></label>
        <label><span>Modulo</span><select name="module_id" data-content-module-select required>${optionList(courseModules(state.courses[0]?.id, courseCycles(state.courses[0]?.id)[0] || ""), (module) => module.title)}</select></label>
        <label><span>Titulo</span><input name="title" required /></label>
        <label><span>Tipo</span><select name="content_type" data-content-type-select><option value="text">Texto</option><option value="video">Video</option><option value="link">Link</option><option value="file">Archivo</option></select></label>
        <label data-content-file-field hidden><span>Archivo</span><input name="content_file" type="file" data-content-file /><small class="academia-hint">Se guardara en Cloud como contenido general del curso.</small></label>
        <div class="db-upload-progress" data-content-upload-progress hidden>
          <div class="db-upload-progress__head">
            <span data-content-upload-progress-label>Esperando archivo</span>
            <strong data-content-upload-progress-value>0%</strong>
          </div>
          <div class="db-upload-progress__track" aria-hidden="true"><span data-content-upload-progress-bar style="width:0%"></span></div>
        </div>
        <label><span>URL</span><input name="url" type="url" /></label>
        <label><span>Contenido</span><textarea name="body" rows="5"></textarea></label>
        <label><span>Orden</span><input name="position" type="number" min="1" value="1" /></label>
        <button class="academia-button" type="submit">Guardar contenido</button>
      </form>
      <form class="academia-form" data-admin-form="access">
        <h3>Dar acceso</h3>
        ${renderUserPicker("user_id", "Usuario")}
        <label><span>Tipo de acceso</span><select name="access_type" data-access-type><option value="course">Curso</option><option value="module">Modulo</option><option value="download">Descarga</option></select></label>
        <label><span>Curso</span><select name="course_id" data-access-course-select required>${optionList(state.courses, (course) => course.title)}</select></label>
        <label data-access-cycle-field hidden><span>CICLO</span><select name="access_cycle" data-access-cycle-select>${courseCycles(state.courses[0]?.id).map((cycle) => `<option value="${escapeHtml(cycle)}">${escapeHtml(cycle)}</option>`).join("")}</select></label>
        <label data-access-module-field hidden><span>Modulo</span><select name="module_id" data-access-module-select>${optionList(courseModules(state.courses[0]?.id, courseCycles(state.courses[0]?.id)[0] || ""), (module) => module.title)}</select></label>
        <label data-access-content-field hidden><span>Contenido</span><select name="content_id" data-access-content-select></select></label>
        <label><span>Estado</span><select name="status"><option value="active">Activo</option><option value="revoked">Revocado</option><option value="completed">Completado</option></select></label>
        <button class="academia-button" type="submit">Asignar acceso</button>
      </form>
    </div>
    ${renderAcademiaTableEditor()}
  `;
}

async function loadAcademia() {
  setStatus("Cargando Academia...");
  const hiddenRoomSupabase = await waitForHiddenRoomSupabase();
  state.supabase = await hiddenRoomSupabase.getClient();
  const { data: userData } = await state.supabase.auth.getUser();
  state.user = userData?.user || null;

  if (state.user) {
    const { data: profile } = await state.supabase.from("users").select("id,user_id,email,display_name,username,roles").eq("id", state.user.id).maybeSingle();
    state.profile = profile || null;
    const roleAdmin = String(profile?.roles || "").split(",").map((role) => role.trim().toLowerCase()).includes("admin");
    const { data: academiaAdmin } = await state.supabase.rpc("has_academia_admin_permission");
    state.isAdmin = Boolean(roleAdmin || academiaAdmin);
    if (els.user) els.user.textContent = profile?.display_name || profile?.username || state.user.email || "Usuario";
  } else if (els.user) {
    els.user.textContent = "Sesion no iniciada";
  }

  const [coursesRes, modulesRes, contentsRes, contentFilesRes, courseAccessRes, moduleAccessRes, downloadAccessRes] = await Promise.all([
    state.supabase.from("academy_courses").select("*").order("created_at", { ascending: false }),
    state.supabase.from("academy_course_modules").select("*").order("position", { ascending: true }),
    state.supabase.from("academy_module_contents").select("*").order("position", { ascending: true }),
    state.supabase.from("academy_content_files").select("*").order("created_at", { ascending: false }),
    state.user ? state.supabase.from("academy_course_access").select("*") : Promise.resolve({ data: [] }),
    state.user ? state.supabase.from("academy_module_access").select("*") : Promise.resolve({ data: [] }),
    state.user ? state.supabase.from("academy_content_download_access").select("*") : Promise.resolve({ data: [] }),
  ]);
  const error = firstError([coursesRes, modulesRes, contentsRes, contentFilesRes, courseAccessRes, moduleAccessRes, downloadAccessRes]);
  if (error) throw error;

  state.courses = coursesRes.data || [];
  state.modules = modulesRes.data || [];
  state.contents = contentsRes.data || [];
  state.contentFiles = contentFilesRes.data || [];
  state.courseAccess = courseAccessRes.data || [];
  state.moduleAccess = moduleAccessRes.data || [];
  state.downloadAccess = downloadAccessRes.data || [];

  if (state.isAdmin) {
    const { data: users, error: usersError } = await state.supabase.from("users").select("id,user_id,email,display_name,username").order("display_name", { ascending: true });
    if (usersError) throw usersError;
    state.users = users || [];
    window.HiddenRoomNavigation?.setAdminLinksVisible?.(true);
  }

  setStatus("");
  renderCourses();
  renderAdmin();
}

async function reloadAfterMutation(message) {
  setStatus(message || "Guardado.");
  await loadAcademia();
}

async function handleAdminSubmit(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const kind = form.dataset.adminForm;
  if (kind === "course") {
    const title = String(data.title || "").trim();
    const payload = { title, slug: slugify(title), summary: data.summary || null, description: data.description || null, status: data.status || "draft", created_by: state.user.id };
    const { error } = await state.supabase.from("academy_courses").insert(payload);
    if (error) throw error;
    form.reset();
    await reloadAfterMutation("Curso creado.");
  }
  if (kind === "module") {
    const courseId = String(data.course_id || "").trim();
    const title = String(data.title || "").trim();
    const cycle = String(data.cycle || "").trim();
    if (!courseId) throw new Error("Selecciona un curso antes de crear el modulo.");
    if (!title) throw new Error("Escribe el titulo del modulo.");
    const payload = { course_id: courseId, cycle: cycle || null, title, summary: data.summary || null, position: Number(data.position || 1) };
    const { error } = await state.supabase.from("academy_course_modules").insert(payload, { returning: "minimal" });
    if (error) throw new Error(supabaseErrorMessage(error));
    form.reset();
    await reloadAfterMutation("Modulo creado.");
  }
  if (kind === "content") {
    const contentType = data.content_type || "text";
    const file = form.querySelector("[data-content-file]")?.files?.[0] || null;
    let contentRow = null;
    if (contentType === "file" && !file) throw new Error("Selecciona un archivo para subir a Cloud.");
    try {
      if (contentType === "file") {
        setFormPending(form, true, "Subiendo...");
        setContentUploadProgress(form, 6, "Validando archivo");
      }
      const payload = { module_id: data.module_id, title: data.title, content_type: contentType, url: data.url || null, body: data.body || null, position: Number(data.position || 1), created_by: state.user.id };
      const { data: insertedContent, error } = await state.supabase.from("academy_module_contents").insert(payload).select("id,module_id,title").maybeSingle();
      if (error) throw error;
      contentRow = insertedContent;
      if (contentType === "file" && file && contentRow?.id) {
        const module = state.modules.find((item) => item.id === data.module_id);
        const course = state.courses.find((item) => item.id === module?.course_id);
        setContentUploadProgress(form, 18, "Preparando Cloud");
        setContentUploadProgress(form, 42, "Subiendo archivo");
        const upload = await uploadAcademiaCloudFile(file, academyContentCloudPath(course, module));
        setContentUploadProgress(form, 78, "Registrando archivo");
        const filePayload = {
          content_id: contentRow.id,
          file_name: upload.fileName,
          storage_path: upload.url,
          cloud_path: upload.cloudPath,
          mime_type: upload.mimeType,
          file_size: upload.fileSize,
          uploaded_by: state.user.id,
        };
        const { error: fileError } = await state.supabase.from("academy_content_files").insert(filePayload);
        if (fileError) throw fileError;
        setContentUploadProgress(form, 100, "Archivo cargado");
      }
      form.reset();
      setFormPending(form, false);
      await reloadAfterMutation("Contenido guardado.");
    } catch (error) {
      if (contentType === "file") setContentUploadProgress(form, 100, "Error al subir");
      if (contentRow?.id) await state.supabase.from("academy_module_contents").delete().eq("id", contentRow.id).catch(() => {});
      setFormPending(form, false);
      throw error;
    }
  }
  if (kind === "access") {
    if (!data.user_id) throw new Error("Selecciona un usuario de la lista.");
    if (data.access_type === "download") {
      if (!data.content_id) throw new Error("Selecciona un contenido con archivo.");
      const payload = { content_id: data.content_id, user_id: data.user_id, status: data.status || "active", granted_by: state.user.id };
      const { error } = await state.supabase.from("academy_content_download_access").upsert(payload, { onConflict: "content_id,user_id" });
      if (error) throw error;
      await reloadAfterMutation("Descarga habilitada.");
      return;
    }
    if (data.access_type === "module") {
      if (!data.module_id) throw new Error("Selecciona un modulo.");
      const payload = { module_id: data.module_id, user_id: data.user_id, status: data.status || "active", granted_by: state.user.id };
      const { error } = await state.supabase.from("academy_module_access").upsert(payload, { onConflict: "module_id,user_id" });
      if (error) throw error;
      await reloadAfterMutation("Modulo liberado.");
      return;
    }
    const payload = { course_id: data.course_id, user_id: data.user_id, status: data.status || "active", granted_by: state.user.id };
    const { error } = await state.supabase.from("academy_course_access").upsert(payload, { onConflict: "course_id,user_id" });
    if (error) throw error;
    await reloadAfterMutation("Acceso a curso actualizado.");
  }
}

function academyTableFormValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function parseAcademiaOriginal(encoded) {
  return JSON.parse(decodeURIComponent(encoded));
}

function collectAcademiaTableChange(form) {
  const values = academyTableFormValues(form);
  const tableName = values.table_name;
  const config = tableEditorConfig(tableName);
  const original = parseAcademiaOriginal(values.original);
  const payload = {};
  const changes = [];
  config.editableFields.forEach((field) => {
    if (!(field in values)) return;
    const nextValue = normalizeTableValue(field, values[field]);
    const before = original[field] ?? null;
    if (String(before ?? "") === String(nextValue ?? "")) return;
    payload[field] = nextValue;
    changes.push(field);
  });
  if (!changes.length) return null;
  return { tableName, config, original, payload, changes };
}

async function saveAcademiaTableRow(change) {
  const { tableName, config, original, payload } = change;
  if (!Object.keys(payload).length) return true;
  const { error } = await state.supabase
    .from(tableName)
    .update(payload)
    .eq(config.primaryKey, original[config.primaryKey]);
  if (error) throw new Error(supabaseErrorMessage(error));
  return true;
}

async function handleAcademiaTableUpdate(form) {
  const change = collectAcademiaTableChange(form);
  if (!change) {
    setStatus("No hay cambios pendientes.");
    return;
  }
  await saveAcademiaTableRow(change);
  await reloadAfterMutation("Fila actualizada.");
}

async function handleAcademiaTableSaveAll() {
  const forms = [...document.querySelectorAll("form[data-academy-table-form]")];
  const changes = forms.map(collectAcademiaTableChange).filter(Boolean);
  if (!changes.length) {
    setStatus("No hay cambios pendientes.");
    return;
  }
  const preview = changes.slice(0, 12).map((item, index) => `${index + 1}. ${academyRowLabel(item.original)} (${item.changes.join(", ")})`).join("\n");
  const extra = changes.length > 12 ? `\n... y ${changes.length - 12} filas mas.` : "";
  if (!window.confirm(`Vas a guardar ${changes.length} fila${changes.length === 1 ? "" : "s"}:\n\n${preview}${extra}\n\nConfirmas guardar estos cambios?`)) return;
  for (const change of changes) await saveAcademiaTableRow(change);
  await reloadAfterMutation("Cambios guardados.");
}

async function handleAcademiaTableDelete(tableName, encodedRow) {
  const config = tableEditorConfig(tableName);
  const original = parseAcademiaOriginal(encodedRow);
  if (!window.confirm(`Vas a eliminar ${academyRowLabel(original)} de ${config.label}. Esta accion no se puede deshacer. Confirmas?`)) return;
  const { error } = await state.supabase
    .from(tableName)
    .delete({ count: "exact" })
    .eq(config.primaryKey, original[config.primaryKey]);
  if (error) throw new Error(supabaseErrorMessage(error));
  await reloadAfterMutation("Fila eliminada.");
}
function syncContentFileField(form) {
  if (!form) return;
  const type = form.querySelector("[data-content-type-select]")?.value || "text";
  const field = form.querySelector("[data-content-file-field]");
  const input = form.querySelector("[data-content-file]");
  if (field) field.hidden = type !== "file";
  if (input) input.required = type === "file";
  if (type !== "file") resetContentUploadProgress(form);
}
function bindEvents() {
  document.addEventListener("click", (event) => {
    const userOption = event.target.closest(".db-user-option[data-user-value]");
    if (userOption) {
      const picker = userOption.closest(".db-user-picker");
      const hidden = picker?.querySelector('input[type="hidden"]');
      const search = picker?.querySelector("[data-user-search]");
      const user = state.users.find((item) => String(item.id) === String(userOption.dataset.userValue));
      if (hidden) hidden.value = userOption.dataset.userValue || "";
      if (search) search.value = userOption.dataset.userDisplay || userName(user);
      picker?.querySelector(".db-user-picker__menu")?.setAttribute("hidden", "");
      syncAccessSelectors(picker?.closest("form"));
      return;
    }

    const cloudView = event.target.closest("[data-academia-cloud-view]");
    if (cloudView) {
      event.preventDefault();
      viewAcademiaCloudFile(cloudView).catch((error) => { console.error("Academia cloud view failed", error); setStatus(supabaseErrorMessage(error), "error"); });
      return;
    }

    const cloudDownload = event.target.closest("[data-academia-cloud-download]");
    if (cloudDownload) {
      event.preventDefault();
      downloadAcademiaCloudFile(cloudDownload).catch((error) => { console.error("Academia cloud download failed", error); setStatus(supabaseErrorMessage(error), "error"); });
      return;
    }

    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "open-course") renderDetail(action.dataset.courseId);
    if (action.dataset.action === "close-detail") els.detail.hidden = true;
    if (action.dataset.action === "refresh") loadAcademia().catch((error) => setStatus(error.message, "error"));
    if (action.dataset.action === "academy-table-save-all") handleAcademiaTableSaveAll().catch((error) => { console.error("Academia table save all failed", error); setStatus(supabaseErrorMessage(error), "error"); });
    if (action.dataset.action === "academy-table-delete") handleAcademiaTableDelete(action.dataset.tableName, action.dataset.rowOriginal).catch((error) => { console.error("Academia table delete failed", error); setStatus(supabaseErrorMessage(error), "error"); });
  });

  document.addEventListener("change", (event) => {
    const tableSelect = event.target.closest("[data-academy-table-select]");
    if (tableSelect) {
      state.tableEditorTable = tableSelect.value;
      state.tableEditorSearch = "";
      renderAdmin();
      return;
    }
    const contentType = event.target.closest("[data-content-type-select]");
    if (contentType) {
      syncContentFileField(contentType.closest("form"));
      return;
    }
    const contentCourse = event.target.closest("[data-content-course-select], [data-content-cycle-select]");
    if (contentCourse) {
      syncContentModuleSelect(contentCourse.closest("form"));
      return;
    }
    const accessControl = event.target.closest("[data-access-type], [data-access-course-select], [data-access-cycle-select], [data-access-module-select]");
    if (accessControl) syncAccessSelectors(accessControl.closest("form"));
  });

  document.addEventListener("input", (event) => {
    const tableSearch = event.target.closest("[data-academy-table-search]");
    if (tableSearch) {
      state.tableEditorSearch = tableSearch.value;
      renderAdmin();
      const nextSearch = document.querySelector("[data-academy-table-search]");
      nextSearch?.focus();
      return;
    }
    const search = event.target.closest("[data-user-search]");
    if (search) filterUserPicker(search, true);
  });

  document.addEventListener("focusin", (event) => {
    const search = event.target.closest?.("[data-user-search]");
    if (search) filterUserPicker(search, false);
  });

  document.addEventListener("focusout", (event) => {
    const picker = event.target.closest?.(".db-user-picker");
    if (!picker) return;
    window.setTimeout(() => {
      if (!picker.contains(document.activeElement)) picker.querySelector(".db-user-picker__menu")?.setAttribute("hidden", "");
    }, 80);
  });

  document.addEventListener("submit", (event) => {
    const tableForm = event.target.closest("form[data-academy-table-form]");
    if (tableForm) {
      event.preventDefault();
      handleAcademiaTableUpdate(tableForm).catch((error) => { console.error("Academia table update failed", error); setStatus(supabaseErrorMessage(error), "error"); });
      return;
    }
    const form = event.target.closest("[data-admin-form]");
    if (!form) return;
    event.preventDefault();
    handleAdminSubmit(form).catch((error) => { console.error("Academia admin submit failed", error); setStatus(supabaseErrorMessage(error), "error"); });
  });
}

bindEvents();
loadAcademia().catch((error) => {
  console.info("[Academia]", error?.message || error);
  setStatus(error?.message || "No se pudo cargar Academia.", "error");
});
