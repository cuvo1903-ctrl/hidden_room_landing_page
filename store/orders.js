import { supabase, escapeHtml } from "./store.js";

const statusElement = document.getElementById("orders-status");
const listElement = document.getElementById("orders-list");

initializeOrders();

async function initializeOrders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    sessionStorage.setItem("hr_return_after_login", "../store/orders.html");
    window.location.replace("../portal/");
    return;
  }

  const [{ data: orders, error: ordersError }, { data: downloads, error: downloadsError }] = await Promise.all([
    supabase
      .from("store_orders")
      .select("id, status, subtotal, total, currency, created_at, paid_at, store_order_items(id, product_id, product_name, quantity, unit_price, total)")
      .order("created_at", { ascending: false }),
    supabase
      .from("store_downloads")
      .select("id, order_id, product_id, file_url, available, download_count, created_at"),
  ]);

  if (ordersError || downloadsError) {
    statusElement.textContent = `No se pudieron cargar tus compras: ${(ordersError || downloadsError).message}`;
    return;
  }

  if (!orders?.length) {
    statusElement.textContent = "Todavía no tienes compras ligadas a esta cuenta.";
    listElement.innerHTML = '<a class="primary-button" href="index.html">Explorar tienda</a>';
    return;
  }

  statusElement.textContent = `${orders.length} compra${orders.length === 1 ? "" : "s"} encontrada${orders.length === 1 ? "" : "s"}.`;
  listElement.innerHTML = orders.map((order) => orderMarkup(
    order,
    (downloads ?? []).filter((download) => download.order_id === order.id),
  )).join("");
}

function orderMarkup(order, downloads) {
  return `
    <article class="order-card">
      <header>
        <div>
          <span class="product-category">${escapeHtml(statusLabel(order.status))}</span>
          <h2>Pedido ${escapeHtml(order.id.slice(0, 8).toUpperCase())}</h2>
        </div>
        <div class="order-meta">
          <strong>${formatPrice(order.total, order.currency)}</strong>
          <span>${formatDate(order.created_at)}</span>
        </div>
      </header>
      <div class="order-items">
        ${(order.store_order_items ?? []).map((item) => `
          <div class="summary-line">
            <span>${escapeHtml(item.product_name)} × ${item.quantity}</span>
            <span>${formatPrice(item.total, order.currency)}</span>
          </div>`).join("")}
      </div>
      ${downloads.length ? `
        <div class="downloads-panel">
          <h3>Descargas</h3>
          ${downloads.map((download) => download.available && download.file_url
            ? `<a class="secondary-button" href="${escapeHtml(download.file_url)}" target="_blank" rel="noopener">Descargar archivo</a>`
            : "<span>Descarga no disponible</span>").join("")}
        </div>` : ""}
    </article>`;
}

function statusLabel(status) {
  return {
    pending: "Pendiente",
    paid: "Pagado",
    cancelled: "Cancelado",
    refunded: "Reembolsado",
  }[status] || status;
}

function formatPrice(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: currency || "MXN",
  }).format(Number(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
