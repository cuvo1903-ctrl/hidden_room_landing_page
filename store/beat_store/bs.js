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
const state = { products: [], adminProducts: [], beats: [], items: [], isAdmin: false, hasBeatMetadata: true };

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
const beatCoverEditor = document.getElementById("beat-cover-editor");
const beatCoverPreview = document.getElementById("beat-cover-preview");
const beatCoverStage = document.querySelector(".beat-cover-editor__stage");
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
  const [products, beats] = await Promise.all([fetchBeatProducts(state.isAdmin), fetchCloudBeats()]);
  state.products = products;
  state.adminProducts = state.isAdmin ? products : [];
  state.beats = beats;
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
  adminList?.addEventListener("click", handleAdminListClick);
  cancelEditButton?.addEventListener("click", resetAdminForm);
  beatCoverInput?.addEventListener("change", handleBeatCoverSelection);
  beatCoverStage?.addEventListener("pointerdown", handleBeatCoverPointerDown);
  beatCoverStage?.addEventListener("pointermove", handleBeatCoverPointerMove);
  beatCoverStage?.addEventListener("pointerup", handleBeatCoverPointerEnd);
  beatCoverStage?.addEventListener("pointercancel", handleBeatCoverPointerEnd);
  beatCoverStage?.addEventListener("lostpointercapture", handleBeatCoverPointerEnd);
  beatCoverStage?.addEventListener("wheel", handleBeatCoverWheel, { passive: false });
  beatCoverStage?.addEventListener("dblclick", resetBeatCoverCrop);
  document.addEventListener("click", handleAdminModeClick);
}

function ensureAdminMusicFields() {
  if (!adminForm || document.getElementById("beat-genre-input")) return;
  const producerField = document.getElementById("beat-producer")?.closest(".field");
  if (!producerField) return;

  const wrapper = document.createElement("div");
  wrapper.className = "beat-admin__music-fields";
  wrapper.innerHTML = `
    <div class="field hr-field"><label class="hr-label" for="beat-genre-input">Genero</label><input class="hr-input" id="beat-genre-input" maxlength="80" placeholder="Trap, Boom bap, Reggaeton..."></div>
    <div class="field hr-field"><label class="hr-label" for="beat-bpm">BPM</label><input class="hr-input" id="beat-bpm" type="number" min="1" max="300" step="1"></div>
    <div class="field hr-field"><label class="hr-label" for="beat-key">Tonalidad</label><input class="hr-input" id="beat-key" maxlength="24" placeholder="Cm, F# minor..."></div>
    <div class="field hr-field"><label class="hr-label" for="beat-duration">Duracion</label><input class="hr-input" id="beat-duration" type="number" min="1" step="1" placeholder="Segundos"></div>
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
const BEAT_PRODUCT_META_SELECT = `${BEAT_PRODUCT_BASE_SELECT}, beat_genre, beat_bpm, beat_key, beat_duration_seconds`;

async function fetchBeatProducts(includeInactive = false) {
  const { data, error } = await runBeatProductQuery(includeInactive, state.hasBeatMetadata ? BEAT_PRODUCT_META_SELECT : BEAT_PRODUCT_BASE_SELECT);

  if (!error) return data ?? [];

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

function isMissingBeatMetadataError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703" || ["beat_genre", "beat_bpm", "beat_key", "beat_duration_seconds"].some((column) => message.includes(column));
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
    grid.innerHTML = `<div class="empty-state beat-empty"><h2>Sin beats</h2><p>${query ? "Prueba otra busqueda." : "No hay beats activos publicados."}</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(beatCardMarkup).join("");
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
    if (mode === "price-asc") return productPrice(a) - productPrice(b);
    if (mode === "price-desc") return productPrice(b) - productPrice(a);
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
  const price = product ? formatPrice(product.price, product.currency) : "Sin producto";
  const producer = productProducer(item);
  const meta = itemMusicMeta(item);

  return `
    <article class="product-card beat-card" data-item-id="${escapeHtml(item.id)}">
      ${coverMarkup(item)}
      <div class="beat-card__body">
        <h3>${escapeHtml(title)}</h3>
        <p class="beat-card__producer">${escapeHtml(producer || "Productor por confirmar")}</p>
        ${musicMetaMarkup(meta)}
      </div>
      <div class="beat-card__actions">
        <strong class="product-price">${escapeHtml(price)}</strong>
        <button class="primary-button" type="button" data-add-beat="${escapeHtml(item.id)}" ${canBuy ? "" : "disabled"}>Ver licencias</button>
      </div>
    </article>`;
}

function musicMetaMarkup(meta) {
  if (!meta.length) return '<p class="beat-card__music beat-card__music--empty">Genero, BPM y tonalidad por confirmar</p>';
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

  if (playButton) {
    toggleBeatPreview(playButton.dataset.playBeat);
    return;
  }
  if (addButton) showNotice("PrÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³ximamente");
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
  const streamUrl = item?.beat?.stream_url;
  if (streamUrl) return new URL(streamUrl, CLOUD_ORIGIN).href;

  const relativeFile = beatRelativeFile(item?.product?.file_url);
  if (!relativeFile) return "";
  return new URL(`/api/beat-store/stream?file=${encodeURIComponent(relativeFile)}`, CLOUD_ORIGIN).href;
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
  if (!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(clean)) return "";
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
  renderAdminProducts();
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
        <p>${escapeHtml(product.slug)} / ${escapeHtml(product.producer || "Sin productor")} / ${formatPrice(product.price, product.currency)} / stock ${escapeHtml(product.stock ?? "ilimitado")}</p>${adminProductMetaText(product) ? `<p class="beat-admin-row__music">${escapeHtml(adminProductMetaText(product))}</p>` : ""}
      </div>
      <div class="admin-actions">
        <button class="secondary-button" type="button" data-edit-beat="${escapeHtml(product.id)}">Editar</button>
        <button class="secondary-button" type="button" data-toggle-beat="${escapeHtml(product.id)}" data-active="${product.is_active}">${product.is_active ? "Desactivar" : "Activar"}</button>
        <button class="secondary-button" type="button" data-feature-beat="${escapeHtml(product.id)}" data-featured="${product.featured}">${product.featured ? "Quitar featured" : "Featured"}</button>
        <button class="remove-button" type="button" data-delete-beat="${escapeHtml(product.id)}">Eliminar</button>
      </div>
    </article>`).join("");
}

async function handleAdminSubmit(event) {
  event.preventDefault();
  if (!state.isAdmin) return;
  adminError.textContent = "";

  const id = document.getElementById("beat-product-id").value;
  const stockValue = document.getElementById("beat-stock").value;
  let uploadedFileUrl = "";
  let uploadedCoverUrl = "";
  try {
    uploadedCoverUrl = await uploadSelectedBeatCoverFile();
    uploadedFileUrl = await uploadSelectedBeatFile();
  } catch (error) {
    adminError.textContent = error.message || "No se pudo subir el audio.";
    setUploadStatus(adminError.textContent, true);
    return;
  }

  const payload = {
    name: document.getElementById("beat-name").value.trim(),
    slug: document.getElementById("beat-slug").value.trim().toLowerCase(),
    description: document.getElementById("beat-description").value.trim() || null,
    producer: document.getElementById("beat-producer").value.trim() || null,
    category: "beats",
    price: Number(document.getElementById("beat-price").value),
    currency: "MXN",
    image_url: uploadedCoverUrl?.image_url || uploadedCoverUrl || document.getElementById("beat-image-url")?.value.trim() || null,
    file_url: uploadedFileUrl || document.getElementById("beat-file-url").value.trim() || null,
    stock: stockValue === "" ? null : Number(stockValue),
    is_digital: document.getElementById("beat-digital").checked,
    featured: document.getElementById("beat-featured").checked,
    is_active: document.getElementById("beat-active").checked,
  };
  if (uploadedCoverUrl?.beat_cover_path || uploadedCoverUrl?.image_url) {
    payload.beat_cover_path = uploadedCoverUrl.beat_cover_path || uploadedCoverUrl.image_url;
  }
  if (uploadedCoverUrl?.beat_thumb_path) {
    payload.beat_thumb_path = uploadedCoverUrl.beat_thumb_path;
  }
  if (state.hasBeatMetadata) {
    payload.beat_genre = document.getElementById("beat-genre-input").value.trim() || null;
    payload.beat_bpm = nullableNumberFromInput("beat-bpm");
    payload.beat_key = document.getElementById("beat-key").value.trim() || null;
    payload.beat_duration_seconds = nullableNumberFromInput("beat-duration");
  }

  const query = id
    ? supabase.from("store_products").update(payload).eq("id", id)
    : supabase.from("store_products").insert(payload);
  const { error } = await query;

  if (error) {
    adminError.textContent = error.message;
    return;
  }

  showNotice(id ? "Beat actualizado" : "Beat creado");
  resetAdminForm();
  await reloadBeatStore({ refreshBeats: Boolean(uploadedFileUrl || uploadedCoverUrl) });
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
    throw new Error("Selecciona una imagen valida para la portada.");
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesion requerida para subir portadas.");

  setUploadStatus(`Procesando portada ${file.name}...`);
  const productId = document.getElementById("beat-product-id")?.value || "";
  const response = await fetch(`${CLOUD_ORIGIN}/api/beat-store/cover`, {
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
async function uploadSelectedBeatFile() {
  const file = beatUploadInput?.files?.[0];
  if (!file) return "";
  if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) {
    throw new Error("Selecciona un archivo de audio valido.");
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sesion requerida para subir archivos.");

  setUploadStatus(`Subiendo ${file.name}...`);
  const response = await fetch(`${CLOUD_ORIGIN}/api/upload?path=${encodeURIComponent(BEAT_STORE_CLOUD_PATH)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "X-File-Name": encodeURIComponent(file.name),
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "No se pudo subir el audio a MysAuth Cloud.");

  setUploadStatus(`Audio subido: ${file.name}`);
  return `${BEAT_STORE_CLOUD_PATH}/${file.name}`;
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
  if (deleteButton && window.confirm("Eliminar este beat de productos? Dejara de existir para clientes, pero no se borra el archivo de Cloud.")) {
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
  document.getElementById("beat-price").value = product.price;
  document.getElementById("beat-image-url").value = product.image_url ?? "";
  if (beatCoverEditor) beatCoverEditor.hidden = true;
  document.getElementById("beat-file-url").value = product.file_url ?? "";
  document.getElementById("beat-stock").value = product.stock ?? "";
  document.getElementById("beat-featured").checked = Boolean(product.featured);
  document.getElementById("beat-active").checked = Boolean(product.is_active);
  document.getElementById("beat-digital").checked = Boolean(product.is_digital);
  document.getElementById("beat-form-title").textContent = "Editar beat";
  cancelEditButton.hidden = false;
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
}

async function reloadBeatStore(options = {}) {
  if (options.refreshBeats) state.beats = await fetchCloudBeats();
  const products = await fetchBeatProducts(state.isAdmin);
  state.products = products;
  state.adminProducts = state.isAdmin ? products : [];
  state.items = mergeProductsAndBeats(products, state.beats);
  renderGenreOptions();
  renderBeats();
  renderAdminProducts();
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
    genre ? { label: "Genero", value: genre } : null,
    bpm ? { label: "BPM", value: `${bpm}` } : null,
    key ? { label: "Tonalidad", value: key } : null,
    duration ? { label: "Duracion", value: formatDuration(duration) } : null,
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
function productPrice(item) {
  return item.product ? Number(item.product.price) : Number.POSITIVE_INFINITY;
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






