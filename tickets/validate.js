import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const state = {
  user: null,
  profile: null,
  permissions: [],
  ticket: null,
  canValidate: false,
};

const els = {
  sessionUser: document.getElementById("session-user"),
  pageMessage: document.getElementById("page-message"),
  form: document.getElementById("validate-form"),
  folioInput: document.getElementById("folio-input"),
  searchButton: document.getElementById("search-button"),
  result: document.getElementById("ticket-result"),
};

init();

async function init() {
  const sessionData = await requireSession();
  if (!sessionData) return;

  Object.assign(state, sessionData);
  state.canValidate = isAdmin(state.profile?.roles)
    || state.permissions.includes("tickets.validate");

  els.sessionUser.textContent = state.user.email || state.user.id;
  bindEvents();

  if (!state.canValidate) {
    showMessage("Tu sesión no tiene permiso para validar tickets.", "error");
    els.folioInput.disabled = true;
    els.searchButton.disabled = true;
    return;
  }

  const folio = normalizeFolio(new URLSearchParams(window.location.search).get("folio"));
  if (folio) {
    els.folioInput.value = folio;
    await findTicket(folio);
  }
}

async function requireSession() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    window.location.replace("/portal/login.html");
    return null;
  }

  const [profileResult, permissionsResult] = await Promise.all([
    supabase
      .from("users")
      .select("id,email,roles,display_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("user_permissions")
      .select("permission_key")
      .eq("user_id", user.id),
  ]);

  if (profileResult.error) {
    console.error("[Tickets] No fue posible consultar el perfil:", profileResult.error);
  }
  if (permissionsResult.error) {
    console.error("[Tickets] No fue posible consultar permisos:", permissionsResult.error);
  }

  return {
    user,
    profile: profileResult.data,
    permissions: (permissionsResult.data || [])
      .map((row) => row.permission_key)
      .filter(Boolean),
  };
}

function bindEvents() {
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const folio = normalizeFolio(els.folioInput.value);
    if (!folio) return;

    els.folioInput.value = folio;
    const url = new URL(window.location.href);
    url.searchParams.set("folio", folio);
    window.history.replaceState({}, "", url);
    await findTicket(folio);
  });

  els.result.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action='use-ticket']");
    if (button) await markTicketUsed();
  });
}

async function findTicket(folio) {
  hideMessage();
  setBusy(els.searchButton, true, "Buscando…");

  const { data, error } = await supabase
    .from("event_tickets")
    .select("*")
    .eq("folio", folio)
    .maybeSingle();

  setBusy(els.searchButton, false, "Buscar");

  if (error) {
    console.error("[Tickets] Error de consulta:", error);
    state.ticket = null;
    renderInvalid();
    showMessage(friendlyError(error), "error");
    return;
  }

  state.ticket = data || null;
  renderTicket();
}

function renderTicket() {
  if (!state.ticket) {
    renderInvalid();
    return;
  }

  const status = String(state.ticket.status || "").toLowerCase();
  if (status === "valid") renderValid();
  else if (status === "used") renderUsed();
  else if (status === "cancelled") renderCancelled();
  else renderInvalid();
}

function renderValid() {
  const ticket = state.ticket;
  els.result.className = "validator-result validator-result--valid";
  els.result.innerHTML = `
    <p class="validator-result__eyebrow">Acceso disponible</p>
    <h2>TICKET VÁLIDO</h2>
    <div class="validator-details">
      ${detailHTML("Folio", ticket.folio)}
      ${detailHTML("Evento", ticket.event_key)}
      ${detailHTML("Precio", formatMoney(ticket.price))}
      ${ticket.customer_name ? detailHTML("Cliente", ticket.customer_name) : ""}
    </div>
    <button class="ticket-btn ticket-btn--light" type="button" data-action="use-ticket"
            ${state.canValidate ? "" : "disabled"}>
      Marcar como usado
    </button>
  `;
}

function renderUsed() {
  const ticket = state.ticket;
  els.result.className = "validator-result validator-result--used";
  els.result.innerHTML = `
    <p class="validator-result__eyebrow">No permitir acceso de nuevo</p>
    <h2>TICKET YA USADO</h2>
    <div class="validator-details">
      ${detailHTML("Folio", ticket.folio)}
      ${detailHTML("Usado el", formatDate(ticket.used_at))}
      ${detailHTML("Validado por", ticket.used_by || "—")}
    </div>
  `;
}

function renderCancelled() {
  els.result.className = "validator-result validator-result--cancelled";
  els.result.innerHTML = `
    <p class="validator-result__eyebrow">Acceso denegado</p>
    <h2>TICKET CANCELADO</h2>
    <div class="validator-details">
      ${detailHTML("Folio", state.ticket?.folio || normalizeFolio(els.folioInput.value))}
    </div>
  `;
}

function renderInvalid() {
  els.result.className = "validator-result validator-result--invalid";
  els.result.innerHTML = `
    <p class="validator-result__eyebrow">Acceso denegado</p>
    <h2>TICKET INVÁLIDO</h2>
    <p>No se encontró un ticket con el folio ${escapeHTML(normalizeFolio(els.folioInput.value) || "indicado")}.</p>
  `;
}

async function markTicketUsed() {
  if (!state.ticket || !state.canValidate) return;

  const button = els.result.querySelector("[data-action='use-ticket']");
  setBusy(button, true, "Marcando…");

  const { data, error } = await supabase
    .rpc("mark_ticket_used", { ticket_folio: state.ticket.folio });

  if (error) {
    console.error("[Tickets] Error al marcar como usado:", error);
    showMessage(friendlyError(error), "error");
    setBusy(button, false, "Marcar como usado");
    return;
  }

  const updatedTicket = Array.isArray(data) ? data[0] : data;
  if (updatedTicket) {
    state.ticket = updatedTicket;
    renderTicket();
    showMessage("Ticket marcado como usado.", "success");
    return;
  }

  // Otra persona pudo validarlo al mismo tiempo; recargar muestra el estado real.
  await findTicket(state.ticket.folio);
  showMessage("El ticket ya no estaba disponible para validación.", "error");
}

function isAdmin(rawRoles = "") {
  return String(rawRoles)
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");
}

function detailHTML(label, value) {
  return `
    <div class="validator-detail">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value ?? "—")}</strong>
    </div>
  `;
}

function normalizeFolio(value) {
  return String(value || "").trim().toUpperCase();
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function setBusy(element, busy, text) {
  if (!element) return;
  element.disabled = busy;
  if (text) element.textContent = text;
}

function showMessage(message, type = "") {
  els.pageMessage.textContent = message;
  els.pageMessage.className = `ticket-alert${type ? ` ticket-alert--${type}` : ""}`;
  els.pageMessage.hidden = false;
}

function hideMessage() {
  els.pageMessage.hidden = true;
}

function friendlyError(error) {
  if (error?.code === "42501") return "Supabase bloqueó la operación por RLS.";
  return error?.message || "No fue posible completar la operación.";
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
