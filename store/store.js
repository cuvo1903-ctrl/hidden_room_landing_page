import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
import { PaymentForm } from "./payment-form.js";

export const SUPABASE_URL = "https://rpcunbkstadgngqrjafp.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO";
export const CART_STORAGE_KEY = "hidden_room_store_cart";
export const MP_PUBLIC_KEY = window.VITE_MP_PUBLIC_KEY || "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let products = [];
let currentSession = null;

document.addEventListener("DOMContentLoaded", initStore);
document.addEventListener("click", (event) => {
  const loginLink = event.target.closest("[data-store-login]");
  if (!loginLink) return;
  sessionStorage.setItem("hr_return_after_login", `../store/${location.pathname.split("/").pop() || "index.html"}`);
});

async function initStore() {
  updateCartCount();
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  syncAccountNavigation();

  const page = document.body.dataset.page;
  if (page === "catalog") await initializeCatalog();
  if (page === "product") await renderProduct();
  if (page === "cart") await renderCart();
  if (page === "checkout") await initializeCheckout();
  if (page === "success") initializeSuccess();
}

export async function fetchProducts() {
  const { data, error } = await supabase
    .from("store_products")
    .select("id, slug, name, description, category, price, currency, image_url, stock, is_digital, featured")
    .eq("is_active", true)
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`No se pudo cargar la tienda: ${error.message}`);
  products = data ?? [];
  return products;
}

async function fetchProductsByIds(ids) {
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("store_products")
    .select("id, slug, name, description, category, price, currency, image_url, stock, is_digital, featured")
    .eq("is_active", true)
    .in("id", ids);

  if (error) throw new Error(`No se pudo validar el carrito: ${error.message}`);
  return data ?? [];
}

function getCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];

    return stored
      .map((item) => ({
        id: String(item?.id ?? ""),
        quantity: Math.max(1, Math.min(10, Number.parseInt(item?.quantity, 10) || 1)),
      }))
      .filter((item) => item.id);
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  updateCartCount();
}

function clearCart() {
  localStorage.removeItem(CART_STORAGE_KEY);
  updateCartCount();
}

function addToCart(productId, quantity = 1) {
  const product = products.find((candidate) => candidate.id === productId);
  if (!product || !productCanBePurchased(product)) return;

  const cart = getCart();
  const existing = cart.find((item) => item.id === productId);
  const maximum = product.stock === null ? 10 : Math.min(10, product.stock);

  if (existing) existing.quantity = Math.min(maximum, existing.quantity + quantity);
  else cart.push({ id: productId, quantity: Math.min(maximum, Math.max(1, quantity)) });

  saveCart(cart);
  showNotice("Producto agregado al carrito");
}

function setQuantity(productId, quantity, product) {
  const cart = getCart();
  const item = cart.find((candidate) => candidate.id === productId);
  if (!item) return;

  if (quantity <= 0) {
    saveCart(cart.filter((candidate) => candidate.id !== productId));
    return;
  }

  const maximum = product.stock === null ? 10 : Math.min(10, product.stock);
  item.quantity = Math.min(maximum, quantity);
  saveCart(cart);
}

function updateCartCount() {
  const count = getCart().reduce((total, item) => total + item.quantity, 0);
  document.querySelectorAll(".cart-count").forEach((element) => {
    element.textContent = String(count);
  });
}

async function validatedCart() {
  const cart = getCart();
  const liveProducts = await fetchProductsByIds(cart.map((item) => item.id));
  products = liveProducts;
  const validItems = [];

  for (const cartItem of cart) {
    const product = liveProducts.find((candidate) => candidate.id === cartItem.id);
    if (!product || !productCanBePurchased(product)) continue;

    const maximum = product.stock === null ? 10 : Math.min(10, product.stock);
    validItems.push({ ...product, quantity: Math.min(cartItem.quantity, maximum) });
  }

  saveCart(validItems.map(({ id, quantity }) => ({ id, quantity })));
  return validItems;
}

async function initializeCatalog() {
  const grid = document.getElementById("product-grid");

  try {
    await fetchProducts();
    populateCategoryFilter();
    renderCatalog();
  } catch (error) {
    grid.innerHTML = errorState(error.message);
  }

  document.getElementById("product-search")?.addEventListener("input", renderCatalog);
  document.getElementById("category-filter")?.addEventListener("change", renderCatalog);
  grid?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-product]");
    if (button) addToCart(button.dataset.addProduct);
  });
}

function populateCategoryFilter() {
  const select = document.getElementById("category-filter");
  if (!select) return;

  const categories = [...new Set(products.map((product) => product.category))].sort();
  select.innerHTML = [
    '<option value="">Todas las categorías</option>',
    ...categories.map((category) => (
      `<option value="${escapeHtml(category)}">${escapeHtml(categoryLabel(category))}</option>`
    )),
  ].join("");
}

function renderCatalog() {
  const grid = document.getElementById("product-grid");
  if (!grid) return;

  const search = document.getElementById("product-search")?.value.trim().toLowerCase() ?? "";
  const category = document.getElementById("category-filter")?.value ?? "";
  const filtered = products.filter((product) => {
    const haystack = `${product.name} ${product.description ?? ""} ${product.category}`.toLowerCase();
    return (!search || haystack.includes(search)) && (!category || product.category === category);
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><h2>Sin resultados</h2><p>Prueba otra búsqueda o categoría.</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(productCardMarkup).join("");
}

function productCardMarkup(product) {
  const soldOut = !productCanBePurchased(product);
  return `
    <article class="product-card">
      ${productVisualMarkup(product)}
      <span class="product-category">${escapeHtml(categoryLabel(product.category))}${product.featured ? " · Featured" : ""}</span>
      <h3>${escapeHtml(product.name)}</h3>
      <p class="product-description">${escapeHtml(product.description || "Producto Hidden Room.")}</p>
      <p class="product-price">${formatPrice(product.price, product.currency)}</p>
      <div class="product-actions">
        <a class="secondary-button" href="product.html?slug=${encodeURIComponent(product.slug)}">Ver producto</a>
        <button class="primary-button" type="button" data-add-product="${escapeHtml(product.id)}" ${soldOut ? "disabled" : ""}>
          ${soldOut ? "Agotado" : "Agregar"}
        </button>
      </div>
    </article>`;
}

async function renderProduct() {
  const container = document.getElementById("product-detail");
  const slug = new URLSearchParams(window.location.search).get("slug")?.trim();

  if (!slug) {
    container.innerHTML = errorState("Falta el producto en la URL.");
    return;
  }

  const { data: product, error } = await supabase
    .from("store_products")
    .select("id, slug, name, description, category, price, currency, image_url, stock, is_digital, featured")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !product) {
    container.innerHTML = errorState("Este producto no existe o ya no está disponible.");
    return;
  }

  products = [product];
  const soldOut = !productCanBePurchased(product);
  document.title = `${product.name} | Hidden Room`;
  container.innerHTML = `
    ${productVisualMarkup(product)}
    <div>
      <span class="product-category">${escapeHtml(categoryLabel(product.category))}</span>
      <h1>${escapeHtml(product.name)}</h1>
      <p class="product-description">${escapeHtml(product.description || "Producto Hidden Room.")}</p>
      <p class="product-price">${formatPrice(product.price, product.currency)}</p>
      <p class="stock-note">${stockLabel(product)}</p>
      <button class="primary-button" id="add-detail-product" type="button" ${soldOut ? "disabled" : ""}>
        ${soldOut ? "Agotado" : "Agregar al carrito"}
      </button>
    </div>`;

  document.getElementById("add-detail-product")
    ?.addEventListener("click", () => addToCart(product.id));
}

async function renderCart() {
  const itemsContainer = document.getElementById("cart-items");
  const summary = document.getElementById("cart-summary");

  try {
    const items = await validatedCart();
    if (!items.length) {
      itemsContainer.innerHTML = emptyCartMarkup();
      summary.innerHTML = "";
      return;
    }

    itemsContainer.innerHTML = items.map((item) => `
      <article class="cart-row">
        <div>
          <span class="product-category">${escapeHtml(categoryLabel(item.category))}</span>
          <h2>${escapeHtml(item.name)}</h2>
          <p>${formatPrice(item.price, item.currency)} por unidad</p>
          <div class="quantity-control" aria-label="Cantidad de ${escapeHtml(item.name)}">
            <button type="button" data-quantity="${escapeHtml(item.id)}" data-change="-1" aria-label="Reducir cantidad">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-quantity="${escapeHtml(item.id)}" data-change="1" aria-label="Aumentar cantidad">+</button>
          </div>
        </div>
        <div class="cart-row-side">
          <strong>${formatPrice(Number(item.price) * item.quantity, item.currency)}</strong><br>
          <button class="remove-button" type="button" data-remove="${escapeHtml(item.id)}">Eliminar</button>
        </div>
      </article>`).join("");

    summary.innerHTML = orderSummaryMarkup(items, true);
    itemsContainer.onclick = async (event) => {
      const quantityButton = event.target.closest("[data-quantity]");
      const removeButton = event.target.closest("[data-remove]");

      if (quantityButton) {
        const item = items.find((candidate) => candidate.id === quantityButton.dataset.quantity);
        setQuantity(item.id, item.quantity + Number(quantityButton.dataset.change), item);
        await renderCart();
      }
      if (removeButton) {
        const item = items.find((candidate) => candidate.id === removeButton.dataset.remove);
        setQuantity(item.id, 0, item);
        await renderCart();
      }
    };
  } catch (error) {
    itemsContainer.innerHTML = errorState(error.message);
    summary.innerHTML = "";
  }
}

async function initializeCheckout() {
  const form = document.getElementById("checkout-form");
  const summary = document.getElementById("checkout-summary");
  const errorElement = document.getElementById("checkout-error");
  const button = document.getElementById("checkout-button");
  const accountNotice = document.getElementById("checkout-account-notice");
  const paymentPanel = document.getElementById("payment-panel");
  const paymentStatus = document.getElementById("payment-status");

  let items = [];
  let paymentForm = null;
  try {
    items = await validatedCart();
  } catch (error) {
    errorElement.textContent = error.message;
  }

  if (currentSession?.user) {
    document.getElementById("customer-email").value = currentSession.user.email ?? "";
    accountNotice.innerHTML = 'Esta compra quedará guardada en <a href="orders.html">Mis compras</a>.';
  } else {
    accountNotice.innerHTML = 'Inicia sesión para guardar tus compras y descargas en tu cuenta. <a href="../portal/" data-store-login>Iniciar sesión</a>';
  }

  summary.innerHTML = items.length ? orderSummaryMarkup(items, false) : emptyCartMarkup();
  if (!items.length) {
    button.disabled = true;
    errorElement.textContent ||= "No hay productos disponibles en el carrito.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorElement.textContent = "";

    try {
      items = await validatedCart();
      if (!items.length) throw new Error("No hay productos en el carrito.");

      const formData = new FormData(form);
      const customerData = {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        phone: String(formData.get("phone") || "").trim(),
      };

      if (!customerData.name || !customerData.email || !customerData.phone) {
        throw new Error("Completa nombre, correo y teléfono.");
      }

      button.disabled = true;
      button.textContent = "Preparando pago...";
      paymentPanel.hidden = false;
      paymentStatus.textContent = "Carga el formulario seguro para ingresar tu tarjeta.";

      const total = items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
      paymentForm?.unmount();
      paymentForm = new PaymentForm({
        publicKey: MP_PUBLIC_KEY,
        amount: Math.round(total * 100) / 100,
        containerId: "cardPaymentBrick_container",
        onReady: () => {
          paymentStatus.textContent = "Formulario listo.";
        },
        onError: (error) => {
          console.error("Mercado Pago Brick error", error);
          paymentStatus.textContent = "Mercado Pago no pudo cargar el formulario.";
        },
        onSubmit: async (cardData) => {
          paymentStatus.textContent = "Procesando pago...";
          const result = await createMercadoPagoOrder(customerData, items, cardData);
          if (["approved", "paid", "authorized"].includes(result.status)) {
            clearCart();
            window.location.assign(`success.html?provider=mercadopago&order_id=${encodeURIComponent(result.order_id)}`);
            return;
          }
          paymentStatus.textContent = `Mercado Pago respondio: ${result.status || "pendiente"}.`;
          throw new Error("El pago no fue aprobado.");
        },
      });
      await paymentForm.mount();
    } catch (error) {
      errorElement.textContent = error.message || "No se pudo iniciar el pago.";
      button.disabled = false;
      button.textContent = "Continuar al pago";
    }
  });
}


export async function createMercadoPagoOrder(customerData, cartItems, cardData) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token ?? SUPABASE_ANON_KEY;
  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-order`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "mercadopago",
      customer: customerData,
      items: cartItems.map((item) => ({ id: item.id, quantity: item.quantity })),
      card: cardData,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Mercado Pago no esta disponible.");
  return result;
}
export async function createStripeCheckout(customerData, cartItems) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token ?? SUPABASE_ANON_KEY;
  const response = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer: customerData,
      items: cartItems.map((item) => ({ id: item.id, quantity: item.quantity })),
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Stripe Checkout no está disponible.");
  if (!result.url || !String(result.url).startsWith("https://")) {
    throw new Error("La respuesta de checkout no contiene una URL válida.");
  }
  return result.url;
}

function initializeSuccess() {
  clearCart();
  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get("session_id");
  const provider = query.get("provider");
  const detail = document.getElementById("success-detail");
  const accountAction = document.getElementById("success-account-action");

  detail.textContent = sessionId
    ? "Stripe está confirmando tu pago. Recibirás la confirmación por correo."
    : "Recibimos el regreso desde el checkout. Revisa tu correo para confirmar el pago.";

  if (currentSession?.user) {
    accountAction.innerHTML = '<a class="primary-button" href="orders.html">Mis compras</a>';
  } else {
    accountAction.innerHTML = "<p>Revisa tu correo para consultar los detalles de tu compra.</p>";
  }
}

function syncAccountNavigation() {
  document.querySelectorAll("[data-auth-link]").forEach((link) => {
    link.hidden = !currentSession;
  });

  document.querySelectorAll("[data-hr-account]").forEach((link) => {
    link.textContent = currentSession?.user?.email || "Portal";
    link.href = currentSession ? "/portal/dashboard.html" : "/portal/";
  });
}

function orderSummaryMarkup(items, includeButton) {
  const currency = items[0]?.currency || "MXN";
  const total = items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  return `
    <h2>Resumen</h2>
    ${items.map((item) => `
      <div class="summary-line">
        <span>${escapeHtml(item.name)} × ${item.quantity}</span>
        <span>${formatPrice(Number(item.price) * item.quantity, item.currency)}</span>
      </div>`).join("")}
    <div class="summary-line summary-total">
      <span>Total</span>
      <span>${formatPrice(total, currency)}</span>
    </div>
    ${includeButton ? '<a class="primary-button" href="checkout.html">Continuar al checkout</a>' : ""}`;
}

function productVisualMarkup(product) {
  if (product.image_url) {
    return `<div class="product-art product-art--image"><img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}"></div>`;
  }
  return `<div class="product-art" aria-hidden="true">${escapeHtml(product.name.slice(0, 3).toUpperCase())}</div>`;
}

function productCanBePurchased(product) {
  return product.stock === null || Number(product.stock) > 0;
}

function stockLabel(product) {
  if (product.is_digital || product.stock === null) return "Disponible";
  if (product.stock <= 0) return "Agotado";
  return `${product.stock} disponibles`;
}

function categoryLabel(category) {
  return {
    merch: "Merch",
    beats: "Beats",
    digital: "Digital",
    eventos: "Eventos",
  }[category] || category;
}

function formatPrice(amount, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "MXN",
  }).format(Number(amount));
}

function emptyCartMarkup() {
  return '<div class="empty-state"><h2>Tu carrito está vacío</h2><p>Explora el catálogo para comenzar.</p><a class="primary-button" href="index.html">Ir a la tienda</a></div>';
}

function errorState(message) {
  return `<div class="empty-state"><h2>No pudimos cargar esto</h2><p>${escapeHtml(message)}</p><a class="primary-button" href="index.html">Volver a la tienda</a></div>`;
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

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Futuras pasarelas:
// TODO: createPayPalCheckout(customerData, cartItems)





