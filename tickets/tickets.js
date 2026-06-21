import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const state = {
  user: null,
  profile: null,
  events: [],
  tickets: [],
  currentEventKey: "",
};

const els = {
  adminPanel: document.getElementById("admin-panel"),
  sessionUser: document.getElementById("session-user"),
  pageMessage: document.getElementById("page-message"),
  form: document.getElementById("ticket-form"),
  eventKey: document.getElementById("event-key"),
  generateButton: document.getElementById("generate-button"),
  ticketsSection: document.getElementById("tickets-section"),
  ticketsList: document.getElementById("tickets-list"),
  ticketsEmpty: document.getElementById("tickets-empty"),
  ticketsTitle: document.getElementById("tickets-title"),
  batchCount: document.getElementById("batch-count"),
  printBatchButton: document.getElementById("print-batch-button"),
  refreshButton: document.getElementById("refresh-button"),
};

init();

async function init() {
  const sessionData = await requireSession();
  if (!sessionData) return;

  state.user = sessionData.user;
  state.profile = sessionData.profile;
  els.sessionUser.textContent = state.user.email || state.user.id;

  if (!hasAdminRole(state.profile?.roles)) {
    showMessage("No tienes permiso para crear tickets", "error");
    return;
  }

  els.adminPanel.hidden = false;
  bindEvents();
  await loadEvents();
}

async function requireSession() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    window.location.replace("/portal/login.html");
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id,email,roles,display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[Tickets] No fue posible consultar el perfil:", profileError);
  }

  return { user, profile };
}

function hasAdminRole(rawRoles = "") {
  return String(rawRoles)
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");
}

function bindEvents() {
  els.form.addEventListener("submit", handleGenerateTickets);
  els.eventKey.addEventListener("change", async () => {
    state.currentEventKey = normalizeEventKey(els.eventKey.value);
    await loadTicketsForEvent(state.currentEventKey);
  });
  els.refreshButton.addEventListener("click", () => loadTicketsForEvent(state.currentEventKey));
  els.printBatchButton.addEventListener("click", printBatch);
  els.ticketsList.addEventListener("click", handleTicketAction);
  window.addEventListener("afterprint", clearPrintState);
}

async function loadEvents() {
  setBusy(els.eventKey, true);

  const { data, error } = await supabase
    .from("events")
    .select("event_key,name,event_date,status")
    .order("event_date", { ascending: false });

  if (error) {
    showMessage(`No se pudieron cargar los eventos: ${friendlyError(error)}`, "error");
    els.eventKey.innerHTML = '<option value="">Sin eventos disponibles</option>';
    return;
  }

  state.events = (data || []).filter((event) => event.event_key);
  els.eventKey.innerHTML = [
    '<option value="">Selecciona un evento</option>',
    ...state.events.map((event) => (
      `<option value="${escapeHTML(event.event_key)}">${escapeHTML(eventLabel(event))}</option>`
    )),
  ].join("");
  setBusy(els.eventKey, false);
}

function eventLabel(event) {
  const date = event.event_date ? formatDate(event.event_date, false) : "Sin fecha";
  const name = event.name ? ` · ${event.name}` : "";
  return `${event.event_key}${name} · ${date}`;
}

async function handleGenerateTickets(event) {
  event.preventDefault();
  hideMessage();

  const formData = new FormData(els.form);
  const eventKey = normalizeEventKey(formData.get("event_key"));
  const quantity = Number.parseInt(formData.get("quantity"), 10);
  const price = Number.parseFloat(formData.get("price"));

  if (!eventKey || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    showMessage("Selecciona un evento y una cantidad entre 1 y 100.", "error");
    return;
  }

  if (!Number.isFinite(price) || price < 0) {
    showMessage("Captura un precio válido.", "error");
    return;
  }

  setBusy(els.generateButton, true, "Generando…");

  try {
    const nextNumber = await getNextTicketNumber(eventKey);
    const creator = state.user.email || state.user.id;
    const soldAt = new Date().toISOString();
    const customerName = cleanOptional(formData.get("customer_name"));
    const customerEmail = cleanOptional(formData.get("customer_email"));
    const notes = cleanOptional(formData.get("notes"));

    const rows = Array.from({ length: quantity }, (_, index) => {
      const folio = `${eventKey}-${String(nextNumber + index).padStart(4, "0")}`;
      return {
        event_key: eventKey,
        folio,
        qr_payload: buildValidationURL(folio),
        status: "valid",
        price,
        sold_at: soldAt,
        created_by: creator,
        customer_name: customerName,
        customer_email: customerEmail,
        notes,
      };
    });

    const { data, error } = await supabase
      .from("event_tickets")
      .insert(rows)
      .select("*");

    if (error) throw error;

    state.currentEventKey = eventKey;
    state.tickets = data || rows;
    renderTickets();
    showMessage(
      `${quantity} ticket${quantity === 1 ? "" : "s"} generado${quantity === 1 ? "" : "s"}: ${rows[0].folio}${quantity > 1 ? ` a ${rows.at(-1).folio}` : ""}.`,
      "success"
    );
  } catch (error) {
    console.error("[Tickets] Error al generar:", error);
    showMessage(`No fue posible generar los tickets: ${friendlyError(error)}`, "error");
  } finally {
    setBusy(els.generateButton, false, "Generar tickets");
  }
}

async function getNextTicketNumber(eventKey) {
  const { data, error } = await supabase
    .from("event_tickets")
    .select("folio")
    .eq("event_key", eventKey);

  if (error) throw error;

  const prefix = `${eventKey}-`;
  const max = (data || []).reduce((highest, ticket) => {
    const folio = String(ticket.folio || "");
    if (!folio.startsWith(prefix)) return highest;
    const consecutive = Number.parseInt(folio.slice(prefix.length), 10);
    return Number.isFinite(consecutive) ? Math.max(highest, consecutive) : highest;
  }, 0);

  return max + 1;
}

async function loadTicketsForEvent(eventKey) {
  if (!eventKey) {
    state.tickets = [];
    renderTickets();
    return;
  }

  setBusy(els.refreshButton, true, "Actualizando…");
  const { data, error } = await supabase
    .from("event_tickets")
    .select("*")
    .eq("event_key", eventKey)
    .order("sold_at", { ascending: false })
    .limit(200);

  setBusy(els.refreshButton, false, "Actualizar lista");

  if (error) {
    showMessage(`No se pudo cargar la lista: ${friendlyError(error)}`, "error");
    return;
  }

  state.tickets = data || [];
  renderTickets();
}

function renderTickets() {
  const hasTickets = state.tickets.length > 0;
  els.ticketsSection.hidden = false;
  els.ticketsEmpty.hidden = hasTickets;
  els.ticketsList.hidden = !hasTickets;
  els.batchCount.textContent = String(state.tickets.length);
  els.printBatchButton.disabled = !hasTickets;
  els.ticketsTitle.textContent = state.currentEventKey
    ? `Tickets · ${state.currentEventKey}`
    : "Lote generado";

  els.ticketsList.innerHTML = state.tickets.map(ticketCardHTML).join("");
  state.tickets.forEach((ticket) => renderQR(ticket));
}

function ticketCardHTML(ticket) {
  const status = normalizeStatus(ticket.status);
  return `
    <article class="ticket-card hr-ticket-card" data-folio="${escapeHTML(ticket.folio)}">
      <div class="ticket-card__qr" id="qr-${safeId(ticket.folio)}" aria-label="QR de ${escapeHTML(ticket.folio)}"></div>
      <div class="ticket-card__content">
        <div class="ticket-card__top">
          <h3 class="ticket-card__folio">${escapeHTML(ticket.folio)}</h3>
          <span class="ticket-status ticket-status--${status} hr-badge">${escapeHTML(statusLabel(status))}</span>
        </div>
        <div class="ticket-card__meta">
          <div>Evento<strong>${escapeHTML(ticket.event_key || "—")}</strong></div>
          <div>Precio<strong>${formatMoney(ticket.price)}</strong></div>
          ${ticket.customer_name ? `<div>Cliente<strong>${escapeHTML(ticket.customer_name)}</strong></div>` : ""}
          ${ticket.customer_email ? `<div>Email<strong>${escapeHTML(ticket.customer_email)}</strong></div>` : ""}
          ${ticket.notes ? `<div>Notas<strong>${escapeHTML(ticket.notes)}</strong></div>` : ""}
        </div>
        <div class="ticket-card__actions">
          <button class="ticket-btn ticket-btn--ghost hr-btn hr-btn-outline hr-btn-sm" type="button" data-action="print" data-folio="${escapeHTML(ticket.folio)}">
            Imprimir / PDF
          </button>
          <a class="ticket-btn ticket-btn--ghost hr-btn hr-btn-outline hr-btn-sm" href="${escapeHTML(ticket.qr_payload || buildValidationURL(ticket.folio))}" target="_blank" rel="noopener">
            Validar
          </a>
        </div>
      </div>
    </article>
  `;
}

function renderQR(ticket) {
  const container = document.getElementById(`qr-${safeId(ticket.folio)}`);
  if (!container) return;

  if (!window.QRCode) {
    container.textContent = "QR no disponible";
    return;
  }

  new window.QRCode(container, {
    text: ticket.qr_payload || buildValidationURL(ticket.folio),
    width: 110,
    height: 110,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: window.QRCode.CorrectLevel.M,
  });
}

function handleTicketAction(event) {
  const button = event.target.closest("[data-action='print']");
  if (!button) return;
  printSingle(button.dataset.folio);
}

function printSingle(folio) {
  clearPrintState();
  const card = [...document.querySelectorAll(".ticket-card")]
    .find((item) => item.dataset.folio === folio);
  if (!card) return;

  document.body.classList.add("print-single");
  card.dataset.printSelected = "true";
  window.print();
}

function printBatch() {
  clearPrintState();
  window.print();
}

function clearPrintState() {
  document.body.classList.remove("print-single");
  document.querySelectorAll("[data-print-selected]").forEach((card) => {
    delete card.dataset.printSelected;
  });
}

function buildValidationURL(folio) {
  const encodedFolio = encodeURIComponent(folio);
  if (window.location.origin && window.location.origin !== "null") {
    return `${window.location.origin}/tickets/validate.html?folio=${encodedFolio}`;
  }
  return `/tickets/validate.html?folio=${encodedFolio}`;
}

function normalizeEventKey(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeStatus(value) {
  const status = String(value || "").toLowerCase();
  return ["valid", "used", "cancelled"].includes(status) ? status : "invalid";
}

function statusLabel(status) {
  return {
    valid: "Válido",
    used: "Usado",
    cancelled: "Cancelado",
    invalid: "Inválido",
  }[status];
}

function cleanOptional(value) {
  const clean = String(value || "").trim();
  return clean || null;
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

function formatDate(value, includeTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }
  ).format(date);
}

function setBusy(element, busy, text) {
  element.disabled = busy;
  if (text) element.textContent = text;
}

function showMessage(message, type = "") {
  els.pageMessage.textContent = message;
  els.pageMessage.className = `ticket-alert hr-card${type ? ` ticket-alert--${type}` : ""}`;
  els.pageMessage.hidden = false;
}

function hideMessage() {
  els.pageMessage.hidden = true;
}

function friendlyError(error) {
  if (error?.code === "42501") return "Supabase bloqueó la operación por RLS.";
  if (error?.code === "23505") return "El folio ya existe. Actualiza la lista e intenta de nuevo.";
  return error?.message || "Error desconocido.";
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
