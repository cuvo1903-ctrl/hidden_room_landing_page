import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const TICKET_TYPES = ["COVER", "ESTÁNDAR", "VIP", "2x1", "3x2", "3x1", "ACREDITACIÓN"];

const state = {
  user: null,
  profile: null,
  permissions: [],
  tickets: [],
  currentEventKey: "",
  canEdit: false,
};

const els = {
  sessionUser: document.getElementById("session-user"),
  pageMessage: document.getElementById("page-message"),
  viewPanel: document.getElementById("view-panel"),
  eventKey: document.getElementById("event-key"),
  refreshButton: document.getElementById("refresh-button"),
  printBatchButton: document.getElementById("print-batch-button"),
  downloadPdfButton: document.getElementById("download-pdf-button"),
  viewSummary: document.getElementById("view-summary"),
  totalCount: document.getElementById("total-count"),
  validCount: document.getElementById("valid-count"),
  usedCount: document.getElementById("used-count"),
  cancelledCount: document.getElementById("cancelled-count"),
  ticketsSection: document.getElementById("tickets-section"),
  ticketsTitle: document.getElementById("tickets-title"),
  ticketsList: document.getElementById("tickets-list"),
  ticketsEmpty: document.getElementById("tickets-empty"),
};

init();

async function init() {
  const sessionData = await requireViewSession();
  if (!sessionData) return;

  state.user = sessionData.user;
  state.profile = sessionData.profile;
  state.permissions = sessionData.permissions;
  state.canEdit = hasAdminRole(state.profile?.roles)
    || state.permissions.includes("tickets.edit");
  els.sessionUser.textContent = state.user.email || state.user.id;
  els.viewPanel.hidden = false;

  bindEvents();
  await loadEvents();
}

async function requireViewSession() {
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

  const profile = profileResult.data;
  const permissions = (permissionsResult.data || [])
    .map((row) => row.permission_key)
    .filter(Boolean);
  const canView = hasAdminRole(profile?.roles)
    || permissions.includes("tickets.view")
    || permissions.includes("tickets.edit");

  if (!canView) {
    els.sessionUser.textContent = user.email || user.id;
    showMessage("No tienes permiso para ver tickets. Solicita el permiso tickets.view.", "error");
    return null;
  }

  return { user, profile, permissions };
}

function bindEvents() {
  els.eventKey.addEventListener("change", async () => {
    state.currentEventKey = normalizeEventKey(els.eventKey.value);
    syncEventInURL(state.currentEventKey);
    await loadTickets();
  });

  els.refreshButton.addEventListener("click", loadTickets);
  els.printBatchButton.addEventListener("click", printBatch);
  els.downloadPdfButton?.addEventListener("click", downloadBatchPDF);
  els.ticketsList.addEventListener("click", handleTicketAction);
  els.ticketsList.addEventListener("submit", handleTicketEdit);
  window.addEventListener("afterprint", clearPrintState);
}

async function loadEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("event_key,name,event_date,status")
    .order("event_date", { ascending: false });

  if (error) {
    showMessage(`No se pudieron cargar los eventos: ${friendlyError(error)}`, "error");
    els.eventKey.innerHTML = '<option value="">Sin eventos disponibles</option>';
    return;
  }

  const events = (data || []).filter((event) => event.event_key);
  els.eventKey.innerHTML = [
    '<option value="">Selecciona un evento</option>',
    ...events.map((event) => (
      `<option value="${escapeHTML(event.event_key)}">${escapeHTML(eventLabel(event))}</option>`
    )),
  ].join("");
  els.eventKey.disabled = false;

  const requestedEvent = normalizeEventKey(new URLSearchParams(window.location.search).get("event"));
  if (requestedEvent && events.some((event) => normalizeEventKey(event.event_key) === requestedEvent)) {
    els.eventKey.value = requestedEvent;
    state.currentEventKey = requestedEvent;
    await loadTickets();
  }
}

async function loadTickets() {
  hideMessage();

  if (!state.currentEventKey) {
    state.tickets = [];
    renderTickets();
    return;
  }

  setBusy(els.refreshButton, true, "Actualizando…");
  const { data, error } = await supabase
    .from("event_tickets")
    .select("*")
    .eq("event_key", state.currentEventKey)
    .order("folio", { ascending: true })
    .limit(1000);
  setBusy(els.refreshButton, false, "Actualizar");

  if (error) {
    showMessage(`No se pudieron cargar los tickets: ${friendlyError(error)}`, "error");
    return;
  }

  state.tickets = data || [];
  renderTickets();
}

function renderTickets() {
  const hasEvent = Boolean(state.currentEventKey);
  const hasTickets = state.tickets.length > 0;

  els.refreshButton.disabled = !hasEvent;
  els.printBatchButton.disabled = !hasTickets;
  if (els.downloadPdfButton) els.downloadPdfButton.disabled = !hasTickets;
  els.ticketsSection.hidden = !hasEvent;
  els.viewSummary.hidden = !hasEvent;
  els.ticketsEmpty.hidden = hasTickets;
  els.ticketsList.hidden = !hasTickets;
  els.ticketsTitle.textContent = state.currentEventKey
    ? `Tickets · ${state.currentEventKey}`
    : "Tickets";

  renderSummary();
  els.ticketsList.innerHTML = state.tickets.map(ticketCardHTML).join("");
  state.tickets.forEach(renderQR);
}

function renderSummary() {
  const counts = state.tickets.reduce((result, ticket) => {
    const status = normalizeStatus(ticket.status);
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});

  els.totalCount.textContent = String(state.tickets.length);
  els.validCount.textContent = String(counts.valid || 0);
  els.usedCount.textContent = String(counts.used || 0);
  els.cancelledCount.textContent = String(counts.cancelled || 0);
}

function ticketCardHTML(ticket) {
  const status = normalizeStatus(ticket.status);
  return `
    <article class="ticket-card hr-ticket-card" data-folio="${escapeHTML(ticket.folio)}">
      <div class="ticket-card__qr" id="view-qr-${safeId(ticket.folio)}" aria-label="QR de ${escapeHTML(ticket.folio)}"></div>
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
          ${ticket.sold_at ? `<div>Generado<strong>${escapeHTML(formatDate(ticket.sold_at))}</strong></div>` : ""}
          ${ticket.used_at ? `<div>Usado<strong>${escapeHTML(formatDate(ticket.used_at))}</strong></div>` : ""}
        </div>
        <div class="ticket-card__actions">
          <button class="ticket-btn ticket-btn--ghost hr-btn hr-btn-outline hr-btn-sm" type="button" data-action="print" data-folio="${escapeHTML(ticket.folio)}">
            Imprimir / PDF
          </button>
          <a class="ticket-btn ticket-btn--ghost hr-btn hr-btn-outline hr-btn-sm" href="${escapeHTML(ticket.qr_payload || buildValidationURL(ticket.folio))}" target="_blank" rel="noopener">
            Validar
          </a>
          ${state.canEdit ? `
            <button class="ticket-btn ticket-btn--ghost hr-btn hr-btn-outline hr-btn-sm" type="button" data-action="edit" data-folio="${escapeHTML(ticket.folio)}">
              Editar
            </button>
          ` : ""}
        </div>
        ${state.canEdit ? ticketEditFormHTML(ticket) : ""}
      </div>
    </article>
  `;
}

function renderQR(ticket) {
  const container = document.getElementById(`view-qr-${safeId(ticket.folio)}`);
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
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "print") printSingle(button.dataset.folio);
  if (button.dataset.action === "edit") toggleEditForm(button.dataset.folio);
  if (button.dataset.action === "cancel-edit") toggleEditForm(button.dataset.folio, false);
}

function ticketEditFormHTML(ticket) {
  return `
    <form class="ticket-edit-form hr-form-grid" data-edit-folio="${escapeHTML(ticket.folio)}" hidden>
      <label class="ticket-field hr-field">
        <span>Precio</span>
        <input class="hr-input" name="price" type="number" min="0" step="0.01" value="${escapeHTML(ticket.price ?? 0)}" required>
      </label>
      <label class="ticket-field hr-field">
        <span>TICKET</span>
        <select class="hr-select" name="ticket_type">
          ${ticketTypeOptionsHTML(ticket.ticket_type)}
        </select>
      </label>
      <label class="ticket-field hr-field">
        <span>Estado</span>
        <select class="hr-select" name="status">
          ${["valid", "used", "cancelled"].map((status) => (
            `<option value="${status}" ${normalizeStatus(ticket.status) === status ? "selected" : ""}>${statusLabel(status)}</option>`
          )).join("")}
        </select>
      </label>
      <label class="ticket-field hr-field">
        <span>Cliente</span>
        <input class="hr-input" name="customer_name" maxlength="160" value="${escapeHTML(ticket.customer_name || "")}">
      </label>
      <label class="ticket-field hr-field">
        <span>Email</span>
        <input class="hr-input" name="customer_email" type="email" maxlength="254" value="${escapeHTML(ticket.customer_email || "")}">
      </label>
      <label class="ticket-field ticket-field--wide">
        <span>Notas</span>
        <textarea name="notes" rows="2" maxlength="1000">${escapeHTML(ticket.notes || "")}</textarea>
      </label>
      <div class="ticket-edit-form__actions ticket-field--wide">
        <button class="ticket-btn ticket-btn--primary hr-btn hr-btn-primary" type="submit">Guardar cambios</button>
        <button class="ticket-btn ticket-btn--ghost hr-btn hr-btn-outline" type="button" data-action="cancel-edit" data-folio="${escapeHTML(ticket.folio)}">Cancelar</button>
      </div>
    </form>
  `;
}

function toggleEditForm(folio, forceOpen) {
  const form = [...document.querySelectorAll("[data-edit-folio]")]
    .find((item) => item.dataset.editFolio === folio);
  if (!form) return;
  form.hidden = forceOpen === undefined ? !form.hidden : !forceOpen;
}

async function handleTicketEdit(event) {
  const form = event.target.closest("[data-edit-folio]");
  if (!form || !state.canEdit) return;
  event.preventDefault();

  const submitButton = form.querySelector("button[type='submit']");
  const values = Object.fromEntries(new FormData(form).entries());
  const price = Number.parseFloat(values.price);
  if (!Number.isFinite(price) || price < 0) {
    showMessage("Captura un precio válido.", "error");
    return;
  }

  setBusy(submitButton, true, "Guardando…");
  const payload = {
    price,
    ticket_type: cleanTicketType(values.ticket_type),
    status: values.status,
    customer_name: cleanOptional(values.customer_name),
    customer_email: cleanOptional(values.customer_email),
    notes: cleanOptional(values.notes),
    updated_at: new Date().toISOString(),
  };

  if (payload.status === "used") {
    const currentTicket = state.tickets.find((ticket) => ticket.folio === form.dataset.editFolio);
    payload.used_at = currentTicket?.used_at || new Date().toISOString();
    payload.used_by = currentTicket?.used_by || state.user.email || state.user.id;
  } else {
    payload.used_at = null;
    payload.used_by = null;
  }

  const { error } = await supabase
    .from("event_tickets")
    .update(payload)
    .eq("folio", form.dataset.editFolio);

  if (error) {
    showMessage(`No se pudo editar el ticket: ${friendlyError(error)}`, "error");
    setBusy(submitButton, false, "Guardar cambios");
    return;
  }

  showMessage("Ticket actualizado.", "success");
  await loadTickets();
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
  printPreparedDocument(printFileName("ticket", ticket?.folio || folio));
}

function printBatch() {
  clearPrintState();
  preparePrintPages(state.tickets);
  printPreparedDocument(printFileName("tickets"));
}


async function downloadBatchPDF() {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) {
    showMessage("No fue posible cargar el generador de PDF. Intenta de nuevo.", "error");
    return;
  }
  if (!state.tickets.length) return;

  clearPrintState();
  preparePrintPages(state.tickets);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  setBusy(els.downloadPdfButton, true, "Preparando PDF...");
  try {
    const doc = buildTicketsPDF(jsPDF, state.tickets);
    doc.save(printFileName("tickets") + ".pdf");
  } catch (error) {
    console.error("[Tickets] No fue posible generar el PDF:", error);
    showMessage("No fue posible generar el PDF. Intenta imprimir y guardar como PDF.", "error");
  } finally {
    setBusy(els.downloadPdfButton, false, "Descargar PDF");
    clearPrintState();
  }
}

function buildTicketsPDF(jsPDF, tickets) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const page = { width: 215.9, height: 279.4, margin: 4, header: 12, columns: 4, rows: 10, ticketWidth: 48 };
  const gridHeight = page.height - (page.margin * 2) - page.header;
  const rowHeight = gridHeight / page.rows;
  const gridWidth = page.columns * page.ticketWidth;
  const startX = page.margin + ((page.width - (page.margin * 2) - gridWidth) / 2);
  const startY = page.margin + page.header;
  const pageSize = page.columns * page.rows;
  const pages = [];

  for (let index = 0; index < tickets.length; index += pageSize) {
    pages.push(tickets.slice(index, index + pageSize));
  }

  pages.forEach((pageTickets, pageIndex) => {
    if (pageIndex > 0) doc.addPage("letter", "portrait");
    drawPDFHeader(doc, pageTickets, page, pageIndex + 1, pages.length);
    pageTickets.forEach((ticket, ticketIndex) => {
      const col = ticketIndex % page.columns;
      const row = Math.floor(ticketIndex / page.columns);
      drawPDFTicket(doc, ticket, startX + (col * page.ticketWidth), startY + (row * rowHeight), page.ticketWidth, rowHeight);
    });
  });

  return doc;
}

function drawPDFHeader(doc, tickets, page, pageNumber, totalPages) {
  const eventKey = tickets[0]?.event_key || state.currentEventKey || "-";
  const total = tickets.reduce((sum, ticket) => {
    const price = Number(ticket?.price);
    return Number.isFinite(price) ? sum + price : sum;
  }, 0);
  const ticketTypes = [...new Set(tickets.map((ticket) => cleanTicketType(ticket.ticket_type)))];
  const pageTicketType = ticketTypes.length === 1 ? ticketTypes[0] : "VARIOS";
  const talon = "TALON CORRESPONDIENTE A " + tickets.length + " BOLETO" + (tickets.length === 1 ? "" : "S") + " DE " + pageTicketType;
  const responsible = state.user?.email || state.user?.id || "-";
  const emission = formatDate(new Date().toISOString());

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  doc.text(String(eventKey), page.margin + 1, page.margin + 4.4, { maxWidth: 62 });
  doc.setFontSize(4.6);
  doc.text(talon, page.margin + 1, page.margin + 7.2, { maxWidth: 86 });

  doc.setFontSize(4.1);
  doc.text("EMISOR:", page.width / 2 - 6, page.margin + 2.7);
  doc.setFontSize(6.2);
  doc.text(String(responsible), page.width / 2 - 6, page.margin + 5.2, { maxWidth: 46 });
  doc.setFontSize(4.1);
  doc.text("EMISION", page.width / 2 - 6, page.margin + 7.6);
  doc.setFontSize(6.2);
  doc.text(emission, page.width / 2 - 6, page.margin + 10.1, { maxWidth: 46 });

  doc.setFontSize(4.1);
  doc.text("PAGARE POR", page.width - page.margin - 1, page.margin + 4.5, { align: "right" });
  doc.setFontSize(7.4);
  doc.text(formatMoney(total), page.width - page.margin - 1, page.margin + 8, { align: "right" });
  doc.setFontSize(4);
  doc.text(String(pageNumber) + "/" + String(totalPages), page.width - page.margin - 1, page.margin + 10.6, { align: "right" });

  doc.setLineWidth(0.15);
  doc.setLineDashPattern([0.8, 0.8], 0);
  doc.line(page.margin, page.margin + page.header, page.width - page.margin, page.margin + page.header);
  doc.setLineDashPattern([], 0);
}

function drawPDFTicket(doc, ticket, x, y, width, height) {
  const padding = 1.5;
  const qrSize = 21.5;
  const qrX = x + padding;
  const qrY = y + ((height - qrSize) / 2);
  const textX = qrX + qrSize + 2;
  const textY = y + (height / 2) - 5;
  const qrData = printQRDataURL(ticket);

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.12);
  doc.setLineDashPattern([0.8, 0.8], 0);
  doc.rect(x, y, width, height);
  doc.setLineDashPattern([], 0);

  if (qrData) doc.addImage(qrData, "PNG", qrX, qrY, qrSize, qrSize);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(4.2);
  doc.text("TICKET", textX, textY);
  doc.setFontSize(8.5);
  doc.text(cleanTicketType(ticket.ticket_type), textX, textY + 3.6, { maxWidth: width - qrSize - 5 });
  doc.setFontSize(4.2);
  doc.text("PRECIO", textX, textY + 7.2);
  doc.setFontSize(7.2);
  doc.text(formatMoney(ticket.price), textX, textY + 10.8, { maxWidth: width - qrSize - 5 });
}

function printQRDataURL(ticket) {
  const container = document.getElementById("print-qr-" + safeId(ticket.folio));
  const canvas = container?.querySelector("canvas");
  if (canvas) return canvas.toDataURL("image/png");
  const image = container?.querySelector("img");
  return image?.src || "";
}

function printPreparedDocument(title) {
  if (title) {
    state.previousDocumentTitle = document.title;
    document.title = title;
  }
  window.print();
}

function printFileName(prefix, detail = state.currentEventKey) {
  const eventKey = normalizeEventKey(detail || state.currentEventKey || "tickets");
  const date = new Date().toISOString().slice(0, 10);
  return [prefix, eventKey, date]
    .filter(Boolean)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function preparePrintPages(tickets) {
  const printableTickets = Array.isArray(tickets) ? tickets.filter(Boolean) : [];
  const pagesRoot = document.querySelector("[data-print-pages]");
  if (!pagesRoot) return;

  const pageSize = 40;
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
    const ticketTypes = [...new Set(pageTickets.map((ticket) => cleanTicketType(ticket.ticket_type)))];
    const pageTicketType = ticketTypes.length === 1 ? ticketTypes[0] : "VARIOS";
    const talonText = "TALÓN CORRESPONDIENTE A " + pageTickets.length + " BOLETO" + (pageTickets.length === 1 ? "" : "S") + " DE " + pageTicketType;
    const responsible = state.user?.email || state.user?.id || "-";

    return `
      <section class="ticket-print-page">
        <header class="ticket-print-header">
          <div class="ticket-print-header__brand">
            <strong>${escapeHTML(eventKey)}</strong>
            <span>${escapeHTML(talonText)}</span>
          </div>
          <div class="ticket-print-header__meta">
            <span>EMISOR:</span>
            <strong>${escapeHTML(responsible)}</strong>
            <span>EMISIÓN</span>
            <strong>${escapeHTML(emission)}</strong>
          </div>
          <div class="ticket-print-header__total">
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
  if (state.previousDocumentTitle) {
    document.title = state.previousDocumentTitle;
    delete state.previousDocumentTitle;
  }
  document.body.classList.remove("print-single");
  document.querySelectorAll("[data-print-selected]").forEach((card) => {
    delete card.dataset.printSelected;
  });
  document.querySelector("[data-print-pages]")?.replaceChildren();
}

function syncEventInURL(eventKey) {
  const url = new URL(window.location.href);
  if (eventKey) url.searchParams.set("event", eventKey);
  else url.searchParams.delete("event");
  window.history.replaceState({}, "", url);
}

function eventLabel(event) {
  const date = event.event_date ? formatDate(event.event_date, false) : "Sin fecha";
  const name = event.name ? ` · ${event.name}` : "";
  return `${event.event_key}${name} · ${date}`;
}

function buildValidationURL(folio) {
  const encodedFolio = encodeURIComponent(folio);
  if (window.location.origin && window.location.origin !== "null") {
    return `${window.location.origin}/tickets/validate.html?folio=${encodedFolio}`;
  }
  return `/tickets/validate.html?folio=${encodedFolio}`;
}

function hasAdminRole(rawRoles = "") {
  return String(rawRoles)
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");
}

function normalizeEventKey(value) {
  return String(value || "").trim().toUpperCase();
}

function ticketTypeOptionsHTML(value) {
  const current = cleanTicketType(value);
  return TICKET_TYPES.map((type) => (
    `<option value="${escapeHTML(type)}" ${current === type ? "selected" : ""}>${escapeHTML(type)}</option>`
  )).join("");
}

function cleanTicketType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return TICKET_TYPES.includes(normalized) ? normalized : "COVER";
}

function cleanOptional(value) {
  const clean = String(value || "").trim();
  return clean || null;
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
  if (error?.code === "42501") return "Supabase bloqueó la consulta por RLS.";
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
