import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const TICKET_TYPES = ["COVER", "ESTÁNDAR", "VIP", "2x1", "3x2", "3x1", "ACREDITACIÓN"];

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
  deleteBatchForm: document.getElementById("delete-batch-form"),
  deleteEventKey: document.getElementById("delete-event-key"),
  deleteFolioStart: document.getElementById("delete-folio-start"),
  deleteFolioEnd: document.getElementById("delete-folio-end"),
  deleteBatchButton: document.getElementById("delete-batch-button"),
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
  els.deleteBatchForm?.addEventListener("submit", handleDeleteBatch);
  els.deleteEventKey?.addEventListener("change", () => loadDeleteFolioOptions(normalizeEventKey(els.deleteEventKey.value)));
  els.eventKey.addEventListener("change", async () => {
    state.currentEventKey = normalizeEventKey(els.eventKey.value);
    if (els.deleteEventKey) {
      els.deleteEventKey.value = state.currentEventKey;
      await loadDeleteFolioOptions(state.currentEventKey);
    }
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
  const eventOptions = [
    '<option value="">Selecciona un evento</option>',
    ...state.events.map((event) => (
      `<option value="${escapeHTML(event.event_key)}">${escapeHTML(eventLabel(event))}</option>`
    )),
  ].join("");
  els.eventKey.innerHTML = eventOptions;
  if (els.deleteEventKey) {
    els.deleteEventKey.innerHTML = eventOptions;
    els.deleteEventKey.disabled = false;
    resetDeleteFolioOptions("Selecciona evento");
  }
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
  const ticketType = cleanTicketType(formData.get("ticket_type"));

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
      const folio = buildFolio(eventKey, nextNumber + index);
      return {
        event_key: eventKey,
        folio,
        qr_payload: buildValidationURL(folio),
        status: "valid",
        ticket_type: ticketType,
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
    if (els.deleteEventKey?.value === eventKey) await loadDeleteFolioOptions(eventKey);
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

async function loadDeleteFolioOptions(eventKey) {
  resetDeleteFolioOptions(eventKey ? "Cargando folios..." : "Selecciona evento");
  if (!eventKey) return;

  const { data, error } = await supabase
    .from("event_tickets")
    .select("folio")
    .eq("event_key", eventKey)
    .order("folio", { ascending: true })
    .limit(1000);

  if (error) {
    showMessage("No se pudieron cargar los folios del lote: " + friendlyError(error), "error");
    resetDeleteFolioOptions("Sin folios");
    return;
  }

  const options = (data || [])
    .map((ticket) => ticketNumberFromFolio(eventKey, ticket.folio))
    .filter((number) => Number.isInteger(number) && number > 0)
    .sort((a, b) => a - b);

  if (!options.length) {
    resetDeleteFolioOptions("Sin folios");
    return;
  }

  const html = options.map((number) => {
    const folio = buildFolio(eventKey, number);
    return '<option value="' + number + '">' + escapeHTML(folio) + '</option>';
  }).join("");

  els.deleteFolioStart.innerHTML = html;
  els.deleteFolioEnd.innerHTML = html;
  els.deleteFolioStart.disabled = false;
  els.deleteFolioEnd.disabled = false;
  els.deleteFolioStart.value = String(options[0]);
  els.deleteFolioEnd.value = String(options.at(-1));
}

function resetDeleteFolioOptions(label) {
  if (!els.deleteFolioStart || !els.deleteFolioEnd) return;
  const option = '<option value="">' + escapeHTML(label) + '</option>';
  els.deleteFolioStart.innerHTML = option;
  els.deleteFolioEnd.innerHTML = option;
  els.deleteFolioStart.disabled = true;
  els.deleteFolioEnd.disabled = true;
}

async function handleDeleteBatch(event) {
  event.preventDefault();
  hideMessage();

  const formData = new FormData(els.deleteBatchForm);
  const eventKey = normalizeEventKey(formData.get("event_key"));
  const startNumber = Number.parseInt(formData.get("start_number"), 10);
  const endNumber = Number.parseInt(formData.get("end_number"), 10);

  if (!eventKey || !Number.isInteger(startNumber) || !Number.isInteger(endNumber) || startNumber < 1 || endNumber < 1) {
    showMessage("Selecciona un evento y captura un rango de folios valido.", "error");
    return;
  }

  if (startNumber > endNumber) {
    showMessage("El folio inicial no puede ser mayor que el folio final.", "error");
    return;
  }

  const firstFolio = buildFolio(eventKey, startNumber);
  const lastFolio = buildFolio(eventKey, endNumber);
  const total = endNumber - startNumber + 1;
  const confirmed = window.confirm(
    "Vas a eliminar " + total + " ticket" + (total === 1 ? "" : "s") + " de " + eventKey + ": " + firstFolio + " a " + lastFolio + ". Esta accion no se puede deshacer.",
  );
  if (!confirmed) return;

  setBusy(els.deleteBatchButton, true, "Eliminando...");
  const { data, error } = await supabase.rpc("delete_ticket_batch", {
    p_event_key: eventKey,
    p_start_number: startNumber,
    p_end_number: endNumber,
  });
  setBusy(els.deleteBatchButton, false, "Eliminar lote");

  if (error) {
    showMessage("No se pudo eliminar el lote: " + friendlyError(error), "error");
    return;
  }

  const deletedCount = Number(data || 0);
  showMessage(deletedCount + " ticket" + (deletedCount === 1 ? "" : "s") + " eliminado" + (deletedCount === 1 ? "" : "s") + ".", "success");
  await loadDeleteFolioOptions(eventKey);
  if (state.currentEventKey === eventKey) await loadTicketsForEvent(eventKey);
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
          <div>TICKET<strong>${escapeHTML(cleanTicketType(ticket.ticket_type))}</strong></div>
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
  const ticket = state.tickets.find((item) => item.folio === folio);
  preparePrintPages(ticket ? [ticket] : []);
  window.print();
}

function printBatch() {
  clearPrintState();
  preparePrintPages(state.tickets);
  window.print();
}

function preparePrintPages(tickets) {
  const printableTickets = Array.isArray(tickets) ? tickets.filter(Boolean) : [];
  const pagesRoot = document.querySelector("[data-print-pages]");
  if (!pagesRoot) return;

  const pageSize = 44;
  const emission = formatDate(new Date().toISOString());
  const pages = [];
  for (let index = 0; index < printableTickets.length; index += pageSize) {
    pages.push(printableTickets.slice(index, index + pageSize));
  }

  pagesRoot.innerHTML = pages.map((pageTickets) => {
    const eventKey = pageTickets[0]?.event_key || state.currentEventKey || "-";
    const total = pageTickets.reduce((sum, ticket) => {
      const price = Number(ticket?.price);
      return Number.isFinite(price) ? sum + price : sum;
    }, 0);

    return `
      <section class="ticket-print-page">
        <header class="ticket-print-header">
          <div class="ticket-print-header__brand">
            <img src="/assets/img/white_logo.webp" alt="">
            <strong>${escapeHTML(eventKey)}</strong>
          </div>
          <div>
            <span>EMISIÓN</span>
            <strong>${escapeHTML(emission)}</strong>
          </div>
          <div>
            <span>PAGARÉ POR</span>
            <strong>${escapeHTML(formatMoney(total))}</strong>
          </div>
        </header>
        <div class="ticket-print-grid">
          ${pageTickets.map(printTicketCardHTML).join("")}
        </div>
      </section>
    `;
  }).join("");

  renderPrintQRs(printableTickets);
}

function printTicketCardHTML(ticket) {
  const qrId = `print-qr-${safeId(ticket.folio)}`;
  return `
    <article class="ticket-print-card">
      <div class="ticket-print-card__qr" id="${escapeHTML(qrId)}" aria-label="QR de ${escapeHTML(ticket.folio)}"></div>
      <div class="ticket-print-card__meta">
        <div>TICKET<strong>${escapeHTML(cleanTicketType(ticket.ticket_type))}</strong></div>
        <div>Precio<strong>${formatMoney(ticket.price)}</strong></div>
      </div>
    </article>
  `;
}

function renderPrintQRs(tickets) {
  if (!window.QRCode) return;
  tickets.forEach((ticket) => {
    const container = document.getElementById(`print-qr-${safeId(ticket.folio)}`);
    if (!container) return;
    container.innerHTML = "";
    new window.QRCode(container, {
      text: ticket.qr_payload || buildValidationURL(ticket.folio),
      width: 92,
      height: 92,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  });
}

function clearPrintState() {
  document.body.classList.remove("print-single");
  document.querySelectorAll("[data-print-selected]").forEach((card) => {
    delete card.dataset.printSelected;
  });
  document.querySelector("[data-print-pages]")?.replaceChildren();
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

function buildFolio(eventKey, number) {
  return eventKey + "-" + String(number).padStart(4, "0");
}

function ticketNumberFromFolio(eventKey, folio) {
  const prefix = eventKey + "-";
  const value = String(folio || "");
  if (!value.startsWith(prefix)) return null;
  const number = Number.parseInt(value.slice(prefix.length), 10);
  return Number.isFinite(number) ? number : null;
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

function cleanTicketType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return TICKET_TYPES.includes(normalized) ? normalized : "COVER";
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
