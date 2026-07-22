import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://rpcunbkstadgngqrjafp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO";
const CLOUD_ORIGIN = "https://cloud.hiddenroom.mx";
const supabase = window.HiddenRoomSupabase?.getClient
  ? await window.HiddenRoomSupabase.getClient()
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const profileSlug = new URLSearchParams(window.location.search).get("producer") || "";
const grid = document.getElementById("producer-beat-grid");
const modal = document.getElementById("beat-license-modal");
const modalTitle = document.getElementById("beat-license-modal-title");
const modalSubtitle = document.getElementById("beat-license-modal-subtitle");
const modalContent = document.getElementById("beat-license-modal-content");
const state = { profile: null, products: [], assignments: [] };

initProducerPage().catch((error) => {
  grid.innerHTML = errorState(error.message || "No se pudo cargar el productor.");
});

async function initProducerPage() {
  if (!profileSlug) throw new Error("Falta el productor en la URL.");
  state.profile = await fetchProducerProfile(profileSlug);
  if (!state.profile) throw new Error("Productor no encontrado.");
  renderProfile(state.profile);
  state.products = await fetchProducerBeats(state.profile);
  state.assignments = await fetchBeatLicenseAssignments(state.products.map((product) => product.id));
  renderBeats();
  grid.addEventListener("click", handleGridClick);
  modal?.addEventListener("click", handleModalClick);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && !modal.hidden) closeLicensesModal();
  });
}

async function fetchProducerProfile(slug) {
  const { data, error } = await supabase
    .from("producer_profiles")
    .select("id, slug, display_name, bio, avatar_url, cover_url, social_links")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function fetchProducerBeats(profile) {
  const { data, error } = await supabase
    .from("store_products")
    .select("id, slug, name, description, category, price, currency, image_url, beat_cover_path, beat_thumb_path, file_url, producer, producer_profile_id, beat_genre, beat_bpm, beat_key, beat_duration_seconds, beat_bpm_autodetected, beat_key_autodetected, beat_original_path, beat_preview_path, beat_preview_status, is_active, stock, featured, created_at")
    .eq("category", "beats")
    .eq("is_active", true)
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const producerKeys = new Set([normalizeKey(profile.slug), normalizeKey(profile.display_name)].filter(Boolean));
  return (data ?? []).filter((product) => product.producer_profile_id === profile.id || producerKeys.has(normalizeKey(product.producer || "")));
}

async function fetchBeatLicenseAssignments(beatIds) {
  if (!beatIds.length) return [];
  const { data, error } = await supabase
    .from("beat_license_assignments")
    .select("id, beat_id, license_id, price, is_enabled, beat_licenses(id, name, description, terms, stream_limit, unlimited_streams, format, is_active)")
    .in("beat_id", beatIds)
    .eq("is_enabled", true);
  if (error) return [];
  return data ?? [];
}

function renderProfile(profile) {
  const displayName = producerDisplayName(profile.display_name);
  document.title = `${displayName} | Hidden Room Beat Store`;
  document.getElementById("producer-name").textContent = displayName;
  document.getElementById("producer-bio").textContent = profile.bio || "Catálogo de beats en Hidden Room.";
  const avatar = document.getElementById("producer-avatar");
  if (profile.avatar_url) {
    avatar.style.backgroundImage = `url(${escapeCssUrl(profile.avatar_url)})`;
    avatar.textContent = "";
  } else {
    avatar.textContent = initials(profile.display_name);
  }
  const cover = document.getElementById("producer-cover");
  if (profile.cover_url) cover.style.backgroundImage = `url(${escapeCssUrl(profile.cover_url)})`;
  const links = socialLinks(profile.social_links);
  document.getElementById("producer-links").innerHTML = links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label)}</a>`).join("");
}

function renderBeats() {
  if (!state.products.length) {
    grid.innerHTML = '<div class="empty-state beat-empty"><h2>Sin beats publicados</h2><p>Este productor todavía no tiene beats activos.</p></div>';
    return;
  }
  grid.innerHTML = state.products.map((product) => beatCardMarkup(product)).join("");
}

function beatCardMarkup(product) {
  const meta = itemMusicMeta(product);
  const canBuy = product.stock === null || Number(product.stock) > 0;
  return `
    <article class="product-card beat-card" data-item-id="${escapeHtml(product.id)}">
      ${coverMarkup(product)}
      <div class="beat-card__body">
        <h3>${escapeHtml(product.name)}</h3>
        <p class="beat-card__producer">${escapeHtml(producerDisplayName(state.profile.display_name))}</p>
        <div class="beat-card__meta-slot">${musicMetaMarkup(meta)}</div>
      </div>
      <div class="beat-card__actions">
        <button class="primary-button" type="button" data-add-beat="${escapeHtml(product.id)}" ${canBuy ? "" : "disabled"}>Ver licencias</button>
      </div>
    </article>`;
}

function itemMusicMeta(product) {
  const bpmText = product.beat_bpm ? `${product.beat_bpm}${product.beat_bpm_autodetected ? " (AD)" : ""}` : "";
  const keyText = product.beat_key ? `${product.beat_key}${product.beat_key_autodetected ? " (AD)" : ""}` : "";
  return [
    product.beat_genre ? { label: "Género", value: product.beat_genre } : null,
    bpmText ? { label: "BPM", value: bpmText } : null,
    keyText ? { label: "Tonalidad", value: keyText } : null,
    product.beat_duration_seconds ? { label: "Duración", value: formatDuration(product.beat_duration_seconds) } : null,
  ].filter(Boolean);
}

function musicMetaMarkup(meta) {
  if (!meta.length) return '<p class="beat-card__music beat-card__music--empty">Género, BPM y tonalidad por confirmar</p>';
  return `<dl class="beat-card__music">${meta.map((entry) => `<div><dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value)}</dd></div>`).join("")}</dl>`;
}

function coverMarkup(product) {
  const imageUrl = coverUrlForProduct(product);
  if (imageUrl) return `<div class="beat-card__cover"><img src="${escapeHtml(imageUrl)}" alt="" loading="lazy"><span class="beat-card__cover-fallback" hidden>${escapeHtml(initials(product.name))}</span></div>`;
  return `<div class="beat-card__cover beat-card__cover--empty"><span>${escapeHtml(initials(product.name))}</span></div>`;
}

function coverUrlForProduct(product) {
  const raw = String(product.beat_cover_path || product.image_url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replaceAll("\\", "/").replace(/^\/+/, "").replace(/^beats_store\//i, "");
  return new URL(`/api/beat-store/stream?file=${encodeURIComponent(clean)}`, CLOUD_ORIGIN).href;
}

function handleGridClick(event) {
  const button = event.target.closest("[data-add-beat]");
  if (button) openLicensesModal(button.dataset.addBeat);
}

function openLicensesModal(productId) {
  const product = state.products.find((candidate) => candidate.id === productId);
  if (!product) return;
  modalTitle.textContent = product.name;
  modalSubtitle.textContent = producerDisplayName(state.profile.display_name);
  modalContent.innerHTML = beatLicensesContentMarkup(product);
  modal.hidden = false;
  document.body.classList.add("beat-license-modal-open");
}

function closeLicensesModal() {
  modal.hidden = true;
  document.body.classList.remove("beat-license-modal-open");
  modalContent.innerHTML = "";
}

function handleModalClick(event) {
  if (event.target.closest("[data-license-modal-close]")) closeLicensesModal();
  if (event.target.closest("[data-license-soon]")) showNotice("Próximamente");
}

function beatLicensesContentMarkup(product) {
  const licenses = state.assignments
    .filter((assignment) => assignment.beat_id === product.id && assignment.beat_licenses?.is_active !== false)
    .map((assignment) => ({
      id: assignment.license_id,
      name: assignment.beat_licenses?.name || "Licencia",
      description: assignment.beat_licenses?.description || "Licencia disponible para este beat.",
      price: Number(assignment.price),
      streams: streamLimitLabel(assignment.beat_licenses),
      format: assignment.beat_licenses?.format || "",
      terms: assignment.beat_licenses?.terms || "",
    }));
  if (!licenses.length) return '<p class="beat-license-empty">Este beat todavía no tiene licencias habilitadas.</p>';
  return `<div class="beat-license-list">${licenses.map((license) => `
    <article class="beat-license-option">
      <header><div><h5>${escapeHtml(license.name)}</h5><p>${escapeHtml(license.description)}</p></div><strong>${escapeHtml(formatPrice(license.price, product.currency))}</strong></header>
      <dl><div><dt>Límite</dt><dd>${escapeHtml(license.streams)}</dd></div>${license.format ? `<div><dt>Formato</dt><dd>${escapeHtml(license.format)}</dd></div>` : ""}</dl>
      ${license.terms ? `<p class="beat-license-terms">${escapeHtml(license.terms)}</p>` : ""}
      <div class="beat-license-actions"><button class="secondary-button" type="button" data-license-soon>Comprar próximamente</button><button class="secondary-button" type="button" data-license-soon>Añadir al carrito próximamente</button></div>
    </article>`).join("")}</div>`;
}

function streamLimitLabel(license) {
  if (!license) return "Por confirmar";
  if (license.unlimited_streams) return "Ilimitados";
  const limit = Number(license.stream_limit);
  return Number.isFinite(limit) ? `${new Intl.NumberFormat("es-MX").format(limit)} streams` : "Por confirmar";
}

function socialLinks(raw) {
  const links = raw && typeof raw === "object" ? raw : {};
  return Object.entries(links)
    .map(([label, url]) => ({ label, url: String(url || "") }))
    .filter((link) => /^https?:\/\//i.test(link.url))
    .slice(0, 6);
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function formatPrice(amount, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency || "MXN" }).format(Number(amount));
}

function producerStorageName(value) {
  return String(value || "").trim().replace(/^@+/, "");
}

function producerDisplayName(value) {
  const clean = producerStorageName(value);
  return clean ? `@${clean}` : "Productor por confirmar";
}
function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function initials(value) {
  return String(value || "HR").trim().split(/\s+/).slice(0, 2).map((word) => word[0] || "").join("").toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char]));
}

function escapeCssUrl(value) {
  return String(value || "").replace(/["\\\n\r]/g, "");
}

function errorState(message) {
  return `<div class="empty-state beat-empty"><h2>No pudimos cargar el productor</h2><p>${escapeHtml(message)}</p></div>`;
}

function showNotice(message) {
  const notice = document.getElementById("store-notice");
  if (!notice) return;
  notice.className = "notice hr-toast hr-toast--success visible hr-toast--visible";
  notice.textContent = message;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => notice.classList.remove("visible", "hr-toast--visible"), 2200);
}