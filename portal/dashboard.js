/**
 * ================================================================
 *  HIDDEN ROOM / MYSAUTH — Dashboard Controller
 *  portal/dashboard.js
 * ================================================================
 *  Architecture: lightweight SPA router over a static HTML shell.
 *  No framework. No build step. Vanilla ES modules.
 *
 *  Responsibilities:
 *    1. Session bootstrap (Supabase auth)
 *    2. Role-composable sidebar gating
 *    3. Client-side section router (hash-free, state-driven)
 *    4. Per-module render functions (one per section)
 *    5. Notification + toast system
 *    6. Global state object  ← single source of truth
 *
 *  Supabase integration points are marked:
 *    // [SUPABASE] — replace placeholder with real query
 * ================================================================
 */

'use strict';


/* ════════════════════════════════════════════════════════════════
   §1  GLOBAL STATE
════════════════════════════════════════════════════════════════ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const state = {
  /** @type {Object|null} */
  user: null,

  /** @type {string[]}  e.g. ['client','collaborator','rrpp'] */
  roles: [],

  /** Currently active section key */
  activeSection: 'overview',

  /** Fetched data cache, keyed by section */
  data: {},

  /** Notification items */
  notifications: [],

  /** Whether the sidebar is open on mobile */
  sidebarOpen: false,
};

/**
 * Immutable-ish state update.
 * @param {Partial<typeof state>} patch
 */
function setState(patch) {
  Object.assign(state, patch);
}


/* ════════════════════════════════════════════════════════════════
   §2  SECTION REGISTRY
   ─────────────────────────────────────────────────────────────
   Maps section key → { label, roleRequired, render }
   render() is always treated as async — may return a string or
   a Promise<string>. renderSection() awaits it either way.
════════════════════════════════════════════════════════════════ */

const SECTIONS = {

  /* ── CORE ──────────────────────────────────────────── */
  overview: {
    label: 'Overview',
    roleRequired: null,
    render: renderOverview,
  },

  /* ── CLIENT ────────────────────────────────────────── */
  'client-downloads': {
    label: 'Descargas',
    roleRequired: 'client',
    render: renderClientDownloads,
  },
  'client-sessions': {
    label: 'Sesiones',
    roleRequired: 'client',
    render: renderClientSessions,
  },
  'client-transactions': {
    label: 'Transacciones',
    roleRequired: 'client',
    render: renderClientTransactions,
  },
  'client-contracts': {
    label: 'Contratos',
    roleRequired: 'client',
    render: renderClientContracts,
  },
  'client-tickets': {
    label: 'Tickets de Evento',
    roleRequired: 'client',
    render: renderClientTickets,
  },
  'client-store': {
    label: 'Tienda Online',
    roleRequired: 'client',
    render: renderClientStore,
  },
  'client-rewards': {
    label: 'Rewards',
    roleRequired: 'client',
    render: renderClientRewards,
  },

  /* ── COLLABORATOR ───────────────────────────────────── */
  'collab-docs': {
    label: 'Documentos',
    roleRequired: 'collaborator',
    render: renderCollabDocs,
  },
  'collab-tasks': {
    label: 'SCRUM / Tareas',
    roleRequired: 'collaborator',
    render: renderCollabTasks,
  },
  'collab-log': {
    label: 'Log de Actividad',
    roleRequired: 'collaborator',
    render: renderCollabLog,
  },

  /* ── MEDIA ──────────────────────────────────────────── */
  'media-posts': {
    label: 'Posts / Vlog',
    roleRequired: 'media',
    render: renderMediaPosts,
  },

  /* ── RRPP ───────────────────────────────────────────── */
  'rrpp-contacts': {
    label: 'Contactos',
    roleRequired: 'rrpp',
    render: renderRrppContacts,
  },
  'rrpp-invitations': {
    label: 'Invitaciones',
    roleRequired: 'rrpp',
    render: renderRrppInvitations,
  },
  'rrpp-campaigns': {
    label: 'Campañas',
    roleRequired: 'rrpp',
    render: renderRrppCampaigns,
  },
  'rrpp-guestlist': {
    label: 'Guest Lists',
    roleRequired: 'rrpp',
    render: renderRrppGuestlist,
  },
  'rrpp-benefits': {
    label: 'Beneficios',
    roleRequired: 'rrpp',
    render: renderRrppBenefits,
  },

  /* ── ERP / ADMIN ────────────────────────────────────── */
  'erp-finance': {
    label: 'Finanzas',
    roleRequired: 'admin',
    render: renderErpFinance,
  },
  'erp-ops': {
    label: 'Operaciones',
    roleRequired: 'admin',
    render: renderErpOps,
  },
};


/* ════════════════════════════════════════════════════════════════
   §3  SESSION BOOTSTRAP
════════════════════════════════════════════════════════════════ */

/**
 * Loads session from Supabase auth.
 * Returns user object or null if not authenticated.
 * @returns {Promise<{user:Object, roles:string[]}|null>}
 */
async function bootstrapSession() {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return null;

    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    return {
      user: profile ?? user,
      roles: ['client'],
    };

  } catch (err) {
    console.error(err);
    return null;
  }
}

/**
 * Writes a session stub to localStorage.
 * Used for development only.
 */
export function devSeedSession() {
  const stub = {
    user: {
      id: 'usr_dev001',
      display_name: 'Dev User',
      email: 'dev@hiddenroom.mx',
      client_id: 'CLT-0001',
      whatsapp: '+52 55 0000 0000',
      avatar_url: '',
    },
    roles: ['client', 'collaborator', 'rrpp'],
  };
  localStorage.setItem('hr_session', JSON.stringify(stub));
}


/* ════════════════════════════════════════════════════════════════
   §4  ROLE ENGINE
════════════════════════════════════════════════════════════════ */

/** @param {string} role */
const hasRole = (role) => state.roles.includes(role);

/** @param {string[]} roles */
const hasAnyRole = (roles) => roles.some(hasRole);

/** @param {string[]} roles */
const hasAllRoles = (roles) => roles.every(hasRole);

/**
 * Shows sidebar nav groups that match the user's roles.
 */
function applyRoleGates() {
  const groups = document.querySelectorAll('[data-role-gate]');
  groups.forEach((group) => {
    const requiredRole = group.dataset.roleGate;
    group.hidden = !hasRole(requiredRole);
  });
}


/* ════════════════════════════════════════════════════════════════
   §5  ROUTER
   ─────────────────────────────────────────────────────────────
   navigate() is sync: updates state + sidebar immediately, then
   calls renderSection() which is async and awaits render().
════════════════════════════════════════════════════════════════ */

/**
 * Navigate to a section by key.
 * @param {string} sectionKey
 */
function navigate(sectionKey) {
  const section = SECTIONS[sectionKey];

  if (!section) {
    console.warn(`[HR] Unknown section: ${sectionKey}`);
    return;
  }

  // Permission guard
  if (section.roleRequired && !hasRole(section.roleRequired)) {
    showToast('Acceso no autorizado para este módulo.', 'error');
    return;
  }

  setState({ activeSection: sectionKey });
  updateSidebarActiveState(sectionKey);
  updateTopbarTitle(section.label);

  // Fire-and-forget: renderSection is async but navigate stays sync
  renderSection(sectionKey);
}

/**
 * Injects the section's HTML into the main content area.
 * Supports both sync and async render functions uniformly.
 * @param {string} sectionKey
 * @returns {Promise<void>}
 */
async function renderSection(sectionKey) {
  const wrap     = document.getElementById('js-section-wrap');
  const skeleton = document.getElementById('js-skeleton');

  if (!wrap) return;

  const section = SECTIONS[sectionKey];

  if (skeleton) skeleton.hidden = true;

  wrap.classList.remove('db-section-wrap--visible');

  // Await the render — works whether the function is sync or async
  const html = await section.render();

  wrap.innerHTML = html;

  // Trigger reveal after paint
  requestAnimationFrame(() => {
    wrap.classList.add('db-section-wrap--visible');
  });
}


/* ════════════════════════════════════════════════════════════════
   §6  TOPBAR HELPERS
════════════════════════════════════════════════════════════════ */

function hydrateTopbar() {
  const nameEl   = document.getElementById('js-user-display-name');
  const avatarEl = document.getElementById('js-user-avatar');

  if (!state.user) return;

  if (nameEl)   nameEl.textContent  = state.user.display_name;
  if (avatarEl) avatarEl.textContent = state.user.display_name?.[0]?.toUpperCase() ?? '?';
}

/** @param {string} label */
function updateTopbarTitle(label) {
  const el = document.getElementById('js-topbar-section');
  if (el) el.textContent = label;
}


/* ════════════════════════════════════════════════════════════════
   §7  SIDEBAR HELPERS
════════════════════════════════════════════════════════════════ */

/** @param {string} activeKey */
function updateSidebarActiveState(activeKey) {
  document.querySelectorAll('.db-sidebar__item').forEach((btn) => {
    const isActive = btn.dataset.section === activeKey;
    btn.classList.toggle('db-sidebar__item--active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
}

function attachSidebarListeners() {
  document.querySelectorAll('.db-sidebar__item').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.section));
  });

  const toggle = document.getElementById('js-sidebar-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = !state.sidebarOpen;
      setState({ sidebarOpen: open });
      document.getElementById('js-sidebar')?.classList.toggle('db-sidebar--open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
}


/* ════════════════════════════════════════════════════════════════
   §8  NOTIFICATIONS
════════════════════════════════════════════════════════════════ */

/**
 * Load notifications.
 * [SUPABASE] Replace with:
 *   supabase.from('notifications').select('*')
 *     .eq('user_id', state.user.id)
 *     .order('created_at', { ascending: false })
 * @returns {Promise<Array>}
 */
async function fetchNotifications() {
  return [
    { id: 'n1', message: 'Tu sesión del Viernes fue confirmada.', type: 'success', ts: Date.now() - 3600_000,  read: false },
    { id: 'n2', message: 'Nuevo contrato disponible para firma.',  type: 'info',    ts: Date.now() - 86400_000, read: false },
  ];
}

async function loadAndRenderNotifications() {
  const notifications = await fetchNotifications();
  setState({ notifications });

  const unread = notifications.filter((n) => !n.read).length;
  const badge  = document.getElementById('js-notif-count');
  if (badge) {
    badge.textContent = String(unread);
    badge.hidden = unread === 0;
  }

  const list = document.getElementById('js-notif-list');
  if (!list) return;

  if (notifications.length === 0) {
    list.innerHTML = '<li class="db-notifications__empty">Sin notificaciones nuevas.</li>';
    return;
  }

  list.innerHTML = notifications.map((n) => `
    <li class="db-notifications__item db-notifications__item--${n.type}${n.read ? ' db-notifications__item--read' : ''}" data-notif-id="${n.id}">
      <span class="db-notifications__dot" aria-hidden="true"></span>
      <span class="db-notifications__msg">${escapeHTML(n.message)}</span>
      <time class="db-notifications__time" datetime="${new Date(n.ts).toISOString()}">${relativeTime(n.ts)}</time>
    </li>
  `).join('');
}

function attachNotificationListeners() {
  const toggle = document.getElementById('js-notifications-toggle');
  const panel  = document.getElementById('js-notifications-panel');
  const close  = document.getElementById('js-notif-close');

  toggle?.addEventListener('click', () => {
    const open = panel?.hidden;
    if (panel) panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  close?.addEventListener('click', () => {
    if (panel) panel.hidden = true;
    document.getElementById('js-notifications-toggle')?.setAttribute('aria-expanded', 'false');
  });
}


/* ════════════════════════════════════════════════════════════════
   §9  TOAST SYSTEM
════════════════════════════════════════════════════════════════ */

/**
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} duration ms
 */
function showToast(message, type = 'info', duration = 4000) {
  const region = document.getElementById('js-toast-region');
  if (!region) return;

  const toast = document.createElement('div');
  toast.className = `db-toast db-toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;

  region.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('db-toast--visible'));

  setTimeout(() => {
    toast.classList.remove('db-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

window.showToast = showToast;


/* ════════════════════════════════════════════════════════════════
   §10  USER MENU
════════════════════════════════════════════════════════════════ */

function attachUserMenuListeners() {
  const toggle = document.getElementById('js-user-menu-toggle');
  const menu   = document.getElementById('js-user-menu');

  toggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu?.hidden;
    if (menu) menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  menu?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;

    if (action === 'logout')   handleLogout();
    if (action === 'profile')  navigate('overview');
    if (action === 'settings') showToast('Ajustes disponibles próximamente.', 'info');

    if (menu) menu.hidden = true;
    toggle?.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('click', () => {
    if (menu && !menu.hidden) {
      menu.hidden = true;
      toggle?.setAttribute('aria-expanded', 'false');
    }
  });
}

function handleLogout() {
  supabase.auth.signOut().finally(() => {
    window.location.href = './index.html';
  });
}


/* ════════════════════════════════════════════════════════════════
   §11  SECTION RENDERERS
   ─────────────────────────────────────────────────────────────
   Sync renderers return a plain string.
   Async renderers return a Promise<string>.
   renderSection() handles both via await.
════════════════════════════════════════════════════════════════ */

/* ── OVERVIEW ─────────────────────────────────────────────── */
function renderOverview() {
  const { user, roles } = state;

  const roleBadges = roles.map((r) => `
    <span class="db-badge db-badge--role db-badge--${r}">${r.toUpperCase()}</span>
  `).join('');

  const quickActions = buildQuickActions(roles);

  return `
    <section class="db-section db-section--overview" aria-labelledby="section-overview-title">

      <header class="db-section__header">
        <p class="section-label">Sistema</p>
        <h1 class="db-section__title" id="section-overview-title">Overview</h1>
      </header>

      <div class="db-grid db-grid--2col">

        <article class="db-card db-card--profile" aria-label="Perfil de usuario">
          <div class="db-card__inner">
            <div class="db-profile__avatar" aria-hidden="true">
              ${user?.display_name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div class="db-profile__info">
              <h2 class="db-profile__name">${escapeHTML(user?.display_name ?? '—')}</h2>
              <dl class="db-profile__meta">
                <div class="db-profile__row">
                  <dt>ID</dt>
                  <dd>${escapeHTML(user?.client_id ?? '—')}</dd>
                </div>
                <div class="db-profile__row">
                  <dt>Email</dt>
                  <dd>${escapeHTML(user?.email ?? '—')}</dd>
                </div>
                <div class="db-profile__row">
                  <dt>WhatsApp</dt>
                  <dd>${escapeHTML(user?.whatsapp ?? '—')}</dd>
                </div>
              </dl>
              <div class="db-profile__roles" aria-label="Roles activos">
                ${roleBadges}
              </div>
            </div>
          </div>
        </article>

        <article class="db-card" aria-label="Acciones rápidas">
          <header class="db-card__header">
            <span class="section-label">Acciones rápidas</span>
          </header>
          <div class="db-card__inner">
            <div class="db-quick-actions">
              ${quickActions}
            </div>
          </div>
        </article>

      </div>

      <div class="db-stats-row" id="js-overview-stats" aria-label="Estadísticas">
        ${renderStatsSkeleton()}
      </div>

    </section>
  `;
}

/** @param {string[]} roles */
function buildQuickActions(roles) {
  const actions = [];

  if (roles.includes('client')) {
    actions.push({ label: 'Ver Sesiones',      section: 'client-sessions'     });
    actions.push({ label: 'Mis Transacciones', section: 'client-transactions' });
  }
  if (roles.includes('collaborator')) {
    actions.push({ label: 'Ver Tareas',        section: 'collab-tasks'        });
  }
  if (roles.includes('rrpp')) {
    actions.push({ label: 'Guest List',        section: 'rrpp-guestlist'      });
  }
  if (roles.includes('media')) {
    actions.push({ label: 'Gestionar Posts',   section: 'media-posts'         });
  }

  if (actions.length === 0) {
    return `<p class="db-empty">Sin acciones disponibles para tus roles actuales.</p>`;
  }

  return actions.map((a) => `
    <button class="db-quick-action" data-section="${a.section}">
      ${escapeHTML(a.label)}
      <span class="db-quick-action__arrow" aria-hidden="true">→</span>
    </button>
  `).join('');
}

function renderStatsSkeleton() {
  return ['—', '—', '—'].map(() => `
    <div class="db-stat-card">
      <span class="db-stat-card__value">—</span>
      <span class="db-stat-card__label">Cargando…</span>
    </div>
  `).join('');
}

/* ── CLIENT: DOWNLOADS ────────────────────────────────────── */
function renderClientDownloads() {
  // [SUPABASE] SELECT * FROM products WHERE user_id = state.user.id AND type = 'download'
  return `
    <section class="db-section" aria-labelledby="title-downloads">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-downloads">Descargas</h1>
      </header>
      <div class="db-table-wrap">
        <table class="db-table" aria-label="Productos descargables">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Formato</th>
              <th scope="col">Fecha</th>
              <th scope="col">Acción</th>
            </tr>
          </thead>
          <tbody id="js-downloads-body">
            <tr class="db-table__empty-row">
              <td colspan="4" class="db-empty">Conectando con almacenamiento…</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

/* ── CLIENT: SESSIONS ─────────────────────────────────────── */
function renderClientSessions() {
  // [SUPABASE] SELECT * FROM sessions WHERE client_id = state.user.id ORDER BY date DESC
  return `
    <section class="db-section" aria-labelledby="title-sessions">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-sessions">Sesiones</h1>
      </header>
      <div class="db-table-wrap">
        <table class="db-table" aria-label="Historial de sesiones">
          <thead>
            <tr>
              <th scope="col">Concepto</th>
              <th scope="col">Fecha</th>
              <th scope="col">Pago</th>
              <th scope="col">Entrega</th>
              <th scope="col">Notas</th>
            </tr>
          </thead>
          <tbody id="js-sessions-body">
            <tr class="db-table__empty-row">
              <td colspan="5" class="db-empty">Sin sesiones registradas.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

/* ── CLIENT: TRANSACTIONS ─────────────────────────────────── */
async function renderClientTransactions() {
  // [SUPABASE] live query
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return `
      <section class="db-section" aria-labelledby="title-txn">
        <header class="db-section__header">
          <p class="section-label">Cliente</p>
          <h1 class="db-section__title" id="title-txn">Transacciones</h1>
        </header>
        <p class="db-empty db-empty--error">Error al cargar transacciones. Intenta de nuevo.</p>
      </section>
    `;
  }

  let rows = '';

  if (!data || data.length === 0) {
    rows = `
      <tr class="db-table__empty-row">
        <td colspan="4" class="db-empty">Sin transacciones registradas.</td>
      </tr>
    `;
  } else {
    rows = data.map((tx) => `
      <tr>
        <td>${escapeHTML(tx.concept ?? '—')}</td>
        <td>$${escapeHTML(String(tx.amount ?? 0))}</td>
        <td>${new Date(tx.created_at).toLocaleDateString()}</td>
        <td>${escapeHTML(tx.status ?? '—')}</td>
      </tr>
    `).join('');
  }

  return `
    <section class="db-section" aria-labelledby="title-txn">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-txn">Transacciones</h1>
      </header>
      <div class="db-table-wrap">
        <table class="db-table" aria-label="Historial de transacciones">
          <thead>
            <tr>
              <th scope="col">Concepto</th>
              <th scope="col">Monto</th>
              <th scope="col">Fecha</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody id="js-txn-body">
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

/* ── CLIENT: CONTRACTS ────────────────────────────────────── */
function renderClientContracts() {
  // [SUPABASE] SELECT * FROM contracts WHERE user_id = state.user.id
  return `
    <section class="db-section" aria-labelledby="title-contracts">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-contracts">Contratos</h1>
      </header>
      <ul class="db-card-list" id="js-contracts-list" role="list">
        <li class="db-empty">Sin contratos disponibles.</li>
      </ul>
    </section>
  `;
}

/* ── CLIENT: TICKETS ──────────────────────────────────────── */
function renderClientTickets() {
  // [SUPABASE] SELECT events.*, event_tickets.* FROM event_tickets JOIN events ON … WHERE user_id = state.user.id
  return `
    <section class="db-section" aria-labelledby="title-tickets">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-tickets">Tickets de Evento</h1>
      </header>
      <ul class="db-card-list" id="js-tickets-list" role="list">
        <li class="db-empty">Sin tickets adquiridos.</li>
      </ul>
    </section>
  `;
}

/* ── CLIENT: STORE ────────────────────────────────────────── */
function renderClientStore() {
  // [SUPABASE] SELECT * FROM store_orders WHERE user_id = state.user.id ORDER BY created_at DESC
  return `
    <section class="db-section" aria-labelledby="title-store">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-store">Tienda Online — Pedidos</h1>
      </header>
      <div class="db-table-wrap">
        <table class="db-table" aria-label="Historial de pedidos">
          <thead>
            <tr>
              <th scope="col">Pedido</th>
              <th scope="col">Producto</th>
              <th scope="col">Total</th>
              <th scope="col">Estado</th>
              <th scope="col">Fecha</th>
            </tr>
          </thead>
          <tbody id="js-store-body">
            <tr class="db-table__empty-row">
              <td colspan="5" class="db-empty">Sin pedidos registrados.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

/* ── CLIENT: REWARDS ──────────────────────────────────────── */
function renderClientRewards() {
  // [SUPABASE] SELECT * FROM minigame_scores WHERE user_id = state.user.id
  //            SELECT * FROM coupons WHERE user_id = state.user.id
  return `
    <section class="db-section" aria-labelledby="title-rewards">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-rewards">Rewards</h1>
      </header>
      <div class="db-grid db-grid--3col">
        <article class="db-card" aria-label="Puntuaciones">
          <header class="db-card__header">
            <span class="section-label">Puntuaciones</span>
          </header>
          <div class="db-card__inner" id="js-rewards-scores">
            <p class="db-empty">Sin partidas registradas.</p>
          </div>
        </article>
        <article class="db-card" aria-label="Cupones">
          <header class="db-card__header">
            <span class="section-label">Cupones Desbloqueados</span>
          </header>
          <ul class="db-coupon-list" id="js-rewards-coupons" role="list">
            <li class="db-empty">Sin cupones.</li>
          </ul>
        </article>
        <article class="db-card" aria-label="Inventario de recompensas">
          <header class="db-card__header">
            <span class="section-label">Inventario</span>
          </header>
          <ul class="db-card-list" id="js-rewards-inventory" role="list">
            <li class="db-empty">Sin recompensas.</li>
          </ul>
        </article>
      </div>
    </section>
  `;
}

/* ── COLLABORATOR ─────────────────────────────────────────── */
function renderCollabDocs() {
  // [SUPABASE] SELECT * FROM documents WHERE collaborator_id = state.user.id
  return `
    <section class="db-section" aria-labelledby="title-collab-docs">
      <header class="db-section__header">
        <p class="section-label">Colaborador</p>
        <h1 class="db-section__title" id="title-collab-docs">Documentos</h1>
      </header>
      <ul class="db-card-list" id="js-collab-docs-list" role="list">
        <li class="db-empty">Sin documentos compartidos.</li>
      </ul>
    </section>
  `;
}

function renderCollabTasks() {
  // [SUPABASE] SELECT * FROM tasks WHERE assignee_id = state.user.id OR project_id IN (user's projects)
  const columns = ['Todo', 'En Progreso', 'Revisión', 'Hecho'];
  const colHTML = columns.map((col) => `
    <div class="db-scrum-col" data-status="${col.toLowerCase().replace(' ', '_')}">
      <header class="db-scrum-col__header">
        <span class="db-scrum-col__title">${col}</span>
        <span class="db-scrum-col__count">0</span>
      </header>
      <ul class="db-scrum-col__list" role="list">
        <li class="db-empty">—</li>
      </ul>
    </div>
  `).join('');

  return `
    <section class="db-section" aria-labelledby="title-tasks">
      <header class="db-section__header">
        <p class="section-label">Colaborador</p>
        <h1 class="db-section__title" id="title-tasks">SCRUM / Tareas</h1>
      </header>
      <div class="db-scrum-board" id="js-scrum-board" aria-label="Tablero SCRUM">
        ${colHTML}
      </div>
    </section>
  `;
}

function renderCollabLog() {
  // [SUPABASE] SELECT * FROM activity_log WHERE user_id = state.user.id ORDER BY created_at DESC LIMIT 50
  return `
    <section class="db-section" aria-labelledby="title-log">
      <header class="db-section__header">
        <p class="section-label">Colaborador</p>
        <h1 class="db-section__title" id="title-log">Log de Actividad</h1>
      </header>
      <ol class="db-activity-log" id="js-collab-log" aria-label="Historial de actividad" reversed>
        <li class="db-empty">Sin actividad registrada.</li>
      </ol>
    </section>
  `;
}

/* ── MEDIA ────────────────────────────────────────────────── */
function renderMediaPosts() {
  // [SUPABASE] SELECT * FROM media_posts WHERE author_id = state.user.id ORDER BY created_at DESC
  return `
    <section class="db-section" aria-labelledby="title-media">
      <header class="db-section__header">
        <p class="section-label">Media</p>
        <h1 class="db-section__title" id="title-media">Posts / Vlog</h1>
        <button class="btn-primary db-section__cta" id="js-media-new">+ Nuevo Post</button>
      </header>
      <div class="db-table-wrap">
        <table class="db-table" aria-label="Gestión de posts">
          <thead>
            <tr>
              <th scope="col">Título</th>
              <th scope="col">Tipo</th>
              <th scope="col">Estado</th>
              <th scope="col">Fecha</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody id="js-media-body">
            <tr class="db-table__empty-row">
              <td colspan="5" class="db-empty">Sin posts publicados.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

/* ── RRPP ─────────────────────────────────────────────────── */
function renderRrppContacts() {
  // [SUPABASE] SELECT * FROM contacts WHERE rrpp_id = state.user.id ORDER BY name
  return sectionShell('rrpp', 'Contactos', 'title-rrpp-contacts', `
    <div class="db-table-wrap">
      <table class="db-table" aria-label="Directorio de contactos">
        <thead><tr>
          <th scope="col">Nombre</th>
          <th scope="col">Canal</th>
          <th scope="col">Evento</th>
          <th scope="col">Estado</th>
        </tr></thead>
        <tbody><tr class="db-table__empty-row">
          <td colspan="4" class="db-empty">Sin contactos registrados.</td>
        </tr></tbody>
      </table>
    </div>
  `);
}

function renderRrppInvitations() {
  // [SUPABASE] SELECT * FROM invitations WHERE created_by = state.user.id ORDER BY sent_at DESC
  return sectionShell('rrpp', 'Invitaciones', 'title-rrpp-inv', `
    <p class="db-empty">Sin invitaciones registradas.</p>
  `);
}

function renderRrppCampaigns() {
  // [SUPABASE] SELECT * FROM campaigns WHERE rrpp_id = state.user.id
  return sectionShell('rrpp', 'Campañas', 'title-rrpp-camp', `
    <p class="db-empty">Sin campañas activas.</p>
  `);
}

function renderRrppGuestlist() {
  // [SUPABASE] SELECT * FROM guest_list_entries WHERE rrpp_id = state.user.id ORDER BY event_date
  return sectionShell('rrpp', 'Guest Lists', 'title-rrpp-guest', `
    <p class="db-empty">Sin guest lists disponibles.</p>
  `);
}

function renderRrppBenefits() {
  // [SUPABASE] SELECT * FROM rrpp_benefits WHERE rrpp_id = state.user.id
  return sectionShell('rrpp', 'Beneficios', 'title-rrpp-benefits', `
    <p class="db-empty">Sin beneficios registrados.</p>
  `);
}

/* ── ERP ──────────────────────────────────────────────────── */
function renderErpFinance() {
  return sectionShell('ERP', 'Finanzas', 'title-erp-finance', `
    <p class="db-empty">Módulo ERP — Disponible en fase 2.</p>
  `);
}

function renderErpOps() {
  return sectionShell('ERP', 'Operaciones', 'title-erp-ops', `
    <p class="db-empty">Módulo ERP — Disponible en fase 2.</p>
  `);
}

/* ── RENDER HELPER ────────────────────────────────────────── */
/**
 * Generic section shell to reduce boilerplate.
 * @param {string} label
 * @param {string} title
 * @param {string} titleId
 * @param {string} bodyHTML
 */
function sectionShell(label, title, titleId, bodyHTML) {
  return `
    <section class="db-section" aria-labelledby="${titleId}">
      <header class="db-section__header">
        <p class="section-label">${escapeHTML(label)}</p>
        <h1 class="db-section__title" id="${titleId}">${escapeHTML(title)}</h1>
      </header>
      ${bodyHTML}
    </section>
  `;
}


/* ════════════════════════════════════════════════════════════════
   §12  UTILITY FUNCTIONS
════════════════════════════════════════════════════════════════ */

/** Prevent XSS when injecting user-supplied strings into innerHTML */
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

/** Human-readable relative time */
function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)    return 'ahora';
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h`;
  return `${Math.floor(diff / 86400_000)} d`;
}


/* ════════════════════════════════════════════════════════════════
   §13  EVENT DELEGATION — MAIN AREA
════════════════════════════════════════════════════════════════ */

function attachMainDelegation() {
  const main = document.getElementById('js-main');

  main?.addEventListener('click', (e) => {
    const qa = e.target.closest('.db-quick-action[data-section]');
    if (qa) {
      navigate(qa.dataset.section);
    }
  });
}


/* ════════════════════════════════════════════════════════════════
   §14  INIT
════════════════════════════════════════════════════════════════ */

async function init() {
  const session = await bootstrapSession();

  if (!session) {
    window.location.href = './index.html';
    return;
  }

  setState({
    user:  session.user,
    roles: session.roles,
  });

  hydrateTopbar();
  applyRoleGates();

  attachSidebarListeners();
  attachNotificationListeners();
  attachUserMenuListeners();
  attachMainDelegation();

  await loadAndRenderNotifications();

  navigate('overview');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


/* ════════════════════════════════════════════════════════════════
   §15  PUBLIC API
════════════════════════════════════════════════════════════════ */
export {
  navigate,
  showToast,
  state,
  hasRole,
  hasAnyRole,
  hasAllRoles,
};
