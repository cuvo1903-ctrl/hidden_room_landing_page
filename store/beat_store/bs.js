import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://rpcunbkstadgngqrjafp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO";
const CART_STORAGE_KEY = "hidden_room_store_cart";
const CLOUD_ORIGIN = "https://cloud.hiddenroom.mx";
const BEAT_STORE_ENDPOINT = `${CLOUD_ORIGIN}/api/beat-store`;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const state = { products: [], beats: [], items: [] };

const grid = document.getElementById("beat-grid");
const searchInput = document.getElementById("beat-search");
const sortSelect = document.getElementById("beat-sort");
const audio = document.getElementById("beat-audio");
const playerTitle = document.getElementById("player-title");
const playerDetail = document.getElementById("player-detail");

initBeatStore().catch((error) => {
  grid.innerHTML = errorState(error.message || "No se pudo cargar Beat Store.");
});

async function initBeatStore() {
  updateCartCount();
  const [products, beats] = await Promise.all([fetchBeatProducts(), fetchCloudBeats()]);
  state.products = products;
  state.beats = beats;
  state.items = mergeProductsAndBeats(products, beats);
  renderBeats();

  searchInput?.addEventListener("input", renderBeats);
  sortSelect?.addEventListener("change", renderBeats);
  grid?.addEventListener("click", handleGridClick);
}

async function fetchBeatProducts() {
  const { data, error } = await supabase
    .from("store_products")
    .select("id, slug, name, description, category, price, currency, image_url, file_url, stock, is_digital, featured")
    .eq("is_active", true)
    .eq("category", "beats")
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`No se pudieron cargar productos: ${error.message}`);
  return data ?? [];
}

async function fetchCloudBeats() {
  const response = await fetch(BEAT_STORE_ENDPOINT, { headers: { Accept: "application/json" } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "No se pudo leer beats_store en Cloud.");
  return Array.isArray(result.beats) ? result.beats : [];
}

function mergeProductsAndBeats(products, beats) {
  const productBySlug = new Map();
  const productByName = new Map();
  for (const product of products) {
    productBySlug.set(normalizeKey(product.slug), product);
    productByName.set(normalizeKey(product.name), product);
  }

  const usedProductIds = new Set();
  const merged = beats.map((beat) => {
    const product = productBySlug.get(normalizeKey(beat.slug)) || productByName.get(normalizeKey(beat.title));
    if (product) usedProductIds.add(product.id);
    return { id: `beat:${beat.file}`, beat, product };
  });

  for (const product of products) {
    if (usedProductIds.has(product.id)) continue;
    merged.push({ id: `product:${product.id}`, beat: null, product });
  }

  return merged;
}

function renderBeats() {
  const query = String(searchInput?.value || "").trim().toLowerCase();
  const sorted = sortItems(state.items, sortSelect?.value || "featured");
  const filtered = sorted.filter((item) => {
    const product = item.product;
    const beat = item.beat;
    const haystack = [
      product?.name,
      product?.description,
      product?.slug,
      beat?.title,
      beat?.file,
      beat?.slug,
    ].filter(Boolean).join(" ").toLowerCase();
    return !query || haystack.includes(query);
  });

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state beat-empty"><h2>Sin beats</h2><p>${state.beats.length ? "Prueba otra busqueda." : "Sube archivos de audio a cloud/beats_store para publicar previews aqui."}</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(beatCardMarkup).join("");
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
  const beat = item.beat;
  const title = itemTitle(item);
  const canPreview = Boolean(beat?.stream_url);
  const canBuy = Boolean(product && productCanBePurchased(product));
  const price = product ? formatPrice(product.price, product.currency) : "Sin producto";
  const description = product?.description || (beat ? "Preview disponible desde MysAuth Cloud." : "Producto pendiente de preview en Cloud.");
  const status = [
    product?.featured ? "Featured" : null,
    canPreview ? "Preview" : "Sin preview",
    canBuy ? "Compra activa" : product ? "No disponible" : "No vinculado",
  ].filter(Boolean).join(" / ");

  return `
    <article class="product-card beat-card" data-item-id="${escapeHtml(item.id)}">
      ${waveMarkup(title)}
      <div class="beat-card__meta">
        <span class="product-category">${escapeHtml(product?.category ? categoryLabel(product.category) : "Beat")}</span>
        <span class="beat-card__status">${escapeHtml(status)}</span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      <p class="product-description">${escapeHtml(description)}</p>
      <p class="beat-card__file">${escapeHtml(beat?.file || product?.slug || "Sin archivo asociado")}</p>
      <p class="product-price">${escapeHtml(price)}</p>
      <div class="beat-card__actions">
        <button class="secondary-button" type="button" data-play-beat="${escapeHtml(item.id)}" ${canPreview ? "" : "disabled"}>Reproducir</button>
        <button class="primary-button" type="button" data-add-beat="${escapeHtml(item.id)}" ${canBuy ? "" : "disabled"}>Comprar</button>
      </div>
    </article>`;
}

function waveMarkup(seed) {
  const base = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 7;
  const bars = Array.from({ length: 28 }, (_, index) => {
    const height = 18 + ((base * (index + 3) + index * index * 11) % 72);
    return `<span style="height:${height}%"></span>`;
  }).join("");
  return `<div class="beat-card__wave" aria-hidden="true">${bars}</div>`;
}

function handleGridClick(event) {
  const playButton = event.target.closest("[data-play-beat]");
  const addButton = event.target.closest("[data-add-beat]");

  if (playButton) {
    playBeat(playButton.dataset.playBeat);
    return;
  }
  if (addButton) addBeatToCart(addButton.dataset.addBeat);
}

function playBeat(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item?.beat?.stream_url) return;
  const title = itemTitle(item);
  audio.src = new URL(item.beat.stream_url, CLOUD_ORIGIN).href;
  playerTitle.textContent = title;
  playerDetail.textContent = item.product ? `${formatPrice(item.product.price, item.product.currency)} / licencia digital` : "Preview sin producto vinculado.";
  audio.play().catch(() => null);
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

function itemTitle(item) {
  return item.product?.name || item.beat?.title || "Beat";
}

function productPrice(item) {
  return item.product ? Number(item.product.price) : Number.POSITIVE_INFINITY;
}

function productCanBePurchased(product) {
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
