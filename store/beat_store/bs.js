import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://rpcunbkstadgngqrjafp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO";
const CART_STORAGE_KEY = "hidden_room_store_cart";
const CLOUD_ORIGIN = "https://cloud.hiddenroom.mx";
const BEAT_STORE_ENDPOINT = `${CLOUD_ORIGIN}/api/beat-store`;
const BEAT_STORE_CLOUD_PATH = "/beats_store";
const supabase = window.HiddenRoomSupabase?.getClient
  ? await window.HiddenRoomSupabase.getClient()
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const state = { products: [], adminProducts: [], beats: [], items: [], licenses: [], assignments: [], durationDetections: new Set(), isAdmin: false, currentUserId: null, hasBeatMetadata: true, hasBeatLicenses: true, hasBeatPreviews: true };

const grid = document.getElementById("beat-grid");
const searchInput = document.getElementById("beat-search");
const sortSelect = document.getElementById("beat-sort");
const genreSelect = document.getElementById("beat-genre");
const adminPanel = document.getElementById("beat-admin-panel");
const adminForm = document.getElementById("beat-admin-form");
const adminList = document.getElementById("beat-admin-products");
const adminStatus = document.getElementById("beat-admin-status");
const adminError = document.getElementById("beat-admin-error");
const cancelEditButton = document.getElementById("beat-cancel-edit");
const beatUploadInput = document.getElementById("beat-upload-file");
const beatCoverInput = document.getElementById("beat-cover-file");
const beatUploadStatus = document.getElementById("beat-upload-status");
const beatSubmitButton = document.getElementById("beat-submit-button");
const beatCoverEditor = document.getElementById("beat-cover-editor");
const beatCoverPreview = document.getElementById("beat-cover-preview");
const beatCoverStage = document.querySelector(".beat-cover-editor__stage");
const beatLicenseAssignmentList = document.getElementById("beat-license-assignment-list");
const beatLicenseForm = document.getElementById("beat-license-form");
const beatLicenseList = document.getElementById("beat-license-list");
const beatLicenseStatus = document.getElementById("beat-license-status");
const beatLicenseError = document.getElementById("beat-license-error");
const beatLicenseWarning = document.getElementById("beat-license-warning");
const beatLicenseCancel = document.getElementById("beat-license-cancel");
const beatLicenseModal = document.getElementById("beat-license-modal");
const beatLicenseModalTitle = document.getElementById("beat-license-modal-title");
const beatLicenseModalSubtitle = document.getElementById("beat-license-modal-subtitle");
const beatLicenseModalContent = document.getElementById("beat-license-modal-content");
let beatCoverObjectUrl = "";
const beatCoverCropState = { x: 0.5, y: 0.5, zoom: 1 };
const beatCoverPointers = new Map();
let beatCoverDragStart = null;
let beatCoverPinchStart = null;

initBeatStore().catch((error) => {
  grid.innerHTML = errorState(error.message || "No se pudo cargar Beat Store.");
});

async function initBeatStore() {
  updateCartCount();
  state.isAdmin = await currentUserIsAdmin();
  const [products, beats, licenses] = await Promise.all([fetchBeatProducts(state.isAdmin), fetchCloudBeats(), fetchBeatLicenses(state.isAdmin)]);
  state.products = products;
  state.adminProducts = state.isAdmin ? products : [];
  state.beats = beats;
  state.licenses = licenses;
  state.assignments = await fetchBeatLicenseAssignments(products.map((product) => product.id), state.isAdmin);
  state.items = mergeProductsAndBeats(products, beats);
  renderGenreOptions();
  renderBeats();
  initializeAdminPanel();

  window.addEventListener("popstate", () => {
    if (state.isAdmin) setAdminMode(wantsAdminMode());
  });

  searchInput?.addEventListener("input", renderBeats);
  sortSelect?.addEventListener("change", renderBeats);
  genreSelect?.addEventListener("change", renderBeats);
  grid?.addEventListener("click", handleGridClick);
  grid?.addEventListener("keydown", handleGridKeydown);
  window.addEventListener("hr:beat-player-state", syncBeatCardPlayState);
  adminForm?.addEventListener("submit", handleAdminSubmit);
  adminForm?.addEventListener("change", handleBeatLicenseAssignmentChange);
  adminList?.addEventListener("click", handleAdminListClick);
  beatLicenseForm?.addEventListener("submit", handleBeatLicenseSubmit);
  beatLicenseList?.addEventListener("click", handleBeatLicenseListClick);
  beatLicenseCancel?.addEventListener("click", resetBeatLicenseForm);
  beatLicenseForm?.addEventListener("input", updateBeatLicenseRangeWarning);
  document.getElementById("beat-license-unlimited")?.addEventListener("change", syncBeatLicenseStreamLimitState);
  cancelEditButton?.addEventListener("click", resetAdminForm);
  beatCoverInput?.addEventListener("change", handleBeatCoverSelection);
  beatUploadInput?.addEventListener("change", handleBeatAudioSelection);
  adminForm?.addEventListener("click", handleBeatAutodetectSoonClick);
  beatCoverStage?.addEventListener("pointerdown", handleBeatCoverPointerDown);
  beatCoverStage?.addEventListener("pointermove", handleBeatCoverPointerMove);
  beatCoverStage?.addEventListener("pointerup", handleBeatCoverPointerEnd);
  beatCoverStage?.addEventListener("pointercancel", handleBeatCoverPointerEnd);
  beatCoverStage?.addEventListener("lostpointercapture", handleBeatCoverPointerEnd);
  beatCoverStage?.addEventListener("wheel", handleBeatCoverWheel, { passive: false });
  beatCoverStage?.addEventListener("dblclick", resetBeatCoverCrop);
  document.addEventListener("click", handleAdminModeClick);
  beatLicenseModal?.addEventListener("click", handleBeatLicenseModalClick);
  document.addEventListener("keydown", handleBeatLicenseModalKeydown);
}

function ensureAdminMusicFields() {
  if (!adminForm || document.getElementById("beat-genre-input")) return;
  const producerField = document.getElementById("beat-producer")?.closest(".field");
  if (!producerField) return;

  const wrapper = document.createElement("div");
  wrapper.className = "beat-admin__music-fields";
  wrapper.innerHTML = `
    <div class="field hr-field"><label class="hr-label" for="beat-genre-input">Género</label><input class="hr-input" id="beat-genre-input" maxlength="80" placeholder="Trap, Boom bap, Reggaeton..."></div>
    <div class="field hr-field beat-autodetect-field"><label class="hr-label" for="beat-bpm">BPM</label><input class="hr-input" id="beat-bpm" type="number" min="1" max="300" step="1"><button class="secondary-button beat-autodetect-button" type="button" data-autodetect-soon="BPM">Autodetectar</button></div>
    <div class="field hr-field beat-autodetect-field"><label class="hr-label" for="beat-key">Tonalidad</label><input class="hr-input" id="beat-key" maxlength="24" placeholder="Cm, F# minor..."><button class="secondary-button beat-autodetect-button" type="button" data-autodetect-soon="tonalidad">Autodetectar</button></div>
    <input id="beat-duration" type="hidden">
  `;
  producerField.insertAdjacentElement("afterend", wrapper);
}

function adminProductMetaText(product) {
  return [
    product.beat_genre || null,
    product.beat_bpm ? `${product.beat_bpm} BPM` : null,
    product.beat_key || null,
    product.beat_duration_seconds ? formatDuration(product.beat_duration_seconds) : null,
  ].filter(Boolean).join(" / ");
}
function wantsAdminMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "admin" || params.get("admin") === "1";
}

function setAdminMode(active) {
  const isActive = Boolean(active);
  document.body.classList.toggle("beat-admin-mode", isActive);
  if (adminPanel) adminPanel.hidden = !isActive;
  syncAdminSubNavState(isActive);
}

function syncAdminSubNavState(active) {
  document.querySelectorAll('.hr-nav__sub-link[href="/store/beat_store/"]').forEach((link) => {
    if (active) {
      link.removeAttribute("aria-current");
    } else {
      link.setAttribute("aria-current", "page");
    }
  });
  document.querySelectorAll('.hr-nav__sub-link[href="/store/beat_store/?view=admin"]').forEach((link) => {
    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function ensureAdminEntryLink() {
  if (!state.isAdmin || document.querySelector("[data-beat-admin-entry]")) return;
  const actions = document.querySelector(".beat-hero__actions");
  if (!actions) return;
  const button = document.createElement("button");
  button.className = "secondary-button hr-btn";
  button.type = "button";
  button.dataset.beatAdminEntry = "true";
  button.textContent = "Admin beats";
  actions.appendChild(button);
}

function handleBeatLicenseAssignmentChange(event) {
  const checkbox = event.target.closest("[data-beat-license-check]");
  if (!checkbox) return;
  const input = beatLicenseAssignmentList?.querySelector(`[data-beat-license-price="${CSS.escape(checkbox.dataset.beatLicenseCheck)}"]`);
  if (input) input.disabled = !checkbox.checked;
}
function handleAdminModeClick(event) {
  const adminEntry = event.target.closest("[data-beat-admin-entry]");
  const storeEntry = event.target.closest("[data-beat-store-entry]");
  if (adminEntry) {
    event.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set("view", "admin");
    url.hash = "";
    history.pushState(null, "", url);
    setAdminMode(true);
    requestAnimationFrame(() => adminPanel?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return;
  }
  if (storeEntry) {
    event.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    url.searchParams.delete("admin");
    url.hash = "";
    history.pushState(null, "", url);
    setAdminMode(false);
    requestAnimationFrame(() => document.getElementById("beat-store-title")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
}

async function currentUserIsAdmin() {
  const { data: { session } } = await supabase.auth.getSession();
  state.currentUserId = session?.user?.id ?? null;
  if (!session?.user) return false;

  const { data: profile, error } = await supabase
    .from("users")
    .select("roles")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) return false;
  return String(profile?.roles ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");
}

const BEAT_PRODUCT_BASE_SELECT = "id, slug, name, description, category, price, currency, image_url, beat_cover_path, beat_thumb_path, file_url, producer, stock, is_digital, featured, is_active, created_at";
const BEAT_PRODUCT_META_SELECT = `${BEAT_PRODUCT_BASE_SELECT}, producer_user_id, beat_genre, beat_bpm, beat_key, beat_duration_seconds`;
const BEAT_PRODUCT_PREVIEW_SELECT = `${BEAT_PRODUCT_META_SELECT}, beat_original_path, beat_preview_path, beat_preview_status, beat_preview_error`;

async function fetchBeatProducts(includeInactive = false) {
  const columns = state.hasBeatPreviews
    ? BEAT_PRODUCT_PREVIEW_SELECT
    : (state.hasBeatMetadata ? BEAT_PRODUCT_META_SELECT : BEAT_PRODUCT_BASE_SELECT);
  const { data, error } = await runBeatProductQuery(includeInactive, columns);

  if (!error) return data ?? [];

  if (state.hasBeatPreviews && isMissingBeatPreviewError(error)) {
    state.hasBeatPreviews = false;
    const fallback = await runBeatProductQuery(includeInactive, state.hasBeatMetadata ? BEAT_PRODUCT_META_SELECT : BEAT_PRODUCT_BASE_SELECT);
    if (!fallback.error) return fallback.data ?? [];
    throw new Error(`No se pudieron cargar productos: ${fallback.error.message}`);
  }

  if (state.hasBeatMetadata && isMissingBeatMetadataError(error)) {
    state.hasBeatMetadata = false;
    const fallback = await runBeatProductQuery(includeInactive, BEAT_PRODUCT_BASE_SELECT);
    if (!fallback.error) return fallback.data ?? [];
    throw new Error(`No se pudieron cargar productos: ${fallback.error.message}`);
  }

  throw new Error(`No se pudieron cargar productos: ${error.message}`);
}

function runBeatProductQuery(includeInactive, columns) {
  let query = supabase
    .from("store_products")
    .select(columns)
    .eq("category", "beats")
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false });

  if (!includeInactive) query = query.eq("is_active", true);
  return query;
}

function isMissingBeatPreviewError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703" && ["beat_original_path", "beat_preview_path", "beat_preview_status", "beat_preview_error"].some((column) => message.includes(column));
}

function isMissingBeatMetadataError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703" || ["beat_genre", "beat_bpm", "beat_key", "beat_duration_seconds", "producer_user_id"].some((column) => message.includes(column));
}

async function fetchBeatLicenses(includeInactive = false) {
  if (!state.hasBeatLicenses) return [];
  let query = supabase
    .from("beat_licenses")
    .select("id, name, min_price, max_price, description, terms, stream_limit, unlimited_streams, format, is_active, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) {
    if (isMissingBeatLicensesError(error)) {
      state.hasBeatLicenses = false;
      return [];
    }
    throw new Error(`No se pudieron cargar licencias: ${error.message}`);
  }
  return data ?? [];
}

async function fetchBeatLicenseAssignments(beatIds, includeDisabled = false) {
  if (!state.hasBeatLicenses || !beatIds.length) return [];
  let query = supabase
    .from("beat_license_assignments")
    .select("id, beat_id, license_id, price, is_enabled, beat_licenses(id, name, min_price, max_price, description, terms, stream_limit, unlimited_streams, format, is_active)")
    .in("beat_id", beatIds);
  if (!includeDisabled) query = query.eq("is_enabled", true);
  const { data, error } = await query;
  if (error) {
    if (isMissingBeatLicensesError(error)) {
      state.hasBeatLicenses = false;
      return [];
    }
    throw new Error(`No se pudieron cargar asignaciones de licencias: ${error.message}`);
  }
  return data ?? [];
}

function isMissingBeatLicensesError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "42703" || message.includes("beat_licenses") || message.includes("beat_license_assignments");
}
async function fetchCloudBeats() {
  const response = await fetch(BEAT_STORE_ENDPOINT, { headers: { Accept: "application/json" } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "No se pudo leer beats_store en Cloud.");
  return Array.isArray(result.beats) ? result.beats : [];
}

function mergeProductsAndBeats(products, beats) {
  const beatBySlug = new Map();
  const beatByTitle = new Map();
  const beatByFilePath = new Map();
  const beatByFileName = new Map();
  for (const beat of beats) {
    beatBySlug.set(normalizeKey(beat.slug), beat);
    beatByTitle.set(normalizeKey(beat.title), beat);
    beatByFilePath.set(normalizeKey(BEAT_STORE_CLOUD_PATH + '/' + beat.file), beat);
    beatByFilePath.set(normalizeKey(beat.file), beat);
    beatByFileName.set(normalizeKey(cloudFileName(beat.file)), beat);
  }

  return products.map((product) => {
    const beat = beatByFilePath.get(normalizeKey(product.file_url))
      || beatByFileName.get(normalizeKey(cloudFileName(product.file_url)))
      || beatBySlug.get(normalizeKey(product.slug))
      || beatByTitle.get(normalizeKey(product.name))
      || null;
    return { id: 'product:' + product.id, beat, product };
  });
}
function renderBeats() {
  const query = String(searchInput?.value || "").trim().toLowerCase();
  const genre = String(genreSelect?.value || "").trim();
  const sorted = sortItems(state.items, sortSelect?.value || "featured");
  const filtered = sorted.filter((item) => {
    const product = item.product;
    const beat = item.beat;
    const haystack = [
      product?.name,
      product?.description,
      product?.producer,
      product?.slug,
      beat?.title,
      beat?.file,
      beat?.slug,
      beatGenre(item),
      itemMusicMeta(item).map((entry) => entry.value).join(" "),
    ].filter(Boolean).join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesGenre = !genre || normalizeKey(beatGenre(item)) === genre;
    return matchesQuery && matchesGenre;
  });

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state beat-empty"><h2>Sin beats</h2><p>${query ? "Prueba otra búsqueda." : "No hay beats activos publicados."}</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(beatCardMarkup).join("");
  hydrateMissingBeatDurations(filtered);
}

function hydrateMissingBeatDurations(items) {
  for (const item of items) {
    if (itemDurationSeconds(item)) continue;
    const previewUrl = previewUrlForItem(item);
    if (!previewUrl || state.durationDetections.has(item.id)) continue;
    state.durationDetections.add(item.id);
    detectAudioDurationFromUrl(previewUrl)
      .then(async (seconds) => {
        setItemDuration(item, seconds);
        updateBeatCardMeta(item);
        if (item.product?.id && state.isAdmin) {
          await supabase
            .from("store_products")
            .update({ beat_duration_seconds: seconds })
            .eq("id", item.product.id);
        }
      })
      .catch(() => {
        state.durationDetections.delete(item.id);
      });
  }
}

function updateBeatCardMeta(item) {
  const card = grid?.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`);
  const slot = card?.querySelector(".beat-card__meta-slot");
  if (!slot) return;
  slot.innerHTML = musicMetaMarkup(itemMusicMeta(item));
}

function itemDurationSeconds(item) {
  return Number(item?.product?.beat_duration_seconds || item?.beat?.duration_seconds || item?.beat?.duration || 0) || 0;
}

function setItemDuration(item, seconds) {
  if (item.product) item.product.beat_duration_seconds = seconds;
  else if (item.beat) item.beat.duration_seconds = seconds;
}

function detectAudioDurationFromUrl(url) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audio.onloadedmetadata = () => {
      const seconds = Math.round(audio.duration || 0);
      if (Number.isFinite(seconds) && seconds > 0) resolve(seconds);
      else reject(new Error("Duracion invalida"));
    };
    audio.onerror = () => reject(new Error("No se pudo leer el audio"));
    audio.src = url;
  });
}
function renderGenreOptions() {
  if (!genreSelect) return;
  const current = genreSelect.value;
  const genres = Array.from(new Map(state.items
    .map((item) => beatGenre(item))
    .filter(Boolean)
    .map((genre) => [normalizeKey(genre), genre])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]));
  genreSelect.innerHTML = `<option value="">Todos</option>${genres.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}`;
  genreSelect.value = genres.some(([value]) => value === current) ? current : "";
}

function sortItems(items, mode) {
  return [...items].sort((a, b) => {
    if (mode === "name") return itemTitle(a).localeCompare(itemTitle(b));
    if (mode === "newest") return String(b.beat?.modified || "").localeCompare(String(a.beat?.modified || ""));
    return Number(Boolean(b.product?.featured)) - Number(Boolean(a.product?.featured)) || itemTitle(a).localeCompare(itemTitle(b));
  });
}

function beatCardMarkup(item) {
  const product = item.product;
  const title = itemTitle(item);
  const canPreview = Boolean(previewUrlForItem(item));
  const canBuy = Boolean(product && productCanBePurchased(product));
  const producer = productProducer(item);
  const meta = itemMusicMeta(item);

  return `
    <article class="product-card beat-card" data-item-id="${escapeHtml(item.id)}">
      ${coverMarkup(item)}
      <div class="beat-card__body">
        <h3>${escapeHtml(title)}</h3>
        <p class="beat-card__producer">${escapeHtml(producer || "Productor por confirmar")}</p>
        <div class="beat-card__meta-slot">${musicMetaMarkup(meta)}</div>
      </div>
      <div class="beat-card__actions">
        <button class="primary-button" type="button" data-add-beat="${escapeHtml(item.id)}" ${canBuy ? "" : "disabled"} aria-expanded="false">Ver licencias</button>
      </div>    </article>`;
}

function beatLicensesContentMarkup(item) {
  if (!item?.product) return '<p class="beat-license-empty">Licencias no disponibles para este beat.</p>';
  const licenses = availableBeatLicenses(item);
  if (!licenses.length) return '<p class="beat-license-empty">Este beat todavia no tiene licencias habilitadas.</p>';
  return `
    <div class="beat-license-list">
      ${licenses.map((license) => `
        <article class="beat-license-option">
          <header>
            <div>
              <h5>${escapeHtml(license.name)}</h5>
              <p>${escapeHtml(license.description)}</p>
            </div>
            <strong>${escapeHtml(formatPrice(license.price, item.product.currency))}</strong>
          </header>
          <dl>
            <div><dt>Limite</dt><dd>${escapeHtml(license.streams)}</dd></div>
            ${license.format ? `<div><dt>Formato</dt><dd>${escapeHtml(license.format)}</dd></div>` : ""}
          </dl>
          ${license.terms ? `<p class="beat-license-terms">${escapeHtml(license.terms)}</p>` : ""}
          <div class="beat-license-actions">
            <button class="secondary-button" type="button" data-license-soon data-license-id="${escapeHtml(license.id)}">Comprar proximamente</button>
            <button class="secondary-button" type="button" data-license-soon data-license-id="${escapeHtml(license.id)}">Anadir al carrito proximamente</button>
          </div>
        </article>
      `).join("")}
    </div>`;
}
function availableBeatLicenses(item) {
  return state.assignments
    .filter((assignment) => assignment.beat_id === item.product?.id && assignment.is_enabled !== false && assignment.beat_licenses?.is_active !== false)
    .map((assignment) => ({
      id: assignment.license_id,
      assignmentId: assignment.id,
      name: assignment.beat_licenses?.name || "Licencia",
      price: Number(assignment.price),
      description: assignment.beat_licenses?.description || "Licencia disponible para este beat.",
      streams: streamLimitLabel(assignment.beat_licenses),
      format: assignment.beat_licenses?.format || "",
      terms: assignment.beat_licenses?.terms || "",
    }));
}
function musicMetaMarkup(meta) {
  if (!meta.length) return '<p class="beat-card__music beat-card__music--empty">Género, BPM y tonalidad por confirmar</p>';
  return `<dl class="beat-card__music">${meta.map((entry) => `
    <div><dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value)}</dd></div>
  `).join("")}</dl>`;
}
function coverMarkup(item) {
  const title = itemTitle(item);
  const imageUrl = coverUrlForItem(item);
  const canPreview = Boolean(previewUrlForItem(item));
  const playAttrs = canPreview ? ` role="button" tabindex="0" data-play-beat="${escapeHtml(item.id)}" aria-label="Preview ${escapeHtml(title)}"` : "";
  const playOverlay = canPreview ? '<span class="beat-card__cover-play" aria-hidden="true">&#9658;</span>' : "";
  if (imageUrl) {
    return `<div class="beat-card__cover"${playAttrs} aria-label="Portada de ${escapeHtml(title)}"><img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" onerror="this.hidden=true;this.parentElement.classList.add(\'beat-card__cover--empty\');this.nextElementSibling.hidden=false"><span class="beat-card__cover-fallback" hidden>${escapeHtml(coverInitials(title))}</span>${playOverlay}</div>`;
  }
  return `<div class="beat-card__cover beat-card__cover--empty"${playAttrs}><span>${escapeHtml(coverInitials(title))}</span>${playOverlay}</div>`;
}

function coverUrlForItem(item) {
  const raw = String(item?.product?.beat_cover_path || item?.product?.image_url || item?.beat?.cover_url || item?.beat?.image_url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^beats_store\//i, "");
  return new URL(`/api/beat-store/stream?file=${encodeURIComponent(clean)}`, CLOUD_ORIGIN).href;
}
function coverInitials(value) {
  return String(value || "Beat")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] || "")
    .join("")
    .toUpperCase();
}
function waveMarkup(seed) {
  const base = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 7;
  const bars = Array.from({ length: 28 }, (_, index) => {
    const height = 18 + ((base * (index + 3) + index * index * 11) % 72);
    return `<span style="height:${height}%"></span>`;
  }).join("");
  return `<div class="beat-card__wave" aria-hidden="true">${bars}</div>`;
}

function handleGridKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const playTarget = event.target.closest("[data-play-beat]");
  if (!playTarget) return;
  event.preventDefault();
  toggleBeatPreview(playTarget.dataset.playBeat);
}
function handleGridClick(event) {
  const playButton = event.target.closest("[data-play-beat]");
  const addButton = event.target.closest("[data-add-beat]");
  const soonButton = event.target.closest("[data-license-soon]");

  if (playButton) {
    toggleBeatPreview(playButton.dataset.playBeat);
    return;
  }
  if (addButton) {
    openBeatLicensesModal(addButton.dataset.addBeat);
    return;
  }
  if (soonButton) showNotice("Proximamente");
}

function openBeatLicensesModal(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item || !beatLicenseModal || !beatLicenseModalContent) return;
  beatLicenseModalTitle.textContent = itemTitle(item);
  beatLicenseModalSubtitle.textContent = productProducer(item) || "Productor por confirmar";
  beatLicenseModalContent.innerHTML = beatLicensesContentMarkup(item);
  beatLicenseModal.hidden = false;
  document.body.classList.add("beat-license-modal-open");
  beatLicenseModal.querySelector("[data-license-modal-close]")?.focus?.();
}

function closeBeatLicensesModal() {
  if (!beatLicenseModal) return;
  beatLicenseModal.hidden = true;
  document.body.classList.remove("beat-license-modal-open");
  if (beatLicenseModalContent) beatLicenseModalContent.innerHTML = "";
}

function handleBeatLicenseModalClick(event) {
  if (event.target.closest("[data-license-modal-close]")) {
    closeBeatLicensesModal();
    return;
  }
  if (event.target.closest("[data-license-soon]")) showNotice("Proximamente");
}

function handleBeatLicenseModalKeydown(event) {
  if (event.key === "Escape" && beatLicenseModal && !beatLicenseModal.hidden) closeBeatLicensesModal();
}

function toggleBeatPreview(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  const previewUrl = previewUrlForItem(item);
  if (!item || !previewUrl) return;
  if (window.HiddenRoomBeatPlayer?.src === previewUrl && window.HiddenRoomBeatPlayer?.isPlaying) {
    window.dispatchEvent(new CustomEvent("hr:beat-preview-toggle", { detail: { action: "pause" } }));
    return;
  }
  playBeat(itemId);
}

function syncBeatCardPlayState(event) {
  const activeSrc = event.detail?.src || "";
  const isPlaying = Boolean(event.detail?.isPlaying);
  document.querySelectorAll(".beat-card__cover[data-play-beat]").forEach((cover) => {
    const item = state.items.find((candidate) => candidate.id === cover.dataset.playBeat);
    const isActive = previewUrlForItem(item) === activeSrc;
    cover.classList.toggle("is-playing", isActive && isPlaying);
    cover.closest(".beat-card")?.classList.toggle("is-active", isActive);
    cover.querySelector(".beat-card__cover-play").innerHTML = isActive && isPlaying ? "&#10074;&#10074;" : "&#9658;";
  });
}

function playBeat(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  const previewUrl = previewUrlForItem(item);
  if (!item || !previewUrl) return;
  const producer = productProducer(item);
  window.dispatchEvent(new CustomEvent("hr:beat-preview", {
    detail: {
      src: previewUrl,
      title: itemTitle(item),
      detail: producer || "Productor por confirmar",
      cover: coverUrlForItem(item),
    },
  }));
}
function previewUrlForItem(item) {
  const productPreview = beatPreviewRelativeFile(item?.product?.beat_preview_path);
  if (productPreview && item?.product?.beat_preview_status !== "error") {
    return new URL(`/api/beat-store/stream?file=${encodeURIComponent(productPreview)}`, CLOUD_ORIGIN).href;
  }

  const streamUrl = item?.beat?.stream_url;
  const streamFile = beatPreviewRelativeFile(item?.beat?.file || streamUrl);
  if (streamUrl && streamFile) return new URL(streamUrl, CLOUD_ORIGIN).href;
  return "";
}

function beatPreviewRelativeFile(value) {
  const clean = beatRelativeFile(value);
  if (!clean) return "";
  return clean.toLowerCase().startsWith("previews/") && /\.mp3$/i.test(clean) ? clean : "";
}

function beatRelativeFile(value) {
  let clean = String(value || "").trim();
  if (!clean) return "";
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    try {
      const url = new URL(clean);
      clean = url.searchParams.get("file") || url.pathname;
    } catch {
      return "";
    }
  }
  clean = clean
    .split("?")[0]
    .split("#")[0]
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/g, "");
  if (clean.toLowerCase().startsWith("beats_store/")) clean = clean.slice("beats_store/".length);
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) return "";
  if (!/\.(mp3|wav|m4a|aac|ogg|flac|aif|aiff)$/i.test(clean)) return "";
  return clean;
}
function addBeatToCart(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item?.product || !productCanBePurchased(item.product)) return;
  const cart = getCart();
  const existing = cart.find((candidate) => candidate.id === item.product.id);
  if (existing) existing.quantity = Math.min(10, existing.quantity + 1);
  else cart.push({ id: item.product.id, quantity: 1 });
  saveCart(cart);
  showNotice("Beat agregado al carrito");
}

function initializeAdminPanel() {
  if (!state.isAdmin || !adminPanel) return;
  ensureAdminEntryLink();
  setAdminMode(wantsAdminMode());
  resetAdminForm();
  resetBeatLicenseForm();
  renderAdminProducts();
  renderBeatLicenseAdmin();
  renderBeatLicenseAssignmentFields();
}

function renderBeatLicenseAdmin() {
  if (!beatLicenseList || !beatLicenseStatus) return;
  beatLicenseStatus.textContent = state.hasBeatLicenses
    ? `${state.licenses.length} licencia${state.licenses.length === 1 ? "" : "s"} registrada${state.licenses.length === 1 ? "" : "s"}.`
    : "Aplica la migracion de licencias para activar esta seccion.";

  if (!state.hasBeatLicenses) {
    beatLicenseList.innerHTML = '<div class="empty-state beat-empty"><h2>Sin tabla de licencias</h2><p>La migracion beat_store_licenses aun no esta aplicada.</p></div>';
    return;
  }

  if (!state.licenses.length) {
    beatLicenseList.innerHTML = '<div class="empty-state beat-empty"><h2>Sin licencias</h2><p>Crea la primera licencia para asignarla a beats.</p></div>';
    return;
  }

  beatLicenseList.innerHTML = state.licenses.map((license) => {
    const assignedCount = state.assignments.filter((assignment) => assignment.license_id === license.id).length;
    return `
      <article class="admin-product-row beat-admin-row beat-license-row">
        <div>
          <span class="product-category">${escapeHtml(license.is_active ? "Activa" : "Inactiva")}</span>
          <h3>${escapeHtml(license.name)}</h3>
          <p>${escapeHtml(formatPrice(license.min_price))} - ${escapeHtml(formatPrice(license.max_price))} / ${escapeHtml(streamLimitLabel(license))}${license.format ? ` / ${escapeHtml(license.format)}` : ""}</p>
          <p class="beat-admin-row__music">${escapeHtml(license.description)}</p>
        </div>
        <div class="admin-actions">
          <button class="secondary-button" type="button" data-edit-license="${escapeHtml(license.id)}">Editar</button>
          <button class="secondary-button" type="button" data-toggle-license="${escapeHtml(license.id)}" data-active="${license.is_active}">${license.is_active ? "Desactivar" : "Activar"}</button>
          <button class="remove-button" type="button" data-delete-license="${escapeHtml(license.id)}" ${assignedCount ? "disabled" : ""}>Eliminar</button>
        </div>
      </article>`;
  }).join("");
}

function renderBeatLicenseAssignmentFields() {
  if (!beatLicenseAssignmentList) return;
  if (!state.hasBeatLicenses) {
    beatLicenseAssignmentList.innerHTML = '<p class="beat-license-empty">Aplica la migracion de licencias para asignarlas.</p>';
    return;
  }
  const activeLicenses = state.licenses.filter((license) => license.is_active);
  if (!activeLicenses.length) {
    beatLicenseAssignmentList.innerHTML = '<p class="beat-license-empty">No hay licencias activas para asignar.</p>';
    return;
  }
  const beatId = document.getElementById("beat-product-id")?.value || "";
  beatLicenseAssignmentList.innerHTML = activeLicenses.map((license) => {
    const assignment = state.assignments.find((candidate) => candidate.beat_id === beatId && candidate.license_id === license.id);
    const checked = assignment?.is_enabled !== false && Boolean(assignment);
    const price = assignment?.price ?? license.min_price;
    const invalid = assignment && !priceWithinLicenseRange(price, license);
    return `
      <label class="beat-license-check ${invalid ? "is-invalid" : ""}" data-license-assignment="${escapeHtml(license.id)}">
        <span><input type="checkbox" data-beat-license-check="${escapeHtml(license.id)}" ${checked ? "checked" : ""}> ${escapeHtml(license.name)}</span>
        <input class="hr-input" type="number" min="${Number(license.min_price)}" max="${Number(license.max_price)}" step="0.01" value="${escapeHtml(price)}" data-beat-license-price="${escapeHtml(license.id)}" ${checked ? "" : "disabled"}>
        <small>Precio permitido: ${escapeHtml(formatPrice(license.min_price))} - ${escapeHtml(formatPrice(license.max_price))} MXN${invalid ? " / Fuera del rango vigente" : ""}</small>
      </label>`;
  }).join("");
}
function renderAdminProducts() {
  if (!adminList || !adminStatus) return;
  adminStatus.textContent = `${state.adminProducts.length} beat${state.adminProducts.length === 1 ? "" : "s"} en productos de tienda.`;

  if (!state.adminProducts.length) {
    adminList.innerHTML = '<div class="empty-state beat-empty"><h2>Sin productos beat</h2><p>Crea el primer beat desde el formulario.</p></div>';
    return;
  }

  adminList.innerHTML = state.adminProducts.map((product) => `
    <article class="admin-product-row beat-admin-row">
      <div>
        <span class="product-category">${escapeHtml(product.is_active ? "Activo" : "Inactivo")}${product.featured ? " / Featured" : ""}</span>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.slug)} / ${escapeHtml(product.producer || "Sin productor")} / stock ${escapeHtml(product.stock ?? "ilimitado")}</p>${adminProductMetaText(product) ? `<p class="beat-admin-row__music">${escapeHtml(adminProductMetaText(product))}</p>` : ""}
      </div>
      <div class="admin-actions">
        <button class="secondary-button" type="button" data-edit-beat="${escapeHtml(product.id)}">Editar</button>
        <button class="secondary-button" type="button" data-toggle-beat="${escapeHtml(product.id)}" data-active="${product.is_active}">${product.is_active ? "Desactivar" : "Activar"}</button>
        <button class="secondary-button" type="button" data-feature-beat="${escapeHtml(product.id)}" data-featured="${product.featured}">${product.featured ? "Quitar featured" : "Featured"}</button>
        <button class="remove-button" type="button" data-delete-beat="${escapeHtml(product.id)}">Eliminar</button>
      </div>
    </article>`).join("");
}

async function handleBeatLicenseSubmit(event) {
  event.preventDefault();
  if (!state.isAdmin || !state.hasBeatLicenses) return;
  beatLicenseError.textContent = "";

  const id = document.getElementById("beat-license-id").value;
  const unlimited = document.getElementById("beat-license-unlimited").checked;
  const payload = {
    name: document.getElementById("beat-license-name").value.trim(),
    min_price: Number(document.getElementById("beat-license-min-price").value),
    max_price: Number(document.getElementById("beat-license-max-price").value),
    description: document.getElementById("beat-license-description").value.trim(),
    terms: document.getElementById("beat-license-terms").value.trim() || null,
    stream_limit: unlimited ? null : nullableNumberFromInput("beat-license-stream-limit"),
    unlimited_streams: unlimited,
    format: document.getElementById("beat-license-format").value.trim() || null,
    is_active: document.getElementById("beat-license-active").checked,
  };

  const validation = validateBeatLicensePayload(payload);
  if (validation) {
    beatLicenseError.textContent = validation;
    return;
  }

  if (id && outOfRangeAssignmentCount(id, payload.min_price, payload.max_price) > 0) {
    const count = outOfRangeAssignmentCount(id, payload.min_price, payload.max_price);
    const confirmed = window.confirm(`${count} beat${count === 1 ? "" : "s"} quedarian fuera del nuevo rango. Puedes guardar, pero deberan corregirse despues.`);
    if (!confirmed) return;
  }

  const query = id
    ? supabase.from("beat_licenses").update(payload).eq("id", id)
    : supabase.from("beat_licenses").insert(payload);
  const { error } = await query;
  if (error) {
    beatLicenseError.textContent = error.message;
    return;
  }

  showNotice(id ? "Licencia actualizada" : "Licencia creada");
  resetBeatLicenseForm();
  await reloadBeatStore();
}

async function handleBeatLicenseListClick(event) {
  const editButton = event.target.closest("[data-edit-license]");
  const toggleButton = event.target.closest("[data-toggle-license]");
  const deleteButton = event.target.closest("[data-delete-license]");

  if (editButton) {
    editBeatLicense(editButton.dataset.editLicense);
    return;
  }
  if (toggleButton) {
    const { error } = await supabase
      .from("beat_licenses")
      .update({ is_active: toggleButton.dataset.active !== "true" })
      .eq("id", toggleButton.dataset.toggleLicense);
    if (error) beatLicenseStatus.textContent = error.message;
    else await reloadBeatStore();
    return;
  }
  if (deleteButton) {
    const assignedCount = state.assignments.filter((assignment) => assignment.license_id === deleteButton.dataset.deleteLicense).length;
    if (assignedCount) {
      showNotice("No se puede eliminar una licencia asignada");
      return;
    }
    const { error } = await supabase.rpc("delete_beat_license_if_unused", { p_license_id: deleteButton.dataset.deleteLicense });
    if (error) beatLicenseStatus.textContent = error.message;
    else {
      showNotice("Licencia eliminada");
      await reloadBeatStore();
    }
  }
}

function editBeatLicense(id) {
  const license = state.licenses.find((candidate) => candidate.id === id);
  if (!license) return;
  document.getElementById("beat-license-id").value = license.id;
  document.getElementById("beat-license-name").value = license.name;
  document.getElementById("beat-license-min-price").value = license.min_price;
  document.getElementById("beat-license-max-price").value = license.max_price;
  document.getElementById("beat-license-description").value = license.description;
  document.getElementById("beat-license-terms").value = license.terms ?? "";
  document.getElementById("beat-license-stream-limit").value = license.stream_limit ?? "";
  document.getElementById("beat-license-unlimited").checked = Boolean(license.unlimited_streams);
  document.getElementById("beat-license-format").value = license.format ?? "";
  document.getElementById("beat-license-active").checked = Boolean(license.is_active);
  document.getElementById("beat-license-form-title").textContent = "Editar licencia";
  beatLicenseCancel.hidden = false;
  updateBeatLicenseRangeWarning();
  beatLicenseForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetBeatLicenseForm() {
  if (!beatLicenseForm) return;
  beatLicenseForm.reset();
  document.getElementById("beat-license-id").value = "";
  document.getElementById("beat-license-active").checked = true;
  document.getElementById("beat-license-form-title").textContent = "Nueva licencia";
  beatLicenseCancel.hidden = true;
  beatLicenseError.textContent = "";
  beatLicenseWarning.textContent = "";
}

function syncBeatLicenseStreamLimitState() {
  const unlimited = document.getElementById("beat-license-unlimited");
  const streamLimit = document.getElementById("beat-license-stream-limit");
  if (!unlimited || !streamLimit) return;
  streamLimit.disabled = unlimited.checked;
  streamLimit.required = !unlimited.checked;
  if (unlimited.checked) streamLimit.value = "";
}
function updateBeatLicenseRangeWarning() {
  if (!beatLicenseWarning) return;
  const id = document.getElementById("beat-license-id")?.value;
  if (!id) {
    beatLicenseWarning.textContent = "";
    return;
  }
  const min = Number(document.getElementById("beat-license-min-price")?.value);
  const max = Number(document.getElementById("beat-license-max-price")?.value);
  const count = outOfRangeAssignmentCount(id, min, max);
  beatLicenseWarning.textContent = count > 0
    ? `${count} beat${count === 1 ? "" : "s"} quedarian fuera del nuevo rango.`
    : "";
}

function outOfRangeAssignmentCount(licenseId, min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  return state.assignments.filter((assignment) => assignment.license_id === licenseId && (Number(assignment.price) < min || Number(assignment.price) > max)).length;
}

function validateBeatLicensePayload(payload) {
  if (!payload.name || !payload.description) return "Nombre y descripcion son obligatorios.";
  if (!Number.isFinite(payload.min_price) || payload.min_price < 0) return "El precio minimo no puede ser negativo.";
  if (!Number.isFinite(payload.max_price) || payload.max_price < payload.min_price) return "El precio maximo no puede ser menor que el minimo.";
  if (!payload.unlimited_streams && (!Number.isFinite(payload.stream_limit) || payload.stream_limit < 0)) return "Define un limite de streams o marca ilimitados.";
  return "";
}
async function handleAdminSubmit(event) {
  event.preventDefault();
  if (!state.isAdmin) return;
  adminError.textContent = "";
  setBeatSubmitLoading(true);

  let uploadedBeatAudio = null;
  let uploadedCoverUrl = "";
  let editingId = "";
  try {
    const id = document.getElementById("beat-product-id").value;
    editingId = id;
    const stockValue = document.getElementById("beat-stock").value;
    uploadedCoverUrl = await uploadSelectedBeatCoverFile();
    uploadedBeatAudio = await uploadSelectedBeatFile(id);

    const payload = beatProductPayload({
      uploadedCoverUrl,
      uploadedBeatAudio,
      isActive: document.getElementById("beat-active").checked,
      stockValue,
    });

    if (!id && state.currentUserId && state.hasBeatLicenses) payload.producer_user_id = state.currentUserId;

    const result = id
      ? await supabase.from("store_products").update(payload).eq("id", id).select("id").single()
      : await supabase.from("store_products").insert(payload).select("id").single();

    if (result.error) throw new Error(result.error.message);

    const beatId = result.data?.id || id;
    await saveBeatLicenseAssignments(beatId);

    showNotice(id ? "Beat actualizado" : "Beat creado");
    resetAdminForm();
    await reloadBeatStore({ refreshBeats: Boolean(uploadedBeatAudio || uploadedCoverUrl) });
  } catch (error) {
    if (error.beatUploadResult) await saveBeatUploadError(editingId, error).catch(() => {});
    adminError.textContent = error.message || "No se pudo guardar el beat.";
    setUploadStatus(adminError.textContent, true);
  } finally {
    setBeatSubmitLoading(false);
  }
}

function beatProductPayload({ uploadedCoverUrl = null, uploadedBeatAudio = null, isActive = true, stockValue = "" } = {}) {
  const payload = {
    name: document.getElementById("beat-name").value.trim(),
    slug: document.getElementById("beat-slug").value.trim().toLowerCase(),
    description: document.getElementById("beat-description").value.trim() || null,
    producer: document.getElementById("beat-producer").value.trim() || null,
    category: "beats",
    price: 0,
    currency: "MXN",
    image_url: uploadedCoverUrl?.image_url || uploadedCoverUrl || document.getElementById("beat-image-url")?.value.trim() || null,
    file_url: uploadedBeatAudio?.file_url || document.getElementById("beat-file-url").value.trim() || null,
    stock: stockValue === "" ? null : Number(stockValue),
    is_digital: document.getElementById("beat-digital").checked,
    featured: document.getElementById("beat-featured").checked,
    is_active: isActive,
  };
  if (uploadedCoverUrl?.beat_cover_path || uploadedCoverUrl?.image_url) payload.beat_cover_path = uploadedCoverUrl.beat_cover_path || uploadedCoverUrl.image_url;
  if (uploadedCoverUrl?.beat_thumb_path) payload.beat_thumb_path = uploadedCoverUrl.beat_thumb_path;
  if (state.hasBeatMetadata) {
    payload.beat_genre = document.getElementById("beat-genre-input").value.trim() || null;
    payload.beat_bpm = nullableNumberFromInput("beat-bpm");
    payload.beat_key = document.getElementById("beat-key").value.trim() || null;
    payload.beat_duration_seconds = nullableNumberFromInput("beat-duration");
  }
  if (state.hasBeatPreviews && uploadedBeatAudio) {
    payload.beat_original_path = uploadedBeatAudio.beat_original_path || null;
    payload.beat_preview_path = uploadedBeatAudio.beat_preview_path || null;
    payload.beat_preview_status = uploadedBeatAudio.beat_preview_status || "ready";
    payload.beat_preview_error = null;
  }
  return payload;
}

async function saveBeatUploadError(id, error) {
  if (!state.hasBeatPreviews) return;
  const result = error.beatUploadResult || {};
  const payload = beatProductPayload({
    uploadedBeatAudio: {
      file_url: result.original_file_url || null,
      beat_original_path: result.beat_original_path || null,
      beat_preview_path: null,
      beat_preview_status: "error",
    },
    isActive: false,
    stockValue: document.getElementById("beat-stock").value,
  });
  payload.beat_preview_status = "error";
  payload.beat_preview_error = "No se pudo generar el preview MP3.";
  if (!payload.name || !payload.slug || !payload.file_url) return;
  const query = id
    ? supabase.from("store_products").update(payload).eq("id", id)
    : supabase.from("store_products").insert(payload);
  await query;
}
async function saveBeatLicenseAssignments(beatId) {
  if (!state.hasBeatLicenses || !beatLicenseAssignmentList || !beatId) return;
  const selectedIds = new Set();
  for (const license of state.licenses.filter((candidate) => candidate.is_active)) {
    const checkbox = beatLicenseAssignmentList.querySelector(`[data-beat-license-check="${CSS.escape(license.id)}"]`);
    const priceInput = beatLicenseAssignmentList.querySelector(`[data-beat-license-price="${CSS.escape(license.id)}"]`);
    const existing = state.assignments.find((assignment) => assignment.beat_id === beatId && assignment.license_id === license.id);
    if (!checkbox?.checked) {
      if (existing) {
        const { error } = await supabase.from("beat_license_assignments").delete().eq("id", existing.id);
        if (error) throw new Error(error.message);
      }
      continue;
    }

    const price = Number(priceInput?.value);
    if (!priceWithinLicenseRange(price, license)) {
      throw new Error(`${license.name}: el precio debe estar entre ${formatPrice(license.min_price)} y ${formatPrice(license.max_price)} MXN.`);
    }
    selectedIds.add(license.id);
    const payload = { beat_id: beatId, license_id: license.id, price, is_enabled: true };
    const { error } = await supabase
      .from("beat_license_assignments")
      .upsert(payload, { onConflict: "beat_id,license_id" });
    if (error) throw new Error(error.message);
  }
}
function handleBeatAutodetectSoonClick(event) {
  const button = event.target.closest("[data-autodetect-soon]");
  if (!button) return;
  showNotice(`Autodetectar ${button.dataset.autodetectSoon} proximamente`);
}

function handleBeatAudioSelection() {
  const file = beatUploadInput?.files?.[0];
  const durationInput = document.getElementById("beat-duration");
  if (!file || !durationInput) return;
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac|aif|aiff)$/i.test(file.name)) return;
  detectAudioDuration(file)
    .then((seconds) => {
      durationInput.value = String(seconds);
      setUploadStatus(`Duracion detectada: ${formatDuration(seconds)}.`);
    })
    .catch(() => {
      setUploadStatus("No se pudo detectar la duracion automaticamente.", true);
    });
}

function detectAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      cleanup();
      const seconds = Math.round(audio.duration || 0);
      if (Number.isFinite(seconds) && seconds > 0) resolve(seconds);
      else reject(new Error("Duracion invalida"));
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("No se pudo leer el audio"));
    };
    audio.src = objectUrl;
  });
}

function setBeatSubmitLoading(isLoading) {
  if (!beatSubmitButton) return;
  beatSubmitButton.disabled = Boolean(isLoading);
  beatSubmitButton.classList.toggle("is-loading", Boolean(isLoading));
  beatSubmitButton.textContent = isLoading ? "Subiendo..." : "Guardar beat";
}
function handleBeatCoverSelection() {
  const file = beatCoverInput?.files?.[0];
  if (beatCoverObjectUrl) URL.revokeObjectURL(beatCoverObjectUrl);
  beatCoverObjectUrl = "";
  if (!file || !beatCoverEditor || !beatCoverPreview) {
    if (beatCoverEditor) beatCoverEditor.hidden = true;
    return;
  }
  beatCoverObjectUrl = URL.createObjectURL(file);
  beatCoverPreview.src = beatCoverObjectUrl;
  beatCoverPreview.onload = updateBeatCoverPreview;
  beatCoverEditor.hidden = false;
  resetBeatCoverCrop();
}

function beatCoverImageRatio() {
  const width = beatCoverPreview?.naturalWidth || 1;
  const height = beatCoverPreview?.naturalHeight || 1;
  return width / height;
}

function beatCoverAxisCanMove() {
  const ratio = beatCoverImageRatio();
  const zoom = beatCoverCropState.zoom;
  return {
    x: Math.max(ratio, 1) * zoom > 1.001,
    y: Math.max(1 / ratio, 1) * zoom > 1.001,
  };
}

function clampBeatCoverCrop() {
  beatCoverCropState.zoom = Math.max(1, Math.min(3, beatCoverCropState.zoom));
  const movable = beatCoverAxisCanMove();
  beatCoverCropState.x = movable.x ? Math.max(0, Math.min(1, beatCoverCropState.x)) : 0.5;
  beatCoverCropState.y = movable.y ? Math.max(0, Math.min(1, beatCoverCropState.y)) : 0.5;
}

function resetBeatCoverCrop() {
  beatCoverCropState.x = 0.5;
  beatCoverCropState.y = 0.5;
  beatCoverCropState.zoom = 1;
  updateBeatCoverPreview();
}

function currentBeatCoverCrop() {
  clampBeatCoverCrop();
  return {
    x: beatCoverCropState.x,
    y: beatCoverCropState.y,
    size: 1 / beatCoverCropState.zoom,
  };
}

function updateBeatCoverPreview() {
  if (!beatCoverPreview) return;
  clampBeatCoverCrop();
  const { x, y, zoom } = beatCoverCropState;
  const extraPan = zoom > 1 ? ((zoom - 1) / zoom) * 50 : 0;
  const translateX = (0.5 - x) * extraPan;
  const translateY = (0.5 - y) * extraPan;
  beatCoverPreview.style.objectPosition = `${x * 100}% ${y * 100}%`;
  beatCoverPreview.style.transform = `translate(${translateX}%, ${translateY}%) scale(${zoom})`;
}
function beatCoverPointerSnapshot(event) {
  return { x: event.clientX, y: event.clientY };
}

function beatCoverPointerDistance() {
  const points = Array.from(beatCoverPointers.values());
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

function handleBeatCoverPointerDown(event) {
  if (!beatCoverPreview?.src || !beatCoverStage) return;
  beatCoverStage.setPointerCapture?.(event.pointerId);
  beatCoverStage.classList.add("is-dragging");
  beatCoverPointers.set(event.pointerId, beatCoverPointerSnapshot(event));
  if (beatCoverPointers.size === 2) {
    beatCoverPinchStart = { distance: beatCoverPointerDistance(), zoom: beatCoverCropState.zoom };
    beatCoverDragStart = null;
    return;
  }
  beatCoverDragStart = {
    x: event.clientX,
    y: event.clientY,
    cropX: beatCoverCropState.x,
    cropY: beatCoverCropState.y,
  };
}

function handleBeatCoverPointerMove(event) {
  if (!beatCoverPointers.has(event.pointerId) || !beatCoverStage) return;
  beatCoverPointers.set(event.pointerId, beatCoverPointerSnapshot(event));
  if (beatCoverPointers.size >= 2 && beatCoverPinchStart?.distance) {
    const distance = beatCoverPointerDistance();
    beatCoverCropState.zoom = beatCoverPinchStart.zoom * (distance / beatCoverPinchStart.distance);
    updateBeatCoverPreview();
    return;
  }
  if (!beatCoverDragStart) return;
  const rect = beatCoverStage.getBoundingClientRect();
  const movable = beatCoverAxisCanMove();
  const dragRangeX = movable.x ? Math.max(0.25, beatCoverCropState.zoom - 0.5) : Number.POSITIVE_INFINITY;
  const dragRangeY = movable.y ? Math.max(0.25, beatCoverCropState.zoom - 0.5) : Number.POSITIVE_INFINITY;
  beatCoverCropState.x = beatCoverDragStart.cropX - ((event.clientX - beatCoverDragStart.x) / rect.width / dragRangeX);
  beatCoverCropState.y = beatCoverDragStart.cropY - ((event.clientY - beatCoverDragStart.y) / rect.height / dragRangeY);
  updateBeatCoverPreview();
}

function handleBeatCoverPointerEnd(event) {
  beatCoverPointers.delete(event.pointerId);
  beatCoverStage?.releasePointerCapture?.(event.pointerId);
  if (beatCoverPointers.size < 2) beatCoverPinchStart = null;
  if (beatCoverPointers.size === 0) {
    beatCoverDragStart = null;
    beatCoverStage?.classList.remove("is-dragging");
  }
}

function handleBeatCoverWheel(event) {
  if (!beatCoverPreview?.src) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 0.08 : -0.08;
  beatCoverCropState.zoom += delta;
  updateBeatCoverPreview();
}
async function uploadSelectedBeatCoverFile() {
  const file = beatCoverInput?.files?.[0];
  if (!file) return "";
  if (!file.type.startsWith("image/") && !/\.(jpg|jpeg|png|webp)$/i.test(file.name)) {
    throw new Error("Selecciona una imagen válida para la portada.");
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesión requerida para subir portadas.");

  setUploadStatus(`Procesando portada ${file.name}...`);
  const productId = document.getElementById("beat-product-id")?.value || "";
  const response = await safeFetch(`${CLOUD_ORIGIN}/api/beat-store/cover`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-Beat-Crop": JSON.stringify(currentBeatCoverCrop()),
      ...(productId ? { "X-Beat-Product-Id": productId } : {}),
    },
    body: file,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "No se pudo procesar la imagen");

  setUploadStatus(`Portada procesada: ${file.name}`);
  return result;
}
async function uploadSelectedBeatFile(productId = "") {
  const file = beatUploadInput?.files?.[0];
  if (!file) return null;
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac|aif|aiff)$/i.test(file.name)) {
    throw new Error("Selecciona un archivo de audio valido.");
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesión requerida para subir archivos.");

  setUploadStatus(`Subiendo ${file.name} y generando preview MP3...`);
  const response = await safeFetch(`${CLOUD_ORIGIN}/api/beat-store/upload-audio`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "X-File-Name": encodeURIComponent(file.name),
      "Content-Type": file.type || "application/octet-stream",
      ...(productId ? { "X-Beat-Product-Id": productId } : {}),
    },
    body: file,
  }, { retries: 1, retryDelayMs: 900, label: "subir audio" });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "No se pudo generar el preview MP3. El original se conservo, pero el beat no se publico.");
    error.beatUploadResult = result;
    throw error;
  }

  setUploadStatus(`Preview MP3 listo: ${file.name}`);
  return result;
}

async function safeFetch(url, options = {}, retryOptions = {}) {
  const retries = Number(retryOptions.retries || 0);
  const retryDelayMs = Number(retryOptions.retryDelayMs || 700);
  const label = retryOptions.label || "conectar con el servidor";
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await wait(retryDelayMs);
    }
  }

  throw new Error(networkErrorMessage(lastError, label));
}

function networkErrorMessage(error, label) {
  const message = String(error?.message || error || "");
  if (/failed to fetch|load failed|networkerror|typeerror/i.test(message)) {
    return `No se pudo ${label}. Revisa tu conexion, sesion o intenta de nuevo.`;
  }
  return message || `No se pudo ${label}.`;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function setUploadStatus(message, isError = false) {
  if (!beatUploadStatus) return;
  beatUploadStatus.textContent = message || "";
  beatUploadStatus.classList.toggle("is-error", Boolean(isError));
}

async function handleAdminListClick(event) {
  const editButton = event.target.closest("[data-edit-beat]");
  const toggleButton = event.target.closest("[data-toggle-beat]");
  const featuredButton = event.target.closest("[data-feature-beat]");
  const deleteButton = event.target.closest("[data-delete-beat]");

  if (editButton) {
    editAdminProduct(editButton.dataset.editBeat);
    return;
  }
  if (toggleButton) {
    await updateAdminProduct(toggleButton.dataset.toggleBeat, { is_active: toggleButton.dataset.active !== "true" });
    return;
  }
  if (featuredButton) {
    await updateAdminProduct(featuredButton.dataset.featureBeat, { featured: featuredButton.dataset.featured !== "true" });
    return;
  }
  if (deleteButton && window.confirm("¿Eliminar este beat de productos? Dejará de existir para clientes, pero no se borra el archivo de Cloud.")) {
    const { error } = await supabase.from("store_products").delete().eq("id", deleteButton.dataset.deleteBeat);
    if (error) adminStatus.textContent = error.message;
    else {
      showNotice("Beat eliminado");
      await reloadBeatStore();
    }
  }
}

async function updateAdminProduct(id, patch) {
  const { error } = await supabase.from("store_products").update(patch).eq("id", id);
  if (error) adminStatus.textContent = error.message;
  else await reloadBeatStore();
}

function editAdminProduct(id) {
  const product = state.adminProducts.find((candidate) => candidate.id === id);
  if (!product) return;

  document.getElementById("beat-product-id").value = product.id;
  document.getElementById("beat-name").value = product.name;
  document.getElementById("beat-slug").value = product.slug;
  document.getElementById("beat-description").value = product.description ?? "";
  document.getElementById("beat-producer").value = product.producer ?? "";
  document.getElementById("beat-genre-input").value = product.beat_genre ?? "";
  document.getElementById("beat-bpm").value = product.beat_bpm ?? "";
  document.getElementById("beat-key").value = product.beat_key ?? "";
  document.getElementById("beat-duration").value = product.beat_duration_seconds ?? "";
  document.getElementById("beat-image-url").value = product.image_url ?? "";
  if (beatCoverEditor) beatCoverEditor.hidden = true;
  document.getElementById("beat-file-url").value = product.file_url ?? "";
  document.getElementById("beat-stock").value = product.stock ?? "";
  document.getElementById("beat-featured").checked = Boolean(product.featured);
  document.getElementById("beat-active").checked = Boolean(product.is_active);
  document.getElementById("beat-digital").checked = Boolean(product.is_digital);
  document.getElementById("beat-form-title").textContent = "Editar beat";
  cancelEditButton.hidden = false;
  renderBeatLicenseAssignmentFields();
  adminForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetAdminForm() {
  if (!adminForm) return;
  adminForm.reset();
  if (beatCoverEditor) beatCoverEditor.hidden = true;
  if (beatCoverObjectUrl) URL.revokeObjectURL(beatCoverObjectUrl);
  beatCoverObjectUrl = "";
  document.getElementById("beat-product-id").value = "";
  document.getElementById("beat-active").checked = true;
  document.getElementById("beat-digital").checked = true;
  document.getElementById("beat-form-title").textContent = "Nuevo beat";
  cancelEditButton.hidden = true;
  adminError.textContent = "";
  renderBeatLicenseAssignmentFields();
}

async function reloadBeatStore(options = {}) {
  if (options.refreshBeats) state.beats = await fetchCloudBeats();
  const products = await fetchBeatProducts(state.isAdmin);
  state.products = products;
  state.adminProducts = state.isAdmin ? products : [];
  state.licenses = await fetchBeatLicenses(state.isAdmin);
  state.assignments = await fetchBeatLicenseAssignments(products.map((product) => product.id), state.isAdmin);
  state.items = mergeProductsAndBeats(products, state.beats);
  renderGenreOptions();
  renderBeats();
  renderAdminProducts();
  renderBeatLicenseAdmin();
  renderBeatLicenseAssignmentFields();
}

function getCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored
      .map((item) => ({ id: String(item?.id || ""), quantity: Math.max(1, Math.min(10, Number.parseInt(item?.quantity, 10) || 1)) }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const count = getCart().reduce((total, item) => total + item.quantity, 0);
  document.querySelectorAll(".cart-count").forEach((element) => {
    element.textContent = String(count);
  });
}

function cloudFileName(value) {
  const clean = String(value || "").split("?")[0].split("#")[0];
  try {
    return decodeURIComponent(clean.split("/").filter(Boolean).pop() || clean);
  } catch {
    return clean.split("/").filter(Boolean).pop() || clean;
  }
}

function itemTitle(item) {
  return item.product?.name || item.beat?.title || "Beat";
}

function productProducer(item) {
  return item.product?.producer || item.beat?.producer || "";
}

function beatGenre(item) {
  return item?.product?.beat_genre || item?.beat?.genre || item?.product?.category || "";
}

function itemMusicMeta(item) {
  const product = item?.product || {};
  const beat = item?.beat || {};
  const bpm = product.beat_bpm || beat.bpm;
  const key = product.beat_key || beat.key;
  const genre = product.beat_genre || beat.genre;
  const duration = product.beat_duration_seconds || beat.duration_seconds || beat.duration;
  return [
    genre ? { label: "Género", value: genre } : null,
    bpm ? { label: "BPM", value: `${bpm}` } : null,
    key ? { label: "Tonalidad", value: key } : null,
    duration ? { label: "Duración", value: formatDuration(duration) } : null,
  ].filter(Boolean);
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return String(value || "");
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function nullableNumberFromInput(id) {
  const value = document.getElementById(id)?.value;
  return value === "" ? null : Number(value);
}

function productCanBePurchased(product) {
  if (product.is_active === false) return false;
  return product.stock === null || Number(product.stock) > 0;
}

function categoryLabel(category) {
  return { beats: "Beats", merch: "Merch", digital: "Digital", eventos: "Eventos" }[category] || category;
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function streamLimitLabel(license) {
  if (!license) return "Por confirmar";
  if (license.unlimited_streams) return "Ilimitados";
  const limit = Number(license.stream_limit);
  if (!Number.isFinite(limit)) return "Por confirmar";
  return `${new Intl.NumberFormat("es-MX").format(limit)} streams`;
}

function priceWithinLicenseRange(price, license) {
  const value = Number(price);
  return Number.isFinite(value) && value >= Number(license.min_price) && value <= Number(license.max_price);
}
function formatPrice(amount, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency || "MXN" }).format(Number(amount));
}

function errorState(message) {
  return `<div class="empty-state beat-empty"><h2>No pudimos cargar Beat Store</h2><p>${escapeHtml(message)}</p></div>`;
}

function showNotice(message) {
  const notice = document.getElementById("store-notice");
  if (!notice) return;
  notice.className = "notice hr-toast hr-toast--success visible hr-toast--visible";
  notice.innerHTML = '<span class="hr-toast__dot" aria-hidden="true"></span><span class="hr-toast__message"></span>';
  notice.querySelector(".hr-toast__message").textContent = message;
  window.clearTimeout(showNotice.timeout);
  showNotice.timeout = window.setTimeout(() => {
    notice.classList.remove("visible", "hr-toast--visible");
  }, 2200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}




































