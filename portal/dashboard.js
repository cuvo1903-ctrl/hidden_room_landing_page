/**
 * ================================================================
 *  HIDDEN ROOM / MYSAUTH - Dashboard Controller
 *  portal/dashboard.js
 * ================================================================
 *  Architecture: lightweight SPA router over a static HTML shell.
 *  No framework. No build step. Vanilla ES modules.
 *
 *  Responsibilities:
 *    1. Session bootstrap (Supabase auth)
 *    2. Role-composable sidebar gating  <- cumulative hierarchy
 *    3. Client-side section router (hash-free, state-driven)
 *    4. Per-module render functions (one per section)
 *    5. Notification + toast system
 *    6. Global state object  <- single source of truth
 * ================================================================
 */

'use strict';


/* ================================================================
   Section 1  SUPABASE CLIENT
================================================================ */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const PROFILE_UPDATE_WHATSAPP = '5210000000000';
const SHARE_LOGIN_WHATSAPP_FALLBACK = '5210000000000';
const LOCAL_SCORE_SYNC_KEYS = ['dem00nz_best'];
const ERP_TYPE_OPTIONS = ['INGRESO', 'EGRESO'];
const ERP_STATUS_OPTIONS = ['sin apartado', 'apartado', 'saldado'];
const FINANCE_STUDIO_SOURCES = [
  { value: 'IXT', label: 'Ixtapaluca' },
  { value: 'VC', label: 'Venustiano Carranza' },
  { value: '003', label: 'Los $antos' },
];
const SESSION_TYPE_OPTIONS = [
  { value: 'GRABACION (1 HR) $650', label: 'GRABACION (1 HR) $650', minutes: 60, cost: 650 },
  { value: 'SESION DE PRODUCCION BASICA 1:30 $1,700', label: 'SESION DE PRODUCCION BASICA 1:30 $1,700', minutes: 90, cost: 1700 },
  { value: 'SESION DE PRODUCCION PREMIUM 2:30 HRS $3,700', label: 'SESION DE PRODUCCION PREMIUM 2:30 HRS $3,700', minutes: 150, cost: 3700 },
  { value: 'MEMBRESIA 2 HRS $500', label: 'MEMBRESIA 2 HRS $500', minutes: 120, cost: 500 },
];


/* ================================================================
   Section 2  GLOBAL STATE
================================================================ */

const state = {
  /** @type {Object|null} Full public.users profile merged with auth user */
  user: null,

  /**
   * @type {string[]}
   * Cumulative expanded roles, e.g. ['client','pr','collaborator']
   * Always derived from expandRoles(state.user.roles).
   */
  roles: [],

  /**
   * @type {string[]}
   * Permission keys from user_permissions table,
   * e.g. ['scrum.view', 'accounting.input']
   */
  permissions: [],

  /** Currently active section key */
  activeSection: 'overview',

  /** Fetched data cache, keyed by section */
  data: {},

  /** Notification items */
  notifications: [],

  /** Whether the sidebar is open on mobile */
  sidebarOpen: false,

  /** Monotonic render guard for async section transitions */
  renderToken: 0,
};

/**
 * Immutable-ish state update.
 * @param {Partial<typeof state>} patch
 */
function setState(patch) {
  Object.assign(state, patch);
}


/* ================================================================
   Section 3  ROLE ENGINE
   -------------------------------------------------------------
   Hierarchy (cumulative, bottom roles inherit all above):
     client = 1
     pr     = 2
     collaborator = 3
     partner = 4
     admin  = 5
================================================================ */

/** Ordered hierarchy - index = level (0-based, lower = less access) */
const ROLE_HIERARCHY = ['client', 'pr', 'collaborator', 'partner', 'admin'];

/**
 * Takes the raw roles string from public.users.roles (e.g. "client,pr" or
 * "collaborator") and returns the full cumulative set of roles the user has.
 *
 * Examples:
 *   expandRoles("admin")       -> ['client','pr','collaborator','partner','admin']
 *   expandRoles("collaborator") -> ['client','pr','collaborator']
 *   expandRoles("client,pr")   -> ['client','pr']   (already cumulative, safe)
 *   expandRoles("client")      -> ['client']
 *
 * @param {string|null|undefined} rawRoles  Value of public.users.roles field
 * @returns {string[]}
 */
function expandRoles(rawRoles) {
  if (!rawRoles) return ['client'];

  // Split in case the field already lists multiple roles
  const parts = rawRoles.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);

  // Find the highest role in the hierarchy
  let maxLevel = -1;
  for (const part of parts) {
    const level = ROLE_HIERARCHY.indexOf(part);
    if (level > maxLevel) maxLevel = level;
  }

  // Fallback to 'client' if nothing matched
  if (maxLevel < 0) maxLevel = 0;

  // Return all roles up to and including the highest
  return ROLE_HIERARCHY.slice(0, maxLevel + 1);
}

/**
 * Returns true if the user has the given role (cumulative - higher roles
 * automatically include all lower ones).
 * @param {string} role
 */
const hasRole = (role) => state.roles.includes(role);

/**
 * Returns true if the user has at least one of the given roles.
 * @param {string[]} roles
 */
const hasAnyRole = (roles) => roles.some(hasRole);

/**
 * Returns true if the user has all of the given roles.
 * @param {string[]} roles
 */
const hasAllRoles = (roles) => roles.every(hasRole);

/**
 * Returns true if the user has the given permission key.
 * Admins always pass every permission check.
 * @param {string} permission
 */
const hasPermission = (permission) =>
  hasRole('admin') || state.permissions.includes(permission);

/**
 * Returns true if the user has at least one of the given permission keys.
 * Admins always pass.
 * @param {string[]} permissions
 */
const hasAnyPermission = (permissions) =>
  hasRole('admin') || permissions.some((p) => state.permissions.includes(p));

/**
 * Returns true when the active user can mutate SCRUM tasks.
 */
const canEditScrum = () => hasPermission('scrum.edit');

/**
 * Shows sidebar nav groups whose data-role-gate the user satisfies.
 * Works with the cumulative role array in state.roles.
 */
function applyRoleGates() {
  const groups = document.querySelectorAll('[data-role-gate]');
  groups.forEach((group) => {
    const requiredRole = group.dataset.roleGate;
    group.hidden = !hasRole(requiredRole);
  });

  const permissionGroups = document.querySelectorAll('[data-permission-gate]');
  permissionGroups.forEach((group) => {
    const requiredPermission = group.dataset.permissionGate;
    group.hidden = !hasPermission(requiredPermission);
  });
}


/* ================================================================
   Section 4  SECTION REGISTRY
   -------------------------------------------------------------
   Maps section key -> { label, roleRequired, render }
   roleRequired uses the cumulative hasRole() check.
   render() is always treated as async - may return a string or
   a Promise<string>. renderSection() awaits it either way.
================================================================ */

const SECTIONS = {

  /* -- CORE -------------------------------------------- */
  overview: {
    label: 'Inicio',
    roleRequired: null,
    render: renderOverview,
  },
  'account-settings': {
    label: 'Ajustes de Cuenta',
    roleRequired: null,
    render: renderAccountSettings,
  },

  /* -- CLIENT ------------------------------------------ */
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
  'client-membership': {
    label: 'Membresía',
    roleRequired: 'client',
    render: renderClientMembership,
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
    label: 'Premios',
    roleRequired: 'client',
    render: renderClientRewards,
  },

  /* -- COLLABORATOR ------------------------------------- */
  'collab-docs': {
    label: 'Documentos/Contratos',
    roleRequired: 'collaborator',
    render: renderCollabDocs,
  },
  'collab-finance': {
    label: 'Financiero',
    roleRequired: 'collaborator',
    render: renderCollabFinance,
  },
  'collab-tasks': {
    label: 'SCRUM / Tareas',
    roleRequired: 'collaborator',
    permissionRequired: 'scrum.view',
    render: renderCollabTasks,
  },
  'collab-log': {
    label: 'Log de Actividad',
    roleRequired: 'collaborator',
    render: renderCollabLog,
  },

  /* -- RRPP (pr role) ----------------------------------- */
  'rrpp-contacts': {
    label: 'Boletos vendidos',
    roleRequired: 'pr',
    render: renderRrppContacts,
  },
  'rrpp-invitations': {
    label: 'Invitaciones',
    roleRequired: 'pr',
    render: renderRrppInvitations,
  },
  'rrpp-campaigns': {
    label: 'Campañas',
    roleRequired: 'pr',
    render: renderRrppCampaigns,
  },
  'rrpp-guestlist': {
    label: 'Lista de invitados',
    roleRequired: 'pr',
    render: renderRrppGuestlist,
  },
  'rrpp-benefits': {
    label: 'Beneficios',
    roleRequired: 'pr',
    render: renderRrppBenefits,
  },

  /* -- ERP / ADMIN -------------------------------------- */
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
  'erp-permissions': {
    label: 'Permisos',
    roleRequired: 'admin',
    render: renderErpPermissions,
  },
  'admin-table-editor': {
    label: 'BB.DD',
    roleRequired: 'admin',
    render: renderAdminTableEditor,
  },
};

const SCRUM_COLUMNS = [
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'En progreso' },
  { key: 'review', label: 'Revision' },
  { key: 'done', label: 'Hecho' },
];

const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const AVAILABLE_ROLES = ['client', 'pr', 'collaborator', 'partner', 'admin'];
const SECTION_LOADING_MIN_MS = 300;
const SUGGESTED_PERMISSIONS = [
  'scrum.view',
  'scrum.edit',
  'erp.finance.input',
  'erp.ops.input',
  'rrpp.manage',
];

const ADMIN_TABLE_FETCH_SIZE = 1000;

const TABLE_EDITOR_CONFIG = {
  users: {
    label: 'Usuarios',
    primaryKey: 'id',
    select: 'id, user_id, display_name, email, whatsapp, avatar_url, username, roles',
    lockedFields: ['id', 'user_id', 'roles'],
    editableFields: ['display_name', 'email', 'whatsapp', 'avatar_url', 'username'],
    hiddenColumns: ['id'],
  },
  transactions: {
    label: 'Transacciones',
    primaryKey: 'id',
    select: 'id, user_id, type, concept, date, amount, via, username, id_trans, notes',
    lockedFields: ['id'],
    editableFields: ['user_id', 'type', 'concept', 'date', 'amount', 'via', 'username', 'id_trans', 'notes'],
    hiddenColumns: ['id'],
  },
  sessions: {
    label: 'Sesiones',
    primaryKey: 'id',
    select: 'id, session_date, concept, user_id, status, type, notes, username, hour, sc_end, cost, promo',
    lockedFields: ['id'],
    editableFields: ['session_date', 'concept', 'user_id', 'status', 'type', 'notes', 'username', 'hour', 'sc_end', 'cost', 'promo'],
    hiddenColumns: ['id'],
  },
  scores: {
    label: 'Scores',
    primaryKey: 'id',
    select: 'id, game_id, user_id, type, amount',
    lockedFields: ['id'],
    editableFields: ['game_id', 'user_id', 'type', 'amount'],
    hidden: true,
  },
  downloads: {
    label: 'Descargas',
    primaryKey: null,
    select: 'id, user_id, name, storage_path, notes, type',
    lockedFields: ['id'],
    editableFields: ['user_id', 'name', 'storage_path', 'notes', 'type'],
    matchFields: ['user_id', 'name', 'storage_path'],
    hiddenColumns: ['id'],
  },
  rewards: {
    label: 'Recompensas',
    primaryKey: 'id',
    select: 'id, user_id, concept',
    lockedFields: ['id'],
    editableFields: ['user_id', 'concept'],
    hiddenColumns: ['id'],
  },
};

async function fetchAllTableEditorRows(tableName, select) {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select(select)
      .range(from, from + ADMIN_TABLE_FETCH_SIZE - 1);

    if (error) throw error;

    rows.push(...(data ?? []));

    if (!data || data.length < ADMIN_TABLE_FETCH_SIZE) break;
    from += ADMIN_TABLE_FETCH_SIZE;
  }

  return rows;
}

function sortTableEditorRows(rows, field, direction = 'asc') {
  const multiplier = direction === 'desc' ? -1 : 1;

  return [...rows].sort((a, b) => {
    const left = normalizeTableSortValue(a?.[field]);
    const right = normalizeTableSortValue(b?.[field]);

    if (left.empty && right.empty) return 0;
    if (left.empty) return 1;
    if (right.empty) return -1;

    if (left.type === 'number' && right.type === 'number') {
      return (left.value - right.value) * multiplier;
    }

    return String(left.value).localeCompare(String(right.value), 'es', {
      numeric: true,
      sensitivity: 'base',
    }) * multiplier;
  });
}

function getTableSort(tableId, fallbackField = '', fallbackDirection = 'asc') {
  const sorts = state.data.tableSorts ?? {};
  return sorts[tableId] ?? { field: fallbackField, direction: fallbackDirection };
}

function setTableSort(tableId, field) {
  const current = getTableSort(tableId);
  const direction = current.field === field && current.direction === 'asc' ? 'desc' : 'asc';
  state.data.tableSorts = {
    ...(state.data.tableSorts ?? {}),
    [tableId]: { field, direction },
  };
}

function sortRowsByColumn(rows, field, direction = 'asc') {
  if (!field) return rows ?? [];
  return sortTableEditorRows(rows ?? [], field, direction);
}

function adminTableSearchFor(tableName) {
  return state.data.adminTableSearches?.[tableName] ?? state.data.adminTableLastSearch ?? '';
}

function setAdminTableSearch(tableName, query) {
  state.data.adminTableLastSearch = query;
  state.data.adminTableSearches = {
    ...(state.data.adminTableSearches ?? {}),
    [tableName]: query,
  };
}

function rowMatchesSearch(row, columns, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const searchable = columns
    .map((field) => row?.[field])
    .filter((value) => value !== null && value !== undefined)
    .join(' ');

  return normalizeSearchText(searchable).includes(normalizedQuery);
}

function renderSortableHeader(tableId, field, label, activeSort) {
  const isActive = activeSort?.field === field;
  const nextDirection = isActive && activeSort.direction === 'asc' ? 'desc' : 'asc';
  const glyph = isActive ? (activeSort.direction === 'asc' ? '↑' : '↓') : '↕';

  return `
    <th scope="col">
      <button
        class="db-table-sort"
        type="button"
        data-action="table-sort"
        data-table-id="${escapeAttr(tableId)}"
        data-sort-field="${escapeAttr(field)}"
        aria-label="Ordenar ${escapeAttr(label)} ${nextDirection === 'asc' ? 'ascendente' : 'descendente'}"
      >
        <span>${escapeHTML(label)}</span>
        <span aria-hidden="true">${glyph}</span>
      </button>
    </th>
  `;
}

function normalizeTableSortValue(value) {
  if (value === null || value === undefined || value === '') {
    return { empty: true, type: 'string', value: '' };
  }

  const raw = String(value).trim();
  const numeric = Number(raw);
  if (raw !== '' && Number.isFinite(numeric)) {
    return { empty: false, type: 'number', value: numeric };
  }

  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp) && /\d{4}-\d{2}-\d{2}/.test(raw)) {
    return { empty: false, type: 'number', value: timestamp };
  }

  return { empty: false, type: 'string', value: raw };
}

function uniqueUsers(users) {
  const seen = new Set();
  return (users ?? []).filter((user) => {
    const key = String(user?.user_id ?? user?.id ?? '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const userLabel = (userId) => {
  const user = (state.data.users ?? []).find((u) => String(u.user_id) === String(userId));
  if (!user) return userId ? 'Usuario seleccionado' : 'Sin asignar';
  return user.display_name || user.username || user.email || 'Usuario sin nombre';
};

const usernameLabel = (user) => user?.username ? `@${user.username}` : '@sin_username';

async function syncLocalStorageRecords() {
  if (!state.user?.user_id) return;

  for (const key of LOCAL_SCORE_SYNC_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      const amount = Number(raw || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const gameId = key === 'dem00nz_best' ? 'flappy-nero' : key.replace(/_best$/, '');

      const { data: existing, error: fetchError } = await supabase
        .from('scores')
        .select('id, amount')
        .eq('user_id', state.user.user_id)
        .eq('game_id', gameId)
        .eq('type', 'record')
        .order('amount', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchError) {
        console.info('[HR] local score sync fetch skipped:', fetchError.message);
        continue;
      }

      const remoteAmount = Number(existing?.amount || 0);
      if (remoteAmount >= amount) {
        localStorage.setItem(`${key}_synced`, raw);
        continue;
      }

      const payload = {
        user_id: state.user.user_id,
        game_id: gameId,
        type: 'record',
        amount,
      };

      const { error: saveError } = existing?.id
        ? await supabase.from('scores').update({ amount }).eq('id', existing.id)
        : await supabase.from('scores').insert(payload);

      if (saveError) {
        console.info('[HR] local score sync save skipped:', saveError.message);
        continue;
      }

      localStorage.setItem(`${key}_synced`, raw);
    } catch (err) {
      console.info('[HR] local score sync skipped:', err?.message ?? err);
      continue;
    }
  }
}


/* ================================================================
   Section 5  SESSION BOOTSTRAP
   -------------------------------------------------------------
   Auth flow:
     1. supabase.auth.getUser()  -> auth user (auth.users.id)
     2. public.users WHERE id = auth.id  -> full profile
     3. public.users.user_id  -> internal operational ID used in
        transactions / sessions / downloads / contracts / scores
     4. user_permissions WHERE user_id = auth.id  -> permission keys
================================================================ */

/**
 * Loads session from Supabase auth, fetches the public profile and
 * permissions, expands roles cumulatively.
 * @returns {Promise<{user:Object, roles:string[], permissions:string[]}|null>}
 */
async function bootstrapSession() {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) return null;

    // Fetch public profile - join key is public.users.id = auth.users.id
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profileError) {
      console.error('[HR] bootstrapSession: could not fetch profile', profileError);
    }

    // Merge auth user as fallback so email/id are always available
    const mergedUser = profile ? { ...authUser, ...profile } : authUser;

    // Expand roles cumulatively from public.users.roles field
    const roles = expandRoles(mergedUser.roles);

    // Fetch granular permissions from user_permissions
    // user_permissions.user_id references auth.users.id (same as public.users.id)
    const { data: permRows, error: permError } = await supabase
      .from('user_permissions')
      .select('permission_key')
      .eq('user_id', authUser.id);

    if (permError) {
      console.error('[HR] bootstrapSession: could not fetch permissions', permError);
    }

    const permissions = (permRows ?? []).map((r) => r.permission_key);

    return { user: mergedUser, roles, permissions };

  } catch (err) {
    console.error('[HR] bootstrapSession: unexpected error', err);
    return null;
  }
}


/* ================================================================
   Section 6  ROUTER
   -------------------------------------------------------------
   navigate() is sync: updates state + sidebar immediately, then
   calls renderSection() which is async and awaits render().
================================================================ */

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

  // Permission guard - uses cumulative hasRole()
  if (section.roleRequired && !hasRole(section.roleRequired)) {
    showToast('Acceso no autorizado para este módulo.', 'error');
    return;
  }

  if (section.permissionRequired && !hasPermission(section.permissionRequired)) {
    showToast('No tienes permiso para ver este modulo.', 'error');
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
  const renderToken = state.renderToken + 1;
  const loadingStartedAt = performance.now();
  setState({ renderToken });

  wrap.classList.remove('db-section-wrap--visible');
  wrap.innerHTML = renderLoadingBlock(section?.label ?? 'Cargando');
  if (skeleton) skeleton.hidden = true;
  requestAnimationFrame(() => {
    if (state.renderToken === renderToken) {
      wrap.classList.add('db-section-wrap--visible');
    }
  });

  try {
    // Await the render - works whether the function is sync or async
    const html = await section.render();
    const elapsed = performance.now() - loadingStartedAt;
    if (elapsed < SECTION_LOADING_MIN_MS) {
      await new Promise((resolve) => setTimeout(resolve, SECTION_LOADING_MIN_MS - elapsed));
    }
    if (state.renderToken !== renderToken) return;
    wrap.innerHTML = html;
  } catch (error) {
    if (state.renderToken !== renderToken) return;
    console.error('[HR] renderSection:', error);
    wrap.innerHTML = sectionShell('Sistema', 'No se pudo cargar', 'title-render-error', `
      <p class="db-empty db-empty--error">Error al cargar este modulo.</p>
    `);
  } finally {
    if (state.renderToken === renderToken && skeleton) skeleton.hidden = true;
  }

  // Trigger reveal after paint
  requestAnimationFrame(() => {
    wrap.classList.add('db-section-wrap--visible');
  });
}


/* ================================================================
   Section 7  TOPBAR HELPERS
================================================================ */

function hydrateTopbar() {
  const nameEl   = document.getElementById('js-user-display-name');
  const avatarEl = document.getElementById('js-user-avatar');

  if (!state.user) return;

  if (nameEl)   nameEl.textContent  = state.user.display_name ?? state.user.email ?? '-';
  if (avatarEl) {
    const avatarUrl = String(state.user.avatar_url ?? '').trim();
    avatarEl.textContent = '';
    avatarEl.style.backgroundImage = '';
    avatarEl.style.backgroundSize = '';
    avatarEl.style.backgroundPosition = '';

    if (/^https?:\/\//i.test(avatarUrl)) {
      avatarEl.style.backgroundImage = `url("${avatarUrl.replace(/"/g, '%22')}")`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.setAttribute('aria-label', 'Foto de perfil');
    } else {
      avatarEl.textContent = (state.user.display_name ?? state.user.email ?? '?')[0].toUpperCase();
      avatarEl.removeAttribute('aria-label');
    }
  }
}

/** @param {string} label */
function updateTopbarTitle(label) {
  const el = document.getElementById('js-topbar-section');
  if (el) el.textContent = label;
}


/* ================================================================
   Section 8  SIDEBAR HELPERS
================================================================ */

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
    btn.addEventListener('click', () => {
      navigate(btn.dataset.section);
      setState({ sidebarOpen: false });
      document.getElementById('js-sidebar')?.classList.remove('db-sidebar--open');
      document.getElementById('js-sidebar-toggle')?.setAttribute('aria-expanded', 'false');
    });
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

  // Tap on the topbar context label also toggles the sidebar on mobile
  document.querySelector('.db-topbar__context')?.addEventListener('click', () => {
    toggle?.click();
  });
}


/* ================================================================
   Section 9  NOTIFICATIONS
================================================================ */

async function fetchNotifications() {
  const userUuid = state.user?.id;
  const businessUserId = state.user?.user_id;
  const targets = [userUuid, businessUserId].filter(Boolean).map(String);

  if (!targets.length) return [];

  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, message, type, created_at, read, user_id')
      .in('user_id', targets)
      .order('created_at', { ascending: false })
      .limit(25);

    if (error) {
      console.info('[HR] notifications unavailable:', error.message);
      return [];
    }

    return (data ?? []).map((item) => ({
      id: item.id,
      message: item.message ?? 'Notificacion',
      type: item.type ?? 'info',
      ts: item.created_at ? new Date(item.created_at).getTime() : Date.now(),
      read: Boolean(item.read),
    }));
  } catch (error) {
    console.info('[HR] notifications not configured:', error);
    return [];
  }
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


/* ================================================================
   Section 10  TOAST SYSTEM
================================================================ */

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


/* ================================================================
   Section 11  USER MENU
================================================================ */

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
    if (action === 'settings') navigate('account-settings');

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
    window.location.href = './';
  });
}


/* ================================================================
   Section 12  SECTION RENDERERS
   -------------------------------------------------------------
   Async renderers return Promise<string>.
   Sync renderers return string.
   renderSection() handles both via await.
================================================================ */

/* -- OVERVIEW ----------------------------------------------- */
function renderOverview() {
  const { user, roles } = state;

  const roleBadges = roles.map((r) => `
    <span class="db-badge db-badge--role db-badge--${escapeHTML(r)}">${escapeHTML(r.toUpperCase())}</span>
  `).join('');

  const quickActions = buildQuickActions(roles);

  return `
    <section class="db-section db-section--overview" aria-labelledby="section-overview-title">

      <header class="db-section__header">
        <p class="section-label">Sistema</p>
        <h1 class="db-section__title" id="section-overview-title">Inicio</h1>
      </header>

      <div class="db-grid db-grid--2col">

        <article class="db-card db-card--profile" aria-label="Perfil de usuario">
          <div class="db-card__inner">
            <div class="db-profile__avatar" aria-hidden="true">
              ${escapeHTML((user?.display_name ?? user?.email ?? '?')[0].toUpperCase())}
            </div>
            <div class="db-profile__info">
              <h2 class="db-profile__name">${escapeHTML(user?.display_name ?? '-')}</h2>
              <dl class="db-profile__meta">
                <div class="db-profile__row">
                  <dt>ID</dt>
                  <dd>${escapeHTML(String(user?.user_id ?? '-'))}</dd>
                </div>
                <div class="db-profile__row">
                  <dt>Email</dt>
                  <dd>${escapeHTML(user?.email ?? '-')}</dd>
                </div>
                <div class="db-profile__row">
                  <dt>WhatsApp</dt>
                  <dd>${escapeHTML(user?.whatsapp ?? '-')}</dd>
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
    </section>
  `;
}

function renderAccountSettings() {
  const email = state.user?.email ?? '';

  return sectionShell('Cuenta', 'Ajustes de Cuenta', 'title-account-settings', `
    <div class="db-admin-grid">
      <article class="db-card">
        <header class="db-card__header">
          <span class="section-label">Acceso</span>
        </header>
        <div class="db-card__inner">
          <form class="db-form" data-form="account-update">
            <label class="db-field">
              <span>Nuevo email</span>
              <input type="email" name="email" autocomplete="email" value="${escapeAttr(email)}" required />
            </label>
            <label class="db-field">
              <span>Nueva contrasena</span>
              <input type="password" name="password" autocomplete="new-password" minlength="6" placeholder="Dejar vacio para conservar" />
            </label>
            <label class="db-field">
              <span>Confirmar contrasena</span>
              <input type="password" name="password_confirm" autocomplete="new-password" minlength="6" placeholder="Repetir nueva contrasena" />
            </label>
            <button class="btn-primary" type="submit">Guardar cuenta</button>
          </form>
          <a class="db-profile-action db-profile-action--link" href="${escapeAttr(buildWhatsAppLink(PROFILE_UPDATE_WHATSAPP, 'Hola, quiero solicitar actualización de mis datos de perfil en Hidden Room / Mysauth.'))}" target="_blank" rel="noopener noreferrer">
            Solicitar actualización de datos
          </a>
        </div>
      </article>
    </div>
  `);
}

/** @param {string[]} roles */
function buildQuickActions(roles) {
  const actions = [];

  if (roles.includes('client')) {
    actions.push({ label: 'Ver Sesiones',      section: 'client-sessions'     });
    actions.push({ label: 'Mis Transacciones', section: 'client-transactions' });
  }
  if (roles.includes('pr')) {
    actions.push({ label: 'Lista de invitados', section: 'rrpp-guestlist'      });
  }
  if (roles.includes('collaborator')) {
    actions.push({ label: 'Ver Tareas',        section: 'collab-tasks'        });
    actions.push({ label: 'Financiero',        section: 'collab-finance'      });
  }

  if (actions.length === 0) {
    return `<p class="db-empty">Sin acciones disponibles para tus roles actuales.</p>`;
  }

  return actions.map((a) => `
    <button class="db-quick-action" data-section="${escapeHTML(a.section)}">
      ${escapeHTML(a.label)}
      <span class="db-quick-action__arrow" aria-hidden="true">-></span>
    </button>
  `).join('');
}

function renderLoadingBlock(label = 'Cargando') {
  return `
    <section class="db-section" aria-busy="true" aria-live="polite">
      <header class="db-section__header">
        <p class="section-label">${escapeHTML(label)}</p>
        <h1 class="db-section__title">Cargando...</h1>
      </header>
      <div class="db-grid db-grid--2col">
        <article class="db-card db-skeleton-card">
          <div class="db-card__inner">
            <span class="db-skeleton__line db-skeleton__line--wide"></span>
            <span class="db-skeleton__line db-skeleton__line--mid"></span>
            <span class="db-skeleton__line db-skeleton__line--narrow"></span>
          </div>
        </article>
      </div>
    </section>
  `;
}


/* -- CLIENT: DOWNLOADS -------------------------------------- */
async function renderClientDownloads() {
  const { data, error } = await supabase
    .from('downloads')
    .select('*')
    .eq('user_id', state.user.user_id);

  if (error) {
    console.error('[HR] renderClientDownloads:', error);
    return `
      <section class="db-section" aria-labelledby="title-downloads">
        <header class="db-section__header">
          <p class="section-label">Cliente</p>
          <h1 class="db-section__title" id="title-downloads">Descargas</h1>
        </header>
        <p class="db-empty db-empty--error">Error al cargar descargas. Intenta de nuevo.</p>
      </section>
    `;
  }

  let rows;

  if (!data || data.length === 0) {
    rows = `
      <tr class="db-table__empty-row">
        <td colspan="4" class="db-empty">Sin descargas disponibles.</td>
      </tr>
    `;
  } else {
    rows = data.map((p) => `
      <tr>
        <td>${escapeHTML(p.name ?? '-')}</td>
        <td>${escapeHTML(p.type ?? '-')}</td>
        <td>${escapeHTML(p.notes ?? '-')}</td>
        <td>
          ${p.storage_path
            ? `<a class="btn-primary" href="${escapeHTML(p.storage_path)}" target="_blank" rel="noopener noreferrer">Descargar</a>`
            : '-'}
        </td>
      </tr>
    `).join('');
  }

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
              <th scope="col">Notas</th>
              <th scope="col">Acción</th>
            </tr>
          </thead>
          <tbody id="js-downloads-body">
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}


/* -- CLIENT: SESSIONS --------------------------------------- */
async function renderClientSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', state.user.user_id)
    .order('session_date', { ascending: false });

  if (error) {
    console.error('[HR] renderClientSessions:', error);
    return `
      <section class="db-section" aria-labelledby="title-sessions">
        <header class="db-section__header">
          <p class="section-label">Cliente</p>
          <h1 class="db-section__title" id="title-sessions">Sesiones</h1>
        </header>
        <p class="db-empty db-empty--error">Error al cargar sesiones. Intenta de nuevo.</p>
      </section>
    `;
  }

  let rows;

  if (!data || data.length === 0) {
    rows = `
      <tr class="db-table__empty-row">
        <td colspan="5" class="db-empty">Sin sesiones registradas.</td>
      </tr>
    `;
  } else {
    rows = data.map((s) => `
      <tr>
        <td>${escapeHTML(s.concept ?? '-')}</td>
        <td>${s.session_date ? new Date(s.session_date).toLocaleDateString('es-MX') : '-'}</td>
        <td>${escapeHTML(s.status ?? '-')}</td>
        <td>${escapeHTML(s.cost != null ? `$${s.cost}` : '-')}</td>
        <td>${escapeHTML(s.notes ?? '-')}</td>
      </tr>
    `).join('');
  }

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
              <th scope="col">Estado</th>
              <th scope="col">Costo</th>
              <th scope="col">Notas</th>
            </tr>
          </thead>
          <tbody id="js-sessions-body">
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
}


/* -- CLIENT: TRANSACTIONS ----------------------------------- */
async function renderClientTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', state.user.user_id)
    .order('date', { ascending: false });

  if (error) {
    console.error('[HR] renderClientTransactions:', error);
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

  let rows;

  if (!data || data.length === 0) {
    rows = `
      <tr class="db-table__empty-row">
        <td colspan="5" class="db-empty">Sin transacciones registradas.</td>
      </tr>
    `;
  } else {
    rows = data.map((tx) => `
      <tr>
        <td>${escapeHTML(tx.concept ?? '-')}</td>
        <td>${escapeHTML(tx.type ?? '-')}</td>
        <td>$${escapeHTML(String(tx.amount ?? 0))}</td>
        <td>${tx.date ? new Date(tx.date).toLocaleDateString('es-MX') : '-'}</td>
        <td>${escapeHTML(tx.via ?? '-')}</td>
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
              <th scope="col">Tipo</th>
              <th scope="col">Monto</th>
              <th scope="col">Fecha</th>
              <th scope="col">Vía</th>
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


/* -- CLIENT: CONTRACTS -------------------------------------- */
async function renderClientContracts() {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('user_id', state.user.user_id);

  if (error) {
    console.error('[HR] renderClientContracts:', error);
    return `
      <section class="db-section" aria-labelledby="title-contracts">
        <header class="db-section__header">
          <p class="section-label">Cliente</p>
          <h1 class="db-section__title" id="title-contracts">Contratos</h1>
        </header>
        <p class="db-empty db-empty--error">Error al cargar contratos. Intenta de nuevo.</p>
      </section>
    `;
  }

  let listHTML;

  if (!data || data.length === 0) {
    listHTML = '<li class="db-empty">Sin contratos disponibles.</li>';
  } else {
    listHTML = data.map((c) => `
      <li class="db-card-list__item">
        <span class="db-card-list__label">Contrato #${escapeHTML(String(c.id))}</span>
        ${c.contract
          ? `<a class="btn-primary" href="${escapeHTML(c.contract)}" target="_blank" rel="noopener noreferrer">Ver contrato</a>`
          : '<span class="db-empty">Sin archivo adjunto.</span>'}
      </li>
    `).join('');
  }

  return `
    <section class="db-section" aria-labelledby="title-contracts">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-contracts">Contratos</h1>
      </header>
      <ul class="db-card-list" id="js-contracts-list" role="list">
        ${listHTML}
      </ul>
    </section>
  `;
}

function renderClientMembership() {
  return `
    <section class="db-section" aria-labelledby="title-membership">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-membership">Membresía</h1>
      </header>
      <div class="db-table-wrap">
        <table class="db-table" aria-label="Membresía">
          <thead>
            <tr>
              <th scope="col">Membresía</th>
              <th scope="col">Estado</th>
              <th scope="col">Inicio</th>
              <th scope="col">Renovacion</th>
            </tr>
          </thead>
          <tbody>
            <tr class="db-table__empty-row">
              <td colspan="4" class="db-empty">Sin datos de membresía.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}


/* -- CLIENT: TICKETS ---------------------------------------- */
function renderClientTickets() {
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


/* -- CLIENT: STORE ------------------------------------------ */
function renderClientStore() {
  return `
    <section class="db-section" aria-labelledby="title-store">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-store">Tienda Online - Pedidos</h1>
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


/* -- CLIENT: REWARDS ---------------------------------------- */
async function renderClientRewards() {
  const [
    { data: scores, error: scoresError },
    { data: rewards, error: rewardsError },
  ] = await Promise.all([
    supabase
      .from('scores')
      .select('*')
      .eq('user_id', state.user.user_id),
    supabase
      .from('rewards')
      .select('id, concept')
      .eq('user_id', state.user.user_id),
  ]);

  if (scoresError || rewardsError) {
    console.error('[HR] renderClientRewards:', scoresError || rewardsError);
    return `
      <section class="db-section" aria-labelledby="title-rewards">
        <header class="db-section__header">
          <p class="section-label">Cliente</p>
          <h1 class="db-section__title" id="title-rewards">Premios</h1>
        </header>
        <p class="db-empty db-empty--error">Error al cargar premios. Intenta de nuevo.</p>
      </section>
    `;
  }

  let scoresHTML;

  if (!scores || scores.length === 0) {
    scoresHTML = '<p class="db-empty">Sin partidas registradas.</p>';
  } else {
    scoresHTML = `
      <ul class="db-card-list" role="list">
        ${scores.map((s) => `
          <li class="db-card-list__item">
            <span class="db-card-list__label">${escapeHTML(s.game_id ?? '-')}</span>
            <span class="db-card-list__value">${escapeHTML(s.type ?? '')} ${escapeHTML(String(s.amount ?? 0))} pts</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

  const rewardsHTML = rewards?.length
    ? rewards.map((reward) => `
      <li class="db-card-list__item">
        <span class="db-card-list__label">${escapeHTML(reward.concept ?? 'Recompensa')}</span>
      </li>
    `).join('')
    : '<li class="db-empty">Sin recompensas.</li>';

  return `
    <section class="db-section" aria-labelledby="title-rewards">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-rewards">Premios</h1>
      </header>
      <div class="db-grid db-grid--3col">
        <article class="db-card" aria-label="Puntuaciones">
          <header class="db-card__header">
            <span class="section-label">Puntuaciones</span>
          </header>
          <div class="db-card__inner" id="js-rewards-scores">
            ${scoresHTML}
          </div>
        </article>
        <article class="db-card" aria-label="Cupones">
          <header class="db-card__header">
            <span class="section-label">Cupones Desbloqueados</span>
          </header>
          <ul class="db-coupon-list" id="js-rewards-coupons" role="list">
            <li class="db-empty">Próximamente.</li>
          </ul>
        </article>
        <article class="db-card" aria-label="Tus recompensas">
          <header class="db-card__header">
            <span class="section-label">Tus recompensas</span>
          </header>
          <ul class="db-card-list" id="js-rewards-inventory" role="list">
            ${rewardsHTML}
          </ul>
        </article>
      </div>
    </section>
  `;
}


/* -- COLLABORATOR ------------------------------------------- */
async function renderCollabDocs() {
  const { data, error } = await fetchPartnerContractsForCurrentUser();

  if (error) {
    console.error('[HR] renderCollabDocs:', error);
    return sectionShell('Colaborador', 'Documentos/Contratos', 'title-collab-docs', `
      <p class="db-empty db-empty--error">Error al cargar documentos/contratos.</p>
    `);
  }

  const rows = (data ?? []).length
    ? data.map((item) => {
      const title = item.title ?? item.name ?? item.contract_name ?? `Contrato #${item.id ?? '-'}`;
      const href = item.file_url ?? item.contract_url ?? item.storage_path ?? item.contract ?? '';
      return `
        <li class="db-card-list__item">
          <span class="db-card-list__label">${escapeHTML(title)}</span>
          <span class="db-card-list__value">${escapeHTML(item.status ?? item.type ?? 'documento')}</span>
          ${href ? `<a class="btn-primary" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">Ver</a>` : '<span class="db-empty">Sin archivo adjunto.</span>'}
        </li>
      `;
    }).join('')
    : '<li class="db-empty">Sin documentos/contratos compartidos.</li>';

  return sectionShell('Colaborador', 'Documentos/Contratos', 'title-collab-docs', `
    <ul class="db-card-list" id="js-collab-docs-list" role="list">${rows}</ul>
  `);
}

async function renderCollabFinance() {
  await ensureUsersLoaded();
  const filters = getFinanceFilters();
  const { data, error } = await fetchTransactions(filters, state.user?.user_id);

  if (error) {
    console.error('[HR] renderCollabFinance:', error);
    return sectionShell('Colaborador', 'Financiero', 'title-collab-finance', `
      <p class="db-empty db-empty--error">Error al cargar transacciones relacionadas.</p>
    `);
  }

  return sectionShell('Colaborador', 'Financiero', 'title-collab-finance', `
    ${renderFinanceFilters(filters)}
    ${renderFinanceMetrics(data ?? [])}
    ${renderTransactionsTable(data ?? [])}
  `);
}

async function renderCollabTasks() {
  if (!hasPermission('scrum.view')) {
    return sectionShell('Colaborador', 'SCRUM / Tareas', 'title-tasks', `
      <p class="db-empty db-empty--error">No tienes permiso para ver este modulo.</p>
    `);
  }

  const editable = canEditScrum();
  const [{ data: users, error: usersError }, { data: events, error: eventsError }] = await Promise.all([
    supabase
      .from('users')
      .select('user_id, display_name, username, email')
      .order('display_name', { ascending: true }),
    supabase
      .from('events')
      .select('id, name, title, event_date, date')
      .order('event_date', { ascending: false }),
  ]);

  if (usersError || eventsError) {
    console.error('[HR] renderCollabTasks:', usersError || eventsError);
    return sectionShell('Colaborador', 'SCRUM / Tareas', 'title-tasks', `
      <p class="db-empty db-empty--error">Error al cargar tareas. Intenta de nuevo.</p>
    `);
  }

  state.data.users = uniqueUsers(users);
  state.data.events = events ?? [];
  if (!state.data.scrumEventId && (events ?? []).length) state.data.scrumEventId = String(events[0].id);

  let taskQuery = supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false });

  if (state.data.scrumEventId) taskQuery = taskQuery.eq('event_id', state.data.scrumEventId);

  const { data: tasks, error: tasksError } = await taskQuery;
  if (tasksError) {
    console.error('[HR] renderCollabTasks:', tasksError);
    return sectionShell('Colaborador', 'SCRUM / Tareas', 'title-tasks', `
      <p class="db-empty db-empty--error">Error al cargar tareas para el evento seleccionado.</p>
    `);
  }

  state.data.tasks = tasks ?? [];

  const formHTML = editable ? renderTaskForm() : `
    <p class="db-empty">Modo lectura. Solicita scrum.edit para crear o modificar tareas.</p>
  `;

  const colHTML = SCRUM_COLUMNS.map((column) => {
    const columnTasks = (tasks ?? []).filter((task) => (task.status || 'todo') === column.key);
    const list = columnTasks.length
      ? columnTasks.map((task) => renderTaskCard(task, editable)).join('')
      : '<li class="db-empty">Sin tareas.</li>';

    return `
      <div class="db-scrum-col" data-status="${escapeHTML(column.key)}">
        <header class="db-scrum-col__header">
          <span class="db-scrum-col__title">${escapeHTML(column.label)}</span>
          <span class="db-scrum-col__count">${columnTasks.length}</span>
        </header>
        <ul class="db-scrum-col__list" role="list">
          ${list}
        </ul>
      </div>
    `;
  }).join('');

  return `
    <section class="db-section db-section--wide" aria-labelledby="title-tasks">
      <header class="db-section__header">
        <p class="section-label">Colaborador</p>
        <h1 class="db-section__title" id="title-tasks">SCRUM / Tareas</h1>
      </header>
      <div class="db-toolbar">
        <label class="db-field db-field--compact">
          <span>Evento</span>
          <select data-action="scrum-event-change" aria-label="Cambiar evento SCRUM">
            ${(events ?? []).map((event) => optionHTML(String(event.id), eventLabel(event), state.data.scrumEventId ?? '')).join('')}
          </select>
        </label>
      </div>
      <div class="db-admin-grid">
        <article class="db-card">
          <header class="db-card__header">
            <span class="section-label">${editable ? 'Nueva tarea' : 'Permisos'}</span>
          </header>
          <div class="db-card__inner">${formHTML}</div>
        </article>
      </div>
      <div class="db-scrum-board" id="js-scrum-board" aria-label="Tablero SCRUM">
        ${colHTML}
      </div>
    </section>
  `;
}

function renderCollabLog() {
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

function renderTaskForm(task = null) {
  const isEdit = Boolean(task);
  return `
    <form class="db-form" data-form="${isEdit ? 'task-update' : 'task-create'}">
      ${isEdit ? `<input type="hidden" name="id" value="${escapeHTML(task.id)}" />` : ''}
      <label class="db-field">
        <span>Titulo</span>
        <input name="title" required maxlength="120" value="${escapeAttr(task?.title ?? '')}" />
      </label>
      <label class="db-field">
        <span>Descripcion</span>
        <textarea name="description" rows="3">${escapeHTML(task?.description ?? '')}</textarea>
      </label>
      <div class="db-form__row">
        <label class="db-field">
          <span>Status</span>
          <select name="status">
            ${SCRUM_COLUMNS.map((col) => optionHTML(col.key, col.label, task?.status ?? 'todo')).join('')}
          </select>
        </label>
        <label class="db-field">
          <span>Prioridad</span>
          <select name="priority">
            ${TASK_PRIORITIES.map((p) => optionHTML(p, p, task?.priority ?? 'medium')).join('')}
          </select>
        </label>
      </div>
      <div class="db-form__row">
        ${renderUserPicker('assignee_id', 'Asignado a', task?.assignee_id ?? '')}
        <label class="db-field">
          <span>Entrega</span>
          <input type="date" name="due_date" value="${escapeAttr(task?.due_date ?? '')}" />
        </label>
      </div>
      <input type="hidden" name="event_id" value="${escapeAttr(task?.event_id ?? state.data.scrumEventId ?? '')}" />
      <div class="db-form__actions">
        <button class="btn-primary" type="submit">${isEdit ? 'Guardar cambios' : 'Crear tarea'}</button>
        ${isEdit ? '<button class="db-btn-secondary" type="button" data-action="task-cancel">Cancelar</button>' : ''}
      </div>
    </form>
  `;
}

function renderTaskCard(task, editable) {
  const currentStatus = task.status || 'todo';
  return `
    <li class="db-task-card" data-task-id="${escapeHTML(task.id)}">
      <div class="db-task-card__title">${escapeHTML(task.title ?? 'Sin titulo')}</div>
      ${task.description ? `<p class="db-task-card__desc">${escapeHTML(task.description)}</p>` : ''}
      <div class="db-task-card__meta">
        <span>${escapeHTML(task.priority ?? 'medium')}</span>
        <span>${escapeHTML(userLabel(task.assignee_id))}</span>
        ${task.due_date ? `<span>${escapeHTML(task.due_date)}</span>` : ''}
      </div>
      ${editable ? `
        <div class="db-task-card__actions">
          <select data-action="task-status" aria-label="Mover tarea">
            ${SCRUM_COLUMNS.map((col) => optionHTML(col.key, col.label, currentStatus)).join('')}
          </select>
          <button class="db-btn-secondary" type="button" data-action="task-edit">Editar</button>
          <button class="db-btn-danger" type="button" data-action="task-delete">Borrar</button>
        </div>
      ` : ''}
    </li>
  `;
}

function renderUserPicker(name, label, value = '') {
  const users = uniqueUsers(state.data.users);
  const selected = users.find((u) => String(u.user_id) === String(value));
  const displayValue = selected ? userLabel(selected.user_id) : '';
  const inputId = `user-picker-${escapeAttr(name)}-${Math.random().toString(36).slice(2, 8)}`;
  const options = users.map((user) => {
    const searchText = [
      user.display_name,
      user.email,
      user.username,
      user.user_id,
    ]
      .filter((item) => item !== null && item !== undefined)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    return `
    <button class="db-user-option" type="button" data-user-id="${escapeHTML(String(user.user_id))}" data-search-text="${escapeAttr(searchText)}">
      <span>${escapeHTML(user.display_name || user.email || 'Usuario sin nombre')}</span>
      <small>${escapeHTML(usernameLabel(user))}</small>
    </button>
  `;
  }).join('');

  return `
    <div class="db-field db-user-picker">
      <label for="${inputId}">${escapeHTML(label)}</label>
      <input id="${inputId}" data-user-search autocomplete="off" placeholder="Buscar usuario" value="${escapeAttr(displayValue)}" />
      <input type="hidden" name="${escapeHTML(name)}" value="${escapeAttr(value)}" />
      <div class="db-user-picker__menu" hidden>
        ${options}
        <div class="db-user-picker__empty" data-user-picker-empty hidden>Sin usuarios encontrados.</div>
      </div>
    </div>
  `;
}

function renderErpUserPicker(name, label) {
  if (!state.data.users) return '';
  return renderUserPicker(name, label, '');
}

function renderUserAutofillFields() {
  return `
    <div class="db-form__row">
      <label class="db-field"><span>User ID</span><input data-user-autofill="user_id" readonly placeholder="Se llena al seleccionar usuario" /></label>
      <label class="db-field"><span>Username</span><input name="username" data-user-autofill="username" readonly placeholder="Se llena al seleccionar usuario" /></label>
    </div>
  `;
}

function renderHalfHourOptions(selectedValue = '') {
  const options = ['<option value="">Seleccionar hora</option>'];
  for (let hour = 0; hour < 24; hour += 1) {
    ['00', '30'].forEach((minute) => {
      const value = `${String(hour).padStart(2, '0')}:${minute}`;
      options.push(optionHTML(value, value, selectedValue));
    });
  }
  return options.join('');
}

function optionHTML(value, label, selectedValue) {
  return `<option value="${escapeHTML(value)}"${String(value) === String(selectedValue) ? ' selected' : ''}>${escapeHTML(label)}</option>`;
}


/* -- MEDIA -------------------------------------------------- */
/* -- RRPP --------------------------------------------------- */
function renderRrppContacts() {
  return sectionShell('Embajador', 'Boletos vendidos', 'title-rrpp-contacts', `
    <div class="db-table-wrap">
      <table class="db-table" aria-label="Boletos vendidos">
        <thead><tr>
          <th scope="col">Cliente</th>
          <th scope="col">Canal</th>
          <th scope="col">Evento</th>
          <th scope="col">Boletos</th>
        </tr></thead>
        <tbody><tr class="db-table__empty-row">
          <td colspan="4" class="db-empty">Sin boletos vendidos registrados.</td>
        </tr></tbody>
      </table>
    </div>
  `);
}

function renderRrppInvitations() {
  return sectionShell('Embajador', 'Invitaciones', 'title-rrpp-inv', `
    <p class="db-empty">Sin invitaciones registradas.</p>
  `);
}

function renderRrppCampaigns() {
  return sectionShell('Embajador', 'Campañas', 'title-rrpp-camp', `
    <p class="db-empty">Sin campañas activas.</p>
  `);
}

function renderRrppGuestlist() {
  return sectionShell('Embajador', 'Lista de invitados', 'title-rrpp-guest', `
    <p class="db-empty">Sin listas de invitados disponibles.</p>
  `);
}

function renderRrppBenefits() {
  return sectionShell('Embajador', 'Beneficios', 'title-rrpp-benefits', `
    <p class="db-empty">Sin beneficios registrados.</p>
  `);
}


/* -- ERP ---------------------------------------------------- */
async function renderErpFinance() {
  await ensureUsersLoaded();
  const filters = getFinanceFilters();
  const events = await ensureFinanceEventsLoaded();
  if (filters.scope === 'events' && !filters.eventId && events.length) {
    filters.eventId = String(events[0].id);
    state.data.financeEventId = filters.eventId;
  }
  const { data, error } = await fetchFinanceTransactions(filters, events);

  if (error) {
    console.error('[HR] renderErpFinance:', error);
    return sectionShell('ERP', 'Finanzas', 'title-erp-finance', `
      <p class="db-empty db-empty--error">No se pudo cargar el dashboard financiero.</p>
    `);
  }

  state.data.erpFinanceRows = data ?? [];
  state.data.erpFinanceFilters = filters;

  return sectionShell('ERP', 'Finanzas', 'title-erp-finance', `
    ${renderFinanceScopeFilters(filters, events)}
    ${renderFinanceFilters(filters)}
    ${renderFinanceMetrics(data ?? [])}
    ${renderTransactionsTable(data ?? [])}
  `);
}

async function renderErpOps() {
  await ensureUsersLoaded();
  const activeForm = state.data.erpOpsForm || 'transaction';
  const opsForms = {
    transaction: {
      label: 'Finanzas',
      html: renderTransactionForm('transaction-create'),
    },
    session: {
      label: 'Sesion',
      html: `
        <form class="db-form" data-form="session-create">
          ${renderErpUserPicker('user_id', 'Usuario')}
          ${renderUserAutofillFields()}
          <div class="db-form__row">
            <label class="db-field"><span>Fecha</span><input name="session_date" type="date" required /></label>
          </div>
          <label class="db-field"><span>Concepto</span><input name="concept" required /></label>
          <div class="db-form__row">
            <label class="db-field"><span>Status</span><select name="status">${ERP_STATUS_OPTIONS.map((status) => optionHTML(status, status, 'sin apartado')).join('')}</select></label>
            <label class="db-field"><span>Tipo</span><select name="type" data-session-type required>${SESSION_TYPE_OPTIONS.map((item) => optionHTML(item.value, item.label, '')).join('')}</select></label>
          </div>
          <div class="db-form__row">
            <label class="db-field"><span>Hora de inicio</span><select name="hour" data-session-start required>${renderHalfHourOptions()}</select></label>
            <label class="db-field"><span>Hora de final</span><input name="sc_end" data-session-end type="time" readonly /></label>
          </div>
          <div class="db-form__row">
            <label class="db-field"><span>Costo</span><input name="cost" data-session-cost type="number" step="0.01" value="${SESSION_TYPE_OPTIONS[0].cost}" readonly /></label>
            <label class="db-field"><span>Promo</span><input name="promo" /></label>
          </div>
          <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
          <div class="db-form__actions">
            <button class="btn-primary" type="submit">Crear sesion</button>
            <button class="db-btn-secondary" type="button" data-action="operation-receipt">Compartir o descargar comprobante</button>
          </div>
        </form>
      `,
    },
    download: {
      label: 'Descarga',
      html: `
        <form class="db-form" data-form="download-create">
          ${renderErpUserPicker('user_id', 'Usuario')}
          ${renderUserAutofillFields()}
          <label class="db-field"><span>Nombre</span><input name="name" required /></label>
          <label class="db-field"><span>Ruta storage</span><input name="storage_path" required /></label>
          <label class="db-field"><span>Tipo</span><select name="type">${ERP_TYPE_OPTIONS.map((type) => optionHTML(type, type, '')).join('')}</select></label>
          <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
          <div class="db-form__actions">
            <button class="btn-primary" type="submit">Crear descarga</button>
            <button class="db-btn-secondary" type="button" data-action="operation-receipt">Compartir o descargar comprobante</button>
          </div>
        </form>
      `,
    },
    contract: {
      label: 'Contrato',
      html: `
        <form class="db-form" data-form="contract-create">
          ${renderErpUserPicker('user_id', 'Usuario')}
          ${renderUserAutofillFields()}
          <label class="db-field"><span>Contrato</span><input name="contract" required placeholder="URL o ruta" /></label>
          <div class="db-form__actions">
            <button class="btn-primary" type="submit">Crear contrato</button>
            <button class="db-btn-secondary" type="button" data-action="operation-receipt">Compartir o descargar comprobante</button>
          </div>
        </form>
      `,
    },
    user: {
      label: 'Usuario',
      html: `
        <form class="db-form" data-form="user-create">
          <div class="db-form__row">
            <label class="db-field"><span>Nombre</span><input name="display_name" required /></label>
            <label class="db-field"><span>Username</span><input name="username" /></label>
          </div>
          <label class="db-field"><span>Email</span><input type="email" name="email" required /></label>
          <div class="db-form__row">
            <label class="db-field"><span>WhatsApp</span><input name="whatsapp" /></label>
            <label class="db-field"><span>Rol</span><select name="roles">${AVAILABLE_ROLES.map((role) => optionHTML(role, role, 'client')).join('')}</select></label>
          </div>
          <button class="btn-primary" type="submit">Crear usuario</button>
          <div class="db-field__hint" data-admin-create-user-result hidden></div>
        </form>
      `,
    },
  };

  const selectedForm = opsForms[activeForm] ?? opsForms.session;

  return sectionShell('ERP', 'Operaciones', 'title-erp-ops', `
    <div class="db-toolbar">
      <label class="db-field db-field--compact">
        <span>Formulario</span>
        <select data-action="erp-ops-form" aria-label="Seleccionar formulario operativo">
          ${[
            ['transaction', 'Finanzas'],
            ['session', 'Sesion'],
            ['download', 'Descarga'],
            ['contract', 'Contrato'],
            ['user', 'Usuario'],
          ].map(([value, label]) => optionHTML(value, label, activeForm)).join('')}
        </select>
      </label>
    </div>
    <div class="db-admin-grid db-admin-grid--single">
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">${escapeHTML(selectedForm.label)}</span></header>
        <div class="db-card__inner">${selectedForm.html}</div>
      </article>
    </div>
  `);
}

function renderTransactionForm(formName) {
  const today = todayDateInputValue();
  return `
    <form class="db-form" data-form="${escapeAttr(formName)}">
      ${renderErpUserPicker('user_id', 'Usuario')}
      ${renderUserAutofillFields()}
      <div class="db-form__row">
        <label class="db-field"><span>Tipo</span><select name="type" required>${ERP_TYPE_OPTIONS.map((type) => optionHTML(type, type, '')).join('')}</select></label>
        <label class="db-field"><span>Monto</span><input name="amount" type="number" step="0.01" required /></label>
      </div>
      <label class="db-field"><span>Concepto</span><input name="concept" required /></label>
      <label class="db-field"><span>Fecha</span><input name="date" type="date" value="${escapeAttr(today)}" required /></label>
      <div class="db-form__row">
        <label class="db-field"><span>Via</span><select name="via">${['NU', 'NU CRED', 'EFECTIVO'].map((via) => optionHTML(via, via, '')).join('')}</select></label>
        <label class="db-field"><span>ID transaccion</span><input name="id_trans" /></label>
      </div>
      <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
      <div class="db-form__actions">
        <button class="btn-primary" type="submit">Crear transaccion</button>
        <button class="db-btn-secondary" type="button" data-action="operation-receipt">Compartir o descargar comprobante</button>
      </div>
    </form>
  `;
}

function getFinanceFilters() {
  const now = new Date();
  return {
    month: state.data.financeMonth ?? '',
    year: state.data.financeYear ?? String(now.getFullYear()),
    type: state.data.financeType ?? 'ambos',
    scope: state.data.financeScope ?? 'studio',
    studio: state.data.financeStudio ?? 'IXT',
    eventId: state.data.financeEventId ?? '',
  };
}

async function fetchTransactions(filters, userId = null) {
  let query = supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false });

  query = applyFinanceDateRange(query, filters);

  if (filters.type === 'ingresos') query = query.in('type', ['INGRESO', 'income', 'ingresos']);
  if (filters.type === 'egresos') query = query.in('type', ['EGRESO', 'expense', 'egresos']);
  if (userId) query = query.eq('user_id', userId);

  return query;
}

async function ensureFinanceEventsLoaded() {
  if (Array.isArray(state.data.financeEvents)) return state.data.financeEvents;

  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, name, title, event_date, date')
      .order('event_date', { ascending: false });

    if (error) {
      console.info('[HR] finance events unavailable:', error.message);
      state.data.financeEvents = [];
      return [];
    }

    state.data.financeEvents = data ?? [];
    return state.data.financeEvents;
  } catch (err) {
    console.info('[HR] finance events skipped:', err?.message ?? err);
    state.data.financeEvents = [];
    return [];
  }
}

async function fetchFinanceTransactions(filters, events = []) {
  const base = () => buildFinanceTransactionQuery('transactions', filters);

  if (filters.scope === 'studio') return base().eq('studio', filters.studio);
  if (!filters.eventId) return base();

  const selectedEvent = events.find((event) => String(event.id) === String(filters.eventId));
  const candidates = [
    ['event_id', filters.eventId],
    ['event_uuid', filters.eventId],
    ['event', filters.eventId],
    ['event_name', selectedEvent?.name ?? selectedEvent?.title],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');

  for (const [field, value] of candidates) {
    const result = await base().eq(field, value);
    if (!result.error) return result;
  }

  return base();
}

function buildFinanceTransactionQuery(tableName, filters) {
  let query = supabase
    .from(tableName)
    .select('*')
    .order('date', { ascending: false });

  query = applyFinanceDateRange(query, filters);

  if (filters.type === 'ingresos') query = query.in('type', ['INGRESO', 'income', 'ingresos']);
  if (filters.type === 'egresos') query = query.in('type', ['EGRESO', 'expense', 'egresos']);

  return query;
}

function applyFinanceDateRange(query, filters) {
  if (filters.year && filters.month) {
    const start = `${filters.year}-${filters.month}-01`;
    const endDate = new Date(Number(filters.year), Number(filters.month), 1);
    const end = endDate.toISOString().slice(0, 10);
    return query.gte('date', start).lt('date', end);
  }

  if (filters.year) {
    return query.gte('date', `${filters.year}-01-01`).lt('date', `${Number(filters.year) + 1}-01-01`);
  }

  return query;
}

function financePeriodLabel(filters) {
  if (filters.year && filters.month) return `${filters.month}/${filters.year}`;
  if (filters.year) return `Todos los meses de ${filters.year}`;
  return 'Historico completo';
}

function renderFinanceScopeFilters(filters, events = []) {
  const secondaryOptions = filters.scope === 'events'
    ? (events.length
      ? events.map((event) => [String(event.id), eventLabel(event)])
      : [['', 'Sin eventos disponibles']])
    : FINANCE_STUDIO_SOURCES.map((item) => [item.value, item.label]);

  const secondaryKey = filters.scope === 'events' ? 'financeEventId' : 'financeStudio';
  const secondaryValue = filters.scope === 'events' ? filters.eventId : filters.studio;
  const secondaryLabel = filters.scope === 'events' ? 'Evento' : 'Estudio';

  return `
    <div class="db-toolbar">
      <label class="db-field db-field--compact">
        <span>Origen</span>
        <select data-action="finance-filter" data-filter-key="financeScope">
          ${optionHTML('studio', 'Estudio', filters.scope)}
          ${optionHTML('events', 'Eventos', filters.scope)}
        </select>
      </label>
      <label class="db-field db-field--compact">
        <span>${escapeHTML(secondaryLabel)}</span>
        <select data-action="finance-filter" data-filter-key="${escapeAttr(secondaryKey)}">
          ${secondaryOptions.map(([value, label]) => optionHTML(value, label, secondaryValue)).join('')}
        </select>
      </label>
      <button class="db-btn-secondary" type="button" data-action="export-finance-pdf">Exportar PDF</button>
    </div>
  `;
}

function renderFinanceFilters(filters) {
  const years = Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  return `
    <div class="db-toolbar">
      <label class="db-field db-field--compact"><span>Mes</span><select data-action="finance-filter" data-filter-key="financeMonth">${optionHTML('', 'Todos los meses', filters.month)}${months.map((month) => optionHTML(month, month, filters.month)).join('')}</select></label>
      <label class="db-field db-field--compact"><span>Año</span><select data-action="finance-filter" data-filter-key="financeYear">${optionHTML('', 'Todos los años', filters.year)}${years.map((year) => optionHTML(year, year, filters.year)).join('')}</select></label>
      <label class="db-field db-field--compact"><span>Tipo</span><select data-action="finance-filter" data-filter-key="financeType">${[
        ['ambos', 'Ingresos y egresos'],
        ['ingresos', 'Ingresos'],
        ['egresos', 'Egresos'],
      ].map(([value, label]) => optionHTML(value, label, filters.type)).join('')}</select></label>
    </div>
  `;
}

function renderFinanceMetrics(transactions) {
  const ingresos = sumTransactions(transactions, 'INGRESO');
  const egresos = sumTransactions(transactions, 'EGRESO');
  const balance = ingresos - egresos;
  const max = Math.max(ingresos, egresos, 1);
  const clients = topClients(transactions);

  return `
    <div class="db-grid db-grid--3col db-finance-summary">
      ${renderStatCard('Total ingresos', money(ingresos))}
      ${renderStatCard('Total egresos', money(egresos))}
      ${renderStatCard('Balance', money(balance))}
    </div>
    <div class="db-grid db-grid--2col db-finance-dashboard">
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Ingresos vs egresos</span></header>
        <div class="db-card__inner">
          <div class="db-bar-chart">
            <div><span>Ingresos</span><i style="--bar:${Math.round((ingresos / max) * 100)}%"></i><strong>${money(ingresos)}</strong></div>
            <div><span>Egresos</span><i style="--bar:${Math.round((egresos / max) * 100)}%"></i><strong>${money(egresos)}</strong></div>
          </div>
        </div>
      </article>
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Top clientes</span></header>
        <ul class="db-card-list" role="list">
          ${clients.length ? clients.map((client) => `<li class="db-card-list__item"><span class="db-card-list__label">${escapeHTML(client.label)}</span><span class="db-card-list__value">${money(client.total)}</span></li>`).join('') : '<li class="db-empty">Sin clientes en el periodo.</li>'}
        </ul>
      </article>
    </div>
  `;
}

function renderTransactionsTable(transactions) {
  const tableId = `transactions-${state.activeSection}`;
  const activeSort = getTableSort(tableId, 'date', 'desc');
  const sortedTransactions = sortRowsByColumn(transactions, activeSort.field, activeSort.direction);
  const headers = [
    ['concept', 'Concepto'],
    ['type', 'Tipo'],
    ['amount', 'Monto'],
    ['date', 'Fecha'],
    ['status', 'Status'],
    ['username', 'Cliente'],
  ];
  const rows = sortedTransactions.length
    ? sortedTransactions.map((tx) => `
      <tr>
        <td>${escapeHTML(tx.concept ?? '-')}</td>
        <td>${escapeHTML(tx.type ?? '-')}</td>
        <td>${money(Number(tx.amount ?? 0))}</td>
        <td>${escapeHTML(formatDateOnly(tx.date))}</td>
        <td>${escapeHTML(tx.status ?? '-')}</td>
        <td>${escapeHTML(tx.username ?? tx.user_id ?? '-')}</td>
      </tr>
    `).join('')
    : '<tr class="db-table__empty-row"><td colspan="6" class="db-empty">Sin transacciones en el periodo.</td></tr>';

  return `
    <div class="db-table-wrap">
      <table class="db-table" aria-label="Desglose de transacciones">
        <thead><tr>
          ${headers.map(([field, label]) => renderSortableHeader(tableId, field, label, activeSort)).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function renderErpPermissions() {
  if (!hasRole('admin')) {
    return sectionShell('ERP', 'Permisos', 'title-erp-permissions', `
      <p class="db-empty db-empty--error">Acceso no autorizado.</p>
    `);
  }

  const [{ data: users, error: usersError }, { data: permissions, error: permissionsError }] = await Promise.all([
    supabase
      .from('users')
      .select('id, user_id, display_name, username, email, roles')
      .order('display_name', { ascending: true }),
    supabase
      .from('user_permissions')
      .select('id, user_id, permission_key')
      .order('permission_key', { ascending: true }),
  ]);

  if (usersError || permissionsError) {
    console.error('[HR] renderErpPermissions:', usersError || permissionsError);
    return sectionShell('ERP', 'Permisos', 'title-erp-permissions', `
      <p class="db-empty db-empty--error">Error al cargar usuarios y permisos.</p>
    `);
  }

  state.data.permissionUsers = users ?? [];
  state.data.userPermissions = permissions ?? [];

  const rows = (users ?? []).length
    ? users.map(renderPermissionUserRow).join('')
    : `<tr class="db-table__empty-row"><td colspan="6" class="db-empty">Sin usuarios registrados.</td></tr>`;

  return sectionShell('ERP', 'Permisos', 'title-erp-permissions', `
    <div class="db-toolbar">
      <label class="db-field db-field--compact db-field--search">
        <span>Buscar</span>
        <input data-table-search data-table-target="js-permissions-table-body" data-table-count="js-permissions-table-count" placeholder="Buscar por nombre, usuario, rol o permiso" />
        <small id="js-permissions-table-count" class="db-field__hint">${(users ?? []).length} filas visibles</small>
      </label>
    </div>
    <div class="db-table-wrap">
      <table class="db-table db-table--permissions" aria-label="Administracion de roles y permisos">
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Username</th>
            <th scope="col">User ID</th>
            <th scope="col">Rol</th>
            <th scope="col">Permisos</th>
            <th scope="col">Agregar</th>
          </tr>
        </thead>
        <tbody id="js-permissions-table-body">${rows}</tbody>
      </table>
    </div>
  `);
}

function renderPermissionUserRow(user) {
  const permissions = (state.data.userPermissions ?? [])
    .filter((permission) => String(permission.user_id) === String(user.id));

  const permissionList = permissions.length
    ? permissions.map((permission) => `
      <span class="db-permission-chip">
        ${escapeHTML(permission.permission_key)}
        <button type="button" data-action="permission-remove" data-permission-id="${escapeHTML(String(permission.id))}" aria-label="Quitar ${escapeAttr(permission.permission_key)}">x</button>
      </span>
    `).join('')
    : '<span class="db-empty">Sin permisos.</span>';
  const searchText = [
    user.display_name,
    user.email,
    user.username,
    user.user_id,
    user.roles,
    ...permissions.map((permission) => permission.permission_key),
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();

  return `
    <tr data-search-row data-search-text="${escapeAttr(searchText)}" data-user-uuid="${escapeHTML(String(user.id))}">
      <td>${escapeHTML(user.display_name ?? user.email ?? 'Sin nombre')}</td>
      <td>${escapeHTML(usernameLabel(user))}</td>
      <td>${escapeHTML(String(user.user_id ?? ''))}</td>
      <td>
        <select data-action="role-change" data-user-uuid="${escapeHTML(String(user.id))}" aria-label="Cambiar rol de ${escapeAttr(user.display_name ?? user.email ?? user.user_id ?? 'usuario')}">
          ${AVAILABLE_ROLES.map((role) => optionHTML(role, role, user.roles ?? 'client')).join('')}
        </select>
      </td>
      <td><div class="db-permission-list">${permissionList}</div></td>
      <td>
        <form class="db-inline-form" data-form="permission-add">
          <input type="hidden" name="user_uuid" value="${escapeAttr(user.id)}" />
          <select name="permission_key" aria-label="Agregar permiso">
            ${SUGGESTED_PERMISSIONS.map((permission) => optionHTML(permission, permission, '')).join('')}
          </select>
          <button class="db-btn-secondary" type="submit">Agregar</button>
        </form>
        <button class="db-btn-secondary" type="button" style="margin-top:4px" data-action="admin-user-edit" data-user-uuid="${escapeHTML(String(user.id))}">Editar usuario</button>
      </td>
    </tr>
  `;
}

async function renderAdminTableEditor() {
  if (!hasRole('admin')) {
    return sectionShell('ERP', 'BB.DD', 'title-admin-table-editor', `
      <p class="db-empty db-empty--error">Acceso no autorizado.</p>
    `);
  }

  const tableName = state.data.adminTableName || 'users';
  const config = TABLE_EDITOR_CONFIG[tableName] || TABLE_EDITOR_CONFIG.users;
  let data = [];

  try {
    data = await fetchAllTableEditorRows(tableName, config.select);
  } catch (error) {
    console.error('[HR] renderAdminTableEditor:', error);
    return sectionShell('ERP', 'BB.DD', 'title-admin-table-editor', `
      <p class="db-empty db-empty--error">No se pudo cargar ${escapeHTML(config.label)}. Revisa RLS/permisos.</p>
    `);
  }

  state.data.adminTableRows = data ?? [];

  const columns = [...config.lockedFields, ...config.editableFields]
    .filter((field, index, arr) => arr.indexOf(field) === index);
  const visibleColumns = columns.filter((field) => !(config.hiddenColumns ?? []).includes(field));
  const tableId = `admin-${tableName}`;
  const activeSort = getTableSort(tableId);
  const sortField = visibleColumns.includes(activeSort.field) ? activeSort.field : '';
  const sortedData = sortRowsByColumn(data ?? [], sortField, activeSort.direction);
  const searchQuery = adminTableSearchFor(tableName);
  const visibleData = sortedData.filter((row) => rowMatchesSearch(row, columns, searchQuery));

  const rows = visibleData.length
    ? visibleData.map((row, index) => renderAdminTableEditorRow(tableName, config, row, index)).join('')
    : `<tr class="db-table__empty-row"><td colspan="99" class="db-empty">Sin filas disponibles.</td></tr>`;

  return sectionShell('ERP', 'BB.DD', 'title-admin-table-editor', `
    <div class="db-toolbar">
      <label class="db-field db-field--compact">
        <span>Tabla</span>
        <select data-action="table-editor-table" aria-label="Seleccionar tabla">
          ${Object.entries(TABLE_EDITOR_CONFIG).filter(([, item]) => !item.hidden).map(([key, item]) => optionHTML(key, item.label, tableName)).join('')}
        </select>
      </label>
      <label class="db-field db-field--compact db-field--search">
        <span>Buscar</span>
        <input data-table-search data-admin-table-name="${escapeAttr(tableName)}" data-table-target="js-admin-table-body" data-table-count="js-admin-table-count" placeholder="Buscar por nombre, email, user_id..." value="${escapeAttr(searchQuery)}" />
        <small id="js-admin-table-count" class="db-field__hint">${searchQuery ? `${visibleData.length} resultado${visibleData.length === 1 ? '' : 's'}` : `${visibleData.length} filas visibles`}</small>
      </label>
      <button class="db-btn-secondary" type="button" data-action="export-admin-pdf" data-table-label="${escapeAttr(config.label)}">Exportar PDF</button>
    </div>
    ${tableName === 'users' ? '<p class="db-empty">El campo email se guarda a través de Auth (Edge Function). El cambio se aplica al confirmar el correo.</p>' : ''}
    <div class="db-table-wrap">
      <table class="db-table db-table--editor" aria-label="Editor de ${escapeAttr(config.label)}">
        <thead>
          <tr>
            ${visibleColumns.map((field) => renderSortableHeader(tableId, field, field, activeSort)).join('')}
            <th scope="col">Acciones</th>
          </tr>
        </thead>
        <tbody id="js-admin-table-body">${rows}</tbody>
      </table>
    </div>
  `);
}

function renderAdminTableEditorRow(tableName, config, row, index) {
  const columns = [...config.lockedFields, ...config.editableFields]
    .filter((field, fieldIndex, arr) => arr.indexOf(field) === fieldIndex);
  const visibleColumns = columns.filter((field) => !(config.hiddenColumns ?? []).includes(field));

  const original = encodeURIComponent(JSON.stringify(row));
  const searchText = columns
    .map((field) => row[field])
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();

  return `
    <tr data-search-row data-search-text="${escapeAttr(searchText)}">
      ${visibleColumns.map((field) => {
        const value = row[field] ?? '';
        if (config.lockedFields.includes(field)) {
          return `<td><code class="${field === 'temp_password' ? 'db-readonly-secret' : ''}">${escapeHTML(String(value))}</code></td>`;
        }

        return `
          <td>
            <input
              class="db-table-input"
              form="admin-table-form-${index}"
              name="${escapeAttr(field)}"
              value="${escapeAttr(value)}"
            />
          </td>
        `;
      }).join('')}
      <td>
        <form class="db-inline-form" id="admin-table-form-${index}" data-form="admin-table-update">
          <input type="hidden" name="table_name" value="${escapeAttr(tableName)}" />
          <input type="hidden" name="original" value="${escapeAttr(original)}" />
          <button class="db-btn-secondary" type="submit">Guardar</button>
        </form>
        <button class="db-btn-danger" type="button" data-action="admin-table-delete" data-table-name="${escapeAttr(tableName)}" data-row-original="${escapeAttr(original)}">Eliminar</button>
        ${tableName === 'users' && row.temp_password ? `<button class="db-btn-secondary" type="button" data-action="share-login" data-user-row="${escapeAttr(original)}">Compartir</button>` : ''}
      </td>
    </tr>
  `;
}


/* -- RENDER HELPER ------------------------------------------ */
/**
 * Generic section shell to reduce boilerplate.
 * @param {string} label
 * @param {string} title
 * @param {string} titleId
 * @param {string} bodyHTML
 */
function sectionShell(label, title, titleId, bodyHTML) {
  return `
    <section class="db-section" aria-labelledby="${escapeHTML(titleId)}">
      <header class="db-section__header">
        <p class="section-label">${escapeHTML(label)}</p>
        <h1 class="db-section__title" id="${escapeHTML(titleId)}">${escapeHTML(title)}</h1>
      </header>
      ${bodyHTML}
    </section>
  `;
}

async function ensureUsersLoaded() {
  if (state.data.users?.length) return state.data.users;

  const { data, error } = await supabase
    .from('users')
    .select('user_id, display_name, username, email')
    .order('display_name', { ascending: true });

  if (error) {
    console.error('[HR] ensureUsersLoaded:', error);
    showToast('No se pudieron cargar usuarios.', 'error');
    state.data.users = [];
    return [];
  }

  state.data.users = uniqueUsers(data);
  return state.data.users;
}

function formValues(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  for (const key of Object.keys(values)) {
    if (values[key] === '') values[key] = null;
  }
  return values;
}

function withTargetUsername(payload) {
  const user = (state.data.users ?? []).find((u) => String(u.user_id) === String(payload.user_id));
  return {
    ...payload,
    username: user?.username ?? user?.display_name ?? user?.email ?? null,
  };
}

function buildWhatsAppLink(phone, message) {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

function money(value) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function todayDateInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function sessionTypeConfig(value) {
  return SESSION_TYPE_OPTIONS.find((item) => item.value === value) ?? SESSION_TYPE_OPTIONS[0];
}

function addMinutesToTime(time, minutes) {
  if (!time || !Number.isFinite(minutes)) return '';
  const [hours, mins] = String(time).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return '';
  const total = ((hours * 60 + mins + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function updateSessionDerivedFields(form) {
  if (!form || form.dataset.form !== 'session-create') return;

  const typeSelect = form.querySelector('[data-session-type]');
  const startInput = form.querySelector('[data-session-start]');
  const endInput = form.querySelector('[data-session-end]');
  const costInput = form.querySelector('[data-session-cost]');
  const config = sessionTypeConfig(typeSelect?.value);

  if (costInput) costInput.value = config?.cost ?? '';
  if (endInput) endInput.value = addMinutesToTime(startInput?.value, config?.minutes);
}

function formatDateOnly(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

function normalizeTransactionType(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (['INCOME', 'INGRESO', 'INGRESOS'].includes(raw)) return 'INGRESO';
  if (['EXPENSE', 'EGRESO', 'EGRESOS'].includes(raw)) return 'EGRESO';
  return raw;
}

function sumTransactions(transactions, type) {
  return transactions
    .filter((tx) => normalizeTransactionType(tx.type) === type)
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function topClients(transactions) {
  const totals = new Map();
  transactions
    .filter((tx) => normalizeTransactionType(tx.type) === 'INGRESO')
    .forEach((tx) => {
      const key = tx.username || tx.user_id || 'Sin cliente';
      totals.set(key, (totals.get(key) || 0) + Number(tx.amount || 0));
    });

  return [...totals.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

function renderStatCard(label, value) {
  return `
    <article class="db-card db-stat-card">
      <div class="db-card__inner">
        <span class="section-label">${escapeHTML(label)}</span>
        <strong>${escapeHTML(value)}</strong>
      </div>
    </article>
  `;
}

function eventLabel(event) {
  const name = event.name ?? event.title ?? `Evento ${event.id}`;
  const date = event.event_date ?? event.date;
  return date ? `${name} · ${formatDateOnly(date)}` : name;
}

async function fetchPartnerContractsForCurrentUser() {
  const userId = state.user?.user_id;
  const first = await supabase
    .from('partner_contracts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!first.error) return first;

  return supabase
    .from('partner_contracts')
    .select('*')
    .eq('collaborator_id', userId)
    .order('created_at', { ascending: false });
}

async function insertRow(table, payload, successMessage) {
  const { error } = await supabase.from(table).insert(payload);
  if (error) {
    console.error(`[HR] ${table} insert:`, error);
    showToast('No se pudo guardar. Revisa permisos/RLS.', 'error');
    return false;
  }

  showToast(successMessage, 'success');
  return true;
}

async function handleTaskCreate(form) {
  if (!canEditScrum()) return showToast('No tienes permiso para editar SCRUM.', 'error');
  const payload = formValues(form);
  payload.created_by = state.user?.user_id ?? null;
  if (payload.due_date) payload.due_date = formatDateOnly(payload.due_date);

  const ok = await insertRow('tasks', payload, 'Tarea creada.');
  if (ok) {
    form.reset();
    navigate('collab-tasks');
  }
}

async function handleTaskUpdate(form) {
  if (!canEditScrum()) return showToast('No tienes permiso para editar SCRUM.', 'error');
  const { id, ...payload } = formValues(form);
  payload.updated_at = new Date().toISOString();
  if (payload.due_date) payload.due_date = formatDateOnly(payload.due_date);

  const { error } = await supabase.from('tasks').update(payload).eq('id', id);
  if (error) {
    console.error('[HR] task update:', error);
    showToast('No se pudo actualizar la tarea.', 'error');
    return;
  }

  showToast('Tarea actualizada.', 'success');
  navigate('collab-tasks');
}

async function handleTaskStatus(taskId, status) {
  if (!canEditScrum()) return showToast('No tienes permiso para editar SCRUM.', 'error');
  const { error } = await supabase
    .from('tasks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', taskId);

  if (error) {
    console.error('[HR] task status:', error);
    showToast('No se pudo mover la tarea.', 'error');
    return;
  }

  navigate('collab-tasks');
}

async function handleTaskDelete(taskId) {
  if (!canEditScrum()) return showToast('No tienes permiso para editar SCRUM.', 'error');
  if (!window.confirm('Borrar esta tarea?')) return;

  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) {
    console.error('[HR] task delete:', error);
    showToast('No se pudo borrar la tarea.', 'error');
    return;
  }

  showToast('Tarea borrada.', 'success');
  navigate('collab-tasks');
}

async function handleErpForm(form) {
  const type = form.dataset.form;
  const values = formValues(form);

  if ('user_id' in values && !values.user_id) {
    showToast('Selecciona un usuario valido.', 'error');
    return;
  }

  const numericKeys = ['amount', 'cost'];
  numericKeys.forEach((key) => {
    if (values[key] != null) values[key] = Number(values[key]);
  });

  ['date', 'session_date', 'due_date'].forEach((key) => {
    if (values[key]) values[key] = formatDateOnly(values[key]);
  });

  if (values.type) values.type = normalizeTransactionType(values.type);
  if (type === 'session-create' && !values.status) values.status = 'sin apartado';

  if (type === 'user-create') {
    const ok = await handleAdminUserCreate(values);
    if (ok) form.reset();
    return;
  }

  const operationPayload = { ...values };
  if (type === 'download-create' || type === 'contract-create') {
    delete operationPayload.username;
  }

  const map = {
    'transaction-create': ['transactions', withTargetUsername(operationPayload), 'Transaccion creada.'],
    'session-create': ['sessions', withTargetUsername(operationPayload), 'Sesion creada.'],
    'download-create': ['downloads', operationPayload, 'Descarga creada.'],
    'contract-create': ['contracts', operationPayload, 'Contrato creado.'],
  };

  const config = map[type];
  if (!config) return;

  const ok = await insertRow(config[0], config[1], config[2]);
  if (ok) {
    await handleOperationReceipt(form, { silent: true });
    form.reset();
  }
}

function operationReceiptTitle(formType) {
  const labels = {
    'transaction-create': 'Comprobante de transaccion',
    'session-create': 'Comprobante de sesion',
    'download-create': 'Comprobante de descarga',
    'contract-create': 'Comprobante de contrato',
  };
  return labels[formType] ?? 'Comprobante de operacion';
}

function operationReceiptRows(form) {
  const values = formValues(form);
  const user = (state.data.users ?? []).find((item) => String(item.user_id) === String(values.user_id));
  const sessionConfig = sessionTypeConfig(values.type);
  const rows = [
    ['Cliente', userLabel(values.user_id)],
    ['Username', values.username || user?.username || '-'],
    ['User ID', values.user_id || '-'],
  ];

  if (form.dataset.form === 'transaction-create') {
    rows.push(
      ['Fecha', values.date ? formatDateOnly(values.date) : formatDateOnly(new Date().toISOString())],
      ['Tipo', values.type || '-'],
      ['Concepto', values.concept || '-'],
      ['Monto', money(values.amount || 0)],
      ['Via', values.via || '-'],
      ['ID transaccion', values.id_trans || '-']
    );
  }

  if (form.dataset.form === 'session-create') {
    const status = values.status || 'sin apartado';
    rows.push(
      ['Fecha', values.session_date ? formatDateOnly(values.session_date) : '-'],
      ['Servicio', sessionConfig?.label || values.type || '-'],
      ['Status', status],
      ['Concepto', values.concept || '-'],
      ['Hora de inicio', values.hour || '-'],
      ['Hora de final', values.sc_end || '-'],
      ['Costo', money(values.cost || sessionConfig?.cost || 0)],
      ['Promo', values.promo || '-']
    );
  }

  if (form.dataset.form === 'download-create') {
    rows.push(
      ['Nombre', values.name || '-'],
      ['Ruta storage', values.storage_path || '-'],
      ['Tipo', values.type || '-']
    );
  }

  if (form.dataset.form === 'contract-create') {
    rows.push(['Contrato', values.contract || '-']);
  }

  if (values.notes) rows.push(['Notas', values.notes]);
  rows.push(['Terminos y condiciones', 'Al agendar aceptas que leiste los terminos y condiciones del servicio adquirido, disponibles en hiddenroom.mx/docs']);
  return rows;
}

async function handleOperationReceipt(form, options = {}) {
  try {
    await ensurePdfLibraries();
    const { jsPDF } = window.jspdf;
    const title = operationReceiptTitle(form.dataset.form);
    const generatedAt = new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const rows = operationReceiptRows(form);

    doc.setFontSize(16);
    doc.text(`Hidden Room - ${title}`, 40, 48);
    doc.setFontSize(10);
    doc.text(`Generado: ${generatedAt}`, 40, 66);
    doc.autoTable({
      head: [['Campo', 'Detalle']],
      body: rows,
      startY: 88,
      styles: { fontSize: 9, cellPadding: 6, overflow: 'linebreak' },
      headStyles: { fillColor: [32, 32, 32] },
      columnStyles: { 0: { cellWidth: 150 } },
      margin: { left: 40, right: 40 },
    });

    const fileName = `hidden-room-${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
    const blob = doc.output('blob');
    const file = new File([blob], fileName, { type: 'application/pdf' });

    if (!options.silent && navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ title: `Hidden Room - ${title}`, files: [file] });
      if (!options.silent) showToast('Comprobante compartido.', 'success');
      return;
    }

    doc.save(fileName);
    if (!options.silent) showToast('Comprobante PDF descargado.', 'success');
  } catch (err) {
    console.error('[HR] operation receipt:', err);
    showToast('No se pudo generar el comprobante PDF.', 'error');
  }
}

async function handleAdminUserCreate(values) {
  if (!requireAdminMutation()) return false;

  const email = values.email?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Email invalido.', 'error');
    return false;
  }

  try {
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: {
        email,
        profile: {
          display_name: values.display_name ?? null,
          username: values.username ?? null,
          whatsapp: values.whatsapp ?? null,
          roles: values.roles ?? 'client',
        },
      },
    });

    if (error) {
      console.error('[HR] admin-create-user function:', error);
      showToast(error.message || 'No se pudo crear el usuario.', 'error');
      return false;
    }

    showAdminCreatedUserResult(values, data);
    showToast('Usuario creado en Auth/public.users.', 'success');
    state.data.users = null;
    return true;
  } catch (err) {
    console.error('[HR] admin-create-user invoke:', err);
    showToast('Error al contactar la función de creación de usuario.', 'error');
    return false;
  }
}

function showAdminCreatedUserResult(values, result) {
  const holder = document.querySelector('[data-admin-create-user-result]');
  const tempPassword = result?.temp_password;
  if (!holder || !tempPassword) return;

  const email = result?.user?.email ?? values.email ?? '';
  holder.hidden = false;
  holder.innerHTML = `
    <strong>Usuario creado.</strong>
    <span style="display:block;margin-top:6px;">Email: ${escapeHTML(email)}</span>
    <span style="display:block;margin-top:6px;">Contraseña temporal: <code>${escapeHTML(tempPassword)}</code></span>
    <button class="db-btn-secondary" type="button" data-action="copy-temp-password" data-temp-password="${escapeAttr(tempPassword)}">Copiar contraseña temporal</button>
  `;
}

async function handleShareLogin(encodedRow) {
  if (!requireAdminMutation()) return;

  let user;
  try {
    user = JSON.parse(decodeURIComponent(encodedRow));
  } catch (err) {
    console.error('[HR] share login parse:', err);
    showToast('No se pudo preparar el mensaje.', 'error');
    return;
  }

  if (!user.email || !user.temp_password) {
    showToast('El usuario no tiene email o contraseña temporal visible.', 'error');
    return;
  }

  const message = [
    'Hola, estos son tus datos de acceso a Hidden Room / Mysauth:',
    `Correo: ${user.email}`,
    `Contraseña temporal: ${user.temp_password}`,
    'Al iniciar sesión se te pedirá actualizarla.',
  ].join('\n');

  try {
    await navigator.clipboard?.writeText(message);
  } catch (err) {
    console.info('[HR] clipboard unavailable:', err);
  }

  const phone = user.whatsapp || SHARE_LOGIN_WHATSAPP_FALLBACK;
  window.open(buildWhatsAppLink(phone, message), '_blank', 'noopener,noreferrer');
  showToast('Mensaje de login preparado.', 'success');
}

async function handleAccountUpdate(form) {
  const values = formValues(form);
  const email = values.email?.trim();
  const password = values.password;
  const passwordConfirm = values.password_confirm;

  if (!email) {
    showToast('Ingresa un email valido.', 'error');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('El formato del email no es valido.', 'error');
    return;
  }

  if (password || passwordConfirm) {
    if (password !== passwordConfirm) {
      showToast('Las contrasenas no coinciden.', 'error');
      return;
    }

    if (password.length < 8) {
      showToast('La contrasena debe tener al menos 8 caracteres.', 'error');
      return;
    }
  }

  const authPayload = { email };
  if (password) authPayload.password = password;

  const { data, error } = await supabase.auth.updateUser(authPayload);

  if (error) {
    console.error('[HR] account update:', error);
    showToast(error.message || 'No se pudo actualizar la cuenta.', 'error');
    return;
  }

  // NOTE: public.users.email is intentionally NOT updated here.
  // A database trigger syncs auth.users.email → public.users.email automatically.
  const confirmedImmediately = data?.user?.email === email;

  const nextUser = {
    ...state.user,
    ...(data?.user ?? {}),
    email: confirmedImmediately ? email : (state.user.email ?? email),
  };

  setState({ user: nextUser });
  hydrateTopbar();
  showToast(
    confirmedImmediately
      ? 'Cuenta actualizada correctamente.'
      : 'Revisa tu correo para confirmar el cambio de email. El cambio se aplicará al confirmar.',
    confirmedImmediately ? 'success' : 'info'
  );
  navigate('account-settings');
}

function requireAdminMutation() {
  if (hasRole('admin')) return true;
  showToast('Acceso no autorizado.', 'error');
  return false;
}

async function handleRoleChange(userUuid, role) {
  if (!requireAdminMutation()) return;
  if (!AVAILABLE_ROLES.includes(role)) {
    showToast('Rol invalido.', 'error');
    return;
  }

  const { error } = await supabase
    .from('users')
    .update({ roles: role })
    .eq('id', userUuid);

  if (error) {
    console.error('[HR] role update:', error);
    showToast('No se pudo actualizar el rol.', 'error');
    return;
  }

  showToast('Rol actualizado.', 'success');
  navigate('erp-permissions');
}

async function handlePermissionAdd(form) {
  if (!requireAdminMutation()) return;

  const values = formValues(form);
  const userUuid = values.user_uuid;
  const permissionKey = values.permission_key;

  if (!userUuid || !SUGGESTED_PERMISSIONS.includes(permissionKey)) {
    showToast('Permiso invalido.', 'error');
    return;
  }

  const { data: existing, error: checkError } = await supabase
    .from('user_permissions')
    .select('id')
    .eq('user_id', userUuid)
    .eq('permission_key', permissionKey)
    .limit(1);

  if (checkError) {
    console.error('[HR] permission duplicate check:', checkError);
    showToast('No se pudo validar el permiso.', 'error');
    return;
  }

  if ((existing ?? []).length > 0) {
    showToast('Ese permiso ya existe.', 'info');
    return;
  }

  const ok = await insertRow(
    'user_permissions',
    { user_id: userUuid, permission_key: permissionKey },
    'Permiso agregado.'
  );

  if (ok) navigate('erp-permissions');
}

async function handlePermissionRemove(permissionId) {
  if (!requireAdminMutation()) return;
  if (!permissionId) return;

  const { error } = await supabase
    .from('user_permissions')
    .delete()
    .eq('id', permissionId);

  if (error) {
    console.error('[HR] permission remove:', error);
    showToast('No se pudo quitar el permiso.', 'error');
    return;
  }

  showToast('Permiso removido.', 'success');
  navigate('erp-permissions');
}

/**
 * Opens an inline modal to edit a user's profile + email as an admin.
 * Email changes are routed through the "admin-update-user" Edge Function.
 * @param {string} userUuid  auth.users.id / public.users.id
 */
function showAdminUserEditModal(userUuid) {
  const users = state.data.permissionUsers ?? state.data.users ?? [];
  const user = users.find((u) => String(u.id) === String(userUuid));
  if (!user) { showToast('Usuario no encontrado.', 'error'); return; }

  // Remove any previous modal
  document.getElementById('js-admin-user-edit-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'js-admin-user-edit-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--db-bg,#1a1a1a);border:1px solid var(--db-border,#333);border-radius:8px;padding:24px;min-width:340px;max-width:480px;width:90%;">
      <h2 style="margin:0 0 16px;font-size:1.1rem;">Editar usuario</h2>
      <form id="js-admin-user-edit-form" class="db-form">
        <input type="hidden" name="user_uuid" value="${escapeAttr(userUuid)}" />
        <label class="db-field"><span>Display name</span>
          <input name="display_name" value="${escapeAttr(user.display_name ?? '')}" />
        </label>
        <label class="db-field"><span>Username</span>
          <input name="username" value="${escapeAttr(user.username ?? '')}" />
        </label>
        <label class="db-field"><span>WhatsApp</span>
          <input name="whatsapp" value="${escapeAttr(user.whatsapp ?? '')}" />
        </label>
        <label class="db-field"><span>Avatar URL</span>
          <input name="avatar_url" value="${escapeAttr(user.avatar_url ?? '')}" />
        </label>
        <label class="db-field"><span>Email (Auth)</span>
          <input type="email" name="email" value="${escapeAttr(user.email ?? '')}" required />
          <small style="color:var(--db-muted,#888)">Cambiar el email requiere confirmación del usuario. Se enruta via Edge Function.</small>
        </label>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button class="btn-primary" type="submit">Guardar</button>
          <button class="db-btn-secondary" type="button" id="js-admin-user-edit-cancel">Cancelar</button>
        </div>
        <div id="js-admin-user-edit-status" style="margin-top:8px;min-height:20px;font-size:.85rem;"></div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#js-admin-user-edit-cancel').addEventListener('click', () => overlay.remove());

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#js-admin-user-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const newEmail      = (fd.get('email') ?? '').trim();
    const display_name  = (fd.get('display_name') ?? '').trim() || null;
    const username      = (fd.get('username') ?? '').trim() || null;
    const whatsapp      = (fd.get('whatsapp') ?? '').trim() || null;
    const avatar_url    = (fd.get('avatar_url') ?? '').trim() || null;

    const statusEl = overlay.querySelector('#js-admin-user-edit-status');
    const submitBtn = overlay.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Guardando...';

    const ok = await handleAdminUserUpdate(
      user,
      newEmail,
      { display_name, username, whatsapp, avatar_url }
    );

    submitBtn.disabled = false;
    if (ok) {
      overlay.remove();
      navigate('erp-permissions');
    } else {
      if (statusEl) statusEl.textContent = 'No se pudo guardar. Verifica los datos e intenta de nuevo.';
    }
  });
}

/**
 * Admin update of a user's profile fields + email.
 * Email is routed through the Edge Function "admin-update-user" which uses the
 * service-role key server-side to update auth.users.email.
 * The DB trigger then syncs auth.users.email → public.users.email automatically.
 * All other profile fields are updated directly in public.users.
 *
 * @param {Object} selectedUser   Row from public.users (must have .id = auth UUID)
 * @param {string} newEmail
 * @param {Object} profileFields  Other editable public.users fields to save alongside
 */
async function handleAdminUserUpdate(selectedUser, newEmail, profileFields) {
  if (!requireAdminMutation()) return false;

  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    showToast('Email de administrador no valido.', 'error');
    return false;
  }

  const emailChanged = newEmail !== (selectedUser.email ?? '');

  // Route the email change (and profile fields) through the Edge Function.
  // The Edge Function uses the service-role key, so we never expose it here.
  if (emailChanged) {
    try {
      const { error: fnError } = await supabase.functions.invoke('admin-update-user', {
        body: {
          id: selectedUser.id,   // public.users.id = auth.users.id (UUID)
          email: newEmail,
          profile: {
            display_name:  profileFields.display_name  ?? selectedUser.display_name  ?? null,
            username:      profileFields.username      ?? selectedUser.username      ?? null,
            whatsapp:      profileFields.whatsapp      ?? selectedUser.whatsapp      ?? null,
            roles:         profileFields.roles         ?? selectedUser.roles         ?? null,
            avatar_url:    profileFields.avatar_url    ?? selectedUser.avatar_url    ?? null,
            user_id:       selectedUser.user_id        ?? null,
          },
        },
      });

      if (fnError) {
        console.error('[HR] admin-update-user function:', fnError);
        showToast(fnError.message || 'No se pudo actualizar el email del usuario.', 'error');
        return false;
      }

      showToast('Usuario actualizado. El email se sincronizará tras confirmación.', 'success');
      return true;

    } catch (err) {
      console.error('[HR] admin-update-user invoke error:', err);
      showToast('Error al contactar la función de actualización.', 'error');
      return false;
    }
  }

  // Email not changed — update only the profile fields directly in public.users.
  const { error: profileError } = await supabase
    .from('users')
    .update(profileFields)
    .eq('id', selectedUser.id);

  if (profileError) {
    console.error('[HR] admin profile update:', profileError);
    showToast('No se pudo actualizar el perfil.', 'error');
    return false;
  }

  showToast('Perfil del usuario actualizado.', 'success');
  return true;
}

async function handleAdminTableUpdate(form) {
  if (!requireAdminMutation()) return;

  const values = formValues(form);
  const tableName = values.table_name;
  const config = TABLE_EDITOR_CONFIG[tableName];

  if (!config) {
    showToast('Tabla no permitida.', 'error');
    return;
  }

  let original;
  try {
    original = JSON.parse(decodeURIComponent(values.original));
  } catch (err) {
    console.error('[HR] table editor original parse:', err);
    showToast('No se pudo leer la fila original.', 'error');
    return;
  }

  const payload = {};
  config.editableFields.forEach((field) => {
    if (field in values) payload[field] = values[field];
  });

  // public.users.email must be updated through auth.users via the Edge Function.
  // The DB trigger then syncs auth.users.email → public.users.email automatically.
  if (tableName === 'users' && 'email' in payload) {
    const newEmail = payload.email ?? '';
    delete payload.email; // never write email directly to public.users

    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('El email no tiene un formato válido.', 'error');
      return;
    }

    try {
      const { error: fnError } = await supabase.functions.invoke('admin-update-user', {
        body: {
          id: original.id,   // public.users.id = auth.users.id (UUID) — NOT user_id
          email: newEmail,
          profile: {
            display_name: payload.display_name ?? original.display_name ?? null,
            username:     payload.username     ?? original.username     ?? null,
            whatsapp:     payload.whatsapp     ?? original.whatsapp     ?? null,
            avatar_url:   payload.avatar_url   ?? original.avatar_url   ?? null,
            user_id:      original.user_id     ?? null,
          },
        },
      });

      if (fnError) {
        console.error('[HR] table editor admin-update-user:', fnError);
        showToast(fnError.message || 'No se pudo actualizar el email. Revisa la Edge Function.', 'error');
        return;
      }
    } catch (err) {
      console.error('[HR] table editor admin-update-user invoke:', err);
      showToast('Error al contactar la función de actualización de email.', 'error');
      return;
    }

    // If there are no other fields left to update, we're done.
    if (Object.keys(payload).length === 0) {
      showToast('Email actualizado vía Auth. Se sincronizará tras confirmación.', 'success');
      navigate('admin-table-editor');
      return;
    }
  }

  // Update remaining non-email fields directly in public.users (or any other table).
  if (Object.keys(payload).length === 0) {
    showToast('Sin cambios que guardar.', 'info');
    return;
  }

  let query = supabase.from(tableName).update(payload);

  if (config.primaryKey) {
    query = query.eq(config.primaryKey, original[config.primaryKey]);
  } else {
    config.matchFields.forEach((field) => {
      query = query.eq(field, original[field]);
    });
  }

  const { error } = await query;

  if (error) {
    console.error('[HR] table editor update:', error);
    showToast('No se pudo actualizar la fila. Revisa RLS/permisos.', 'error');
    return;
  }

  showToast('Fila actualizada.', 'success');
  navigate('admin-table-editor');
}

async function handleAdminTableDelete(tableName, encodedRow) {
  if (!requireAdminMutation()) return;

  const config = TABLE_EDITOR_CONFIG[tableName];
  if (!config) {
    showToast('Tabla no permitida.', 'error');
    return;
  }

  let original;
  try {
    original = JSON.parse(decodeURIComponent(encodedRow));
  } catch (err) {
    console.error('[HR] table editor delete parse:', err);
    showToast('No se pudo leer la fila a eliminar.', 'error');
    return;
  }

  const label = config.label || tableName;
  const readable = original.display_name || original.username || original.concept || original.name || original.id || original.user_id || 'esta fila';
  const confirmed = window.confirm(
    `Advertencia: vas a eliminar permanentemente ${readable} de ${label}.\n\nEsta acción no se puede deshacer. ¿Confirmas la eliminación?`
  );

  if (!confirmed) return;

  let query = supabase.from(tableName).delete();
  if (config.primaryKey) {
    query = query.eq(config.primaryKey, original[config.primaryKey]);
  } else if (original.id) {
    query = query.eq('id', original.id);
  } else {
    (config.matchFields ?? []).forEach((field) => {
      query = query.eq(field, original[field]);
    });
  }

  const { error } = await query;
  if (error) {
    console.error('[HR] table editor delete:', error);
    showToast('No se pudo eliminar la fila. Revisa RLS/permisos.', 'error');
    return;
  }

  showToast('Fila eliminada.', 'success');
  navigate('admin-table-editor');
}

function loadScriptOnce(src, globalCheck) {
  if (globalCheck()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function ensurePdfLibraries() {
  await loadScriptOnce(
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    () => Boolean(window.jspdf?.jsPDF)
  );
  await loadScriptOnce(
    'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js',
    () => Boolean(window.jspdf?.jsPDF?.API?.autoTable)
  );
}

async function handleAdminPdfExport(tableLabel = 'Tabla administrativa') {
  if (!requireAdminMutation()) return;

  const table = document.querySelector('.db-table--editor');
  if (!table) {
    showToast('No hay tabla visible para exportar.', 'error');
    return;
  }

  const headers = [...table.querySelectorAll('thead th')]
    .map((th) => th.textContent.trim())
    .filter((text) => text && text.toLowerCase() !== 'acciones');

  const rows = [...table.querySelectorAll('tbody tr')]
    .filter((tr) => !tr.hidden && !tr.classList.contains('db-table__empty-row'))
    .map((tr) => [...tr.children]
      .slice(0, headers.length)
      .map((td) => {
        const input = td.querySelector('input, textarea, select');
        return input ? input.value : td.textContent.trim();
      }));

  if (!rows.length) {
    showToast('No hay filas visibles para exportar.', 'info');
    return;
  }

  try {
    await ensurePdfLibraries();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const generatedAt = new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

    doc.setFontSize(16);
    doc.text('Hidden Room - Exportacion BB.DD.', 40, 40);
    doc.setFontSize(10);
    doc.text(`Generado: ${generatedAt}`, 40, 58);
    doc.text(`Tabla: ${tableLabel}`, 40, 74);

    doc.autoTable({
      head: [headers],
      body: rows,
      startY: 92,
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [32, 32, 32] },
      margin: { left: 40, right: 40 },
    });

    const fileName = `hidden-room-${String(tableLabel).toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(fileName);
    showToast('PDF generado.', 'success');
  } catch (err) {
    console.error('[HR] PDF export:', err);
    showToast('No se pudo generar el PDF.', 'error');
  }
}

async function handleFinancePdfExport() {
  if (!requireAdminMutation()) return;

  const rows = state.data.erpFinanceRows ?? [];
  const filters = state.data.erpFinanceFilters ?? getFinanceFilters();
  const scopeLabel = filters.scope === 'events'
    ? eventLabel((state.data.financeEvents ?? []).find((event) => String(event.id) === String(filters.eventId)) ?? { id: filters.eventId })
    : FINANCE_STUDIO_SOURCES.find((item) => item.value === filters.studio)?.label ?? filters.studio;

  if (!rows.length) {
    showToast('No hay datos financieros para exportar.', 'info');
    return;
  }

  try {
    await ensurePdfLibraries();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const generatedAt = new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    const ingresos = sumTransactions(rows, 'INGRESO');
    const egresos = sumTransactions(rows, 'EGRESO');

    doc.setFontSize(16);
    doc.text('Hidden Room - Finanzas', 40, 40);
    doc.setFontSize(10);
    doc.text(`Generado: ${generatedAt}`, 40, 58);
    doc.text(`Origen: ${filters.scope === 'events' ? 'Eventos' : 'Estudio'} / ${scopeLabel}`, 40, 74);
    doc.text(`Periodo: ${financePeriodLabel(filters)} - Tipo: ${filters.type}`, 40, 90);
    doc.text(`Ingresos: ${money(ingresos)}   Egresos: ${money(egresos)}   Balance: ${money(ingresos - egresos)}`, 40, 106);

    doc.autoTable({
      head: [['Concepto', 'Tipo', 'Monto', 'Fecha', 'Status', 'Cliente']],
      body: rows.map((tx) => [
        tx.concept ?? '-',
        tx.type ?? '-',
        money(Number(tx.amount ?? 0)),
        formatDateOnly(tx.date),
        tx.status ?? '-',
        tx.username ?? tx.user_id ?? '-',
      ]),
      startY: 124,
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
      headStyles: { fillColor: [32, 32, 32] },
      margin: { left: 40, right: 40 },
    });

    const fileName = `hidden-room-finanzas-${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(fileName);
    showToast('PDF financiero generado.', 'success');
  } catch (err) {
    console.error('[HR] finance PDF export:', err);
    showToast('No se pudo exportar Finanzas a PDF.', 'error');
  }
}

function filterTableRows(input) {
  const targetId = input.dataset.tableTarget;
  const tbody = document.getElementById(targetId);
  if (!tbody) return;

  const tableName = input.dataset.adminTableName;
  const query = input.value.trim();
  if (tableName) setAdminTableSearch(tableName, query);

  const normalizedQuery = normalizeSearchText(query);
  let visibleCount = 0;
  tbody.querySelectorAll('[data-search-row]').forEach((row) => {
    const searchable = normalizeSearchText(row.dataset.searchText || row.textContent);
    const visible = normalizedQuery ? searchable.includes(normalizedQuery) : true;
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  const count = document.getElementById(input.dataset.tableCount);
  if (count) {
    count.textContent = query
      ? `${visibleCount} resultado${visibleCount === 1 ? '' : 's'}`
      : `${visibleCount} filas visibles`;
  }
}


/* ================================================================
   Section 13  UTILITY FUNCTIONS
================================================================ */

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

function escapeAttr(value) {
  return escapeHTML(String(value ?? ''));
}

/** Human-readable relative time */
function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)    return 'ahora';
  if (diff < 3600_000)  return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h`;
  return `${Math.floor(diff / 86400_000)} d`;
}

function syncUserAutofillFields(picker, user) {
  const form = picker?.closest('form');
  if (!form) return;

  const userIdInput = form.querySelector('[data-user-autofill="user_id"]');
  const usernameInput = form.querySelector('[data-user-autofill="username"]');

  if (userIdInput) userIdInput.value = user?.user_id ?? '';
  if (usernameInput) usernameInput.value = user?.username ?? '';
}

function filterUserPicker(search, { clearSelection = false } = {}) {
  const picker = search.closest('.db-user-picker');
  const menu = picker?.querySelector('.db-user-picker__menu');
  const hidden = picker?.querySelector('input[type="hidden"]');
  const query = normalizeSearchText(search.value);

  if (clearSelection && hidden) hidden.value = '';
  if (clearSelection) syncUserAutofillFields(picker, null);
  if (!menu) return;

  menu.hidden = false;
  let visibleCount = 0;
  menu.querySelectorAll('.db-user-option').forEach((option) => {
    const text = normalizeSearchText(option.dataset.searchText || option.textContent);
    const visible = query ? text.includes(query) : true;
    option.hidden = !visible;
    option.style.display = visible ? '' : 'none';
    if (visible) visibleCount += 1;
  });

  const empty = menu.querySelector('[data-user-picker-empty]');
  if (empty) empty.hidden = visibleCount > 0;
}


/* ================================================================
   Section 14  EVENT DELEGATION - MAIN AREA
================================================================ */

function attachMainDelegation() {
  const main = document.getElementById('js-main');

  main?.addEventListener('click', (e) => {
    const qa = e.target.closest('.db-quick-action[data-section], .db-profile-action[data-section]');
    if (qa) {
      navigate(qa.dataset.section);
    }

    const userOption = e.target.closest('.db-user-option[data-user-id]');
    if (userOption) {
      const picker = userOption.closest('.db-user-picker');
      const hidden = picker?.querySelector('input[type="hidden"]');
      const search = picker?.querySelector('[data-user-search]');
      const user = (state.data.users ?? []).find((u) => String(u.user_id) === String(userOption.dataset.userId));
      if (hidden) hidden.value = userOption.dataset.userId;
      if (search) search.value = userLabel(userOption.dataset.userId);
      syncUserAutofillFields(picker, user);
      picker?.querySelector('.db-user-picker__menu')?.setAttribute('hidden', '');
      picker?.querySelectorAll('.db-user-option').forEach((option) => {
        option.hidden = false;
        option.style.display = '';
      });
      if (user) search?.setAttribute('aria-label', usernameLabel(user));
    }

    const taskCard = e.target.closest('.db-task-card[data-task-id]');
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (taskCard && action === 'task-edit') {
      const task = (state.data.tasks ?? []).find((item) => String(item.id) === String(taskCard.dataset.taskId));
      const holder = document.querySelector('.db-admin-grid .db-card__inner');
      if (task && holder) holder.innerHTML = renderTaskForm(task);
    }

    if (action === 'task-cancel') {
      navigate('collab-tasks');
    }

    if (taskCard && action === 'task-delete') {
      handleTaskDelete(taskCard.dataset.taskId);
    }

    if (action === 'permission-remove') {
      const btn = e.target.closest('[data-permission-id]');
      handlePermissionRemove(btn?.dataset.permissionId);
    }

    if (action === 'admin-user-edit') {
      const btn = e.target.closest('[data-user-uuid]');
      const userUuid = btn?.dataset.userUuid;
      if (userUuid) showAdminUserEditModal(userUuid);
    }

    if (action === 'share-login') {
      const btn = e.target.closest('[data-user-row]');
      if (btn?.dataset.userRow) handleShareLogin(btn.dataset.userRow);
    }

    if (action === 'copy-temp-password') {
      const btn = e.target.closest('[data-temp-password]');
      if (btn?.dataset.tempPassword) {
        navigator.clipboard?.writeText(btn.dataset.tempPassword)
          .then(() => showToast('Contraseña temporal copiada.', 'success'))
          .catch(() => showToast('No se pudo copiar automáticamente.', 'error'));
      }
    }

    if (action === 'table-sort') {
      const btn = e.target.closest('[data-table-id][data-sort-field]');
      if (btn) {
        setTableSort(btn.dataset.tableId, btn.dataset.sortField);
        navigate(state.activeSection);
      }
    }

    if (action === 'export-admin-pdf') {
      handleAdminPdfExport(e.target.closest('[data-table-label]')?.dataset.tableLabel);
    }

    if (action === 'export-finance-pdf') {
      handleFinancePdfExport();
    }

    if (action === 'admin-table-delete') {
      const btn = e.target.closest('[data-table-name][data-row-original]');
      if (btn) handleAdminTableDelete(btn.dataset.tableName, btn.dataset.rowOriginal);
    }

    if (action === 'operation-receipt') {
      const form = e.target.closest('form[data-form]');
      if (form) handleOperationReceipt(form);
    }
  });

  main?.addEventListener('change', (e) => {
    const statusSelect = e.target.closest('select[data-action="task-status"]');
    const taskCard = statusSelect?.closest('.db-task-card[data-task-id]');
    if (statusSelect && taskCard) {
      handleTaskStatus(taskCard.dataset.taskId, statusSelect.value);
    }

    const roleSelect = e.target.closest('select[data-action="role-change"]');
    if (roleSelect) {
      handleRoleChange(roleSelect.dataset.userUuid, roleSelect.value);
    }

    const tableSelect = e.target.closest('select[data-action="table-editor-table"]');
    if (tableSelect) {
      state.data.adminTableName = tableSelect.value;
      navigate('admin-table-editor');
      return;
    }

    const scrumEvent = e.target.closest('select[data-action="scrum-event-change"]');
    if (scrumEvent) {
      state.data.scrumEventId = scrumEvent.value;
      navigate('collab-tasks');
      return;
    }

    const financeFilter = e.target.closest('select[data-action="finance-filter"]');
    if (financeFilter) {
      state.data[financeFilter.dataset.filterKey] = financeFilter.value;
      if (financeFilter.dataset.filterKey === 'financeScope') {
        if (financeFilter.value === 'studio' && !state.data.financeStudio) {
          state.data.financeStudio = 'IXT';
        }
        if (financeFilter.value === 'events' && !state.data.financeEventId && (state.data.financeEvents ?? []).length) {
          state.data.financeEventId = String(state.data.financeEvents[0].id);
        }
      }
      navigate(state.activeSection);
      return;
    }

    const opsForm = e.target.closest('select[data-action="erp-ops-form"]');
    if (opsForm) {
      state.data.erpOpsForm = opsForm.value;
      navigate('erp-ops');
      return;
    }

    const sessionField = e.target.closest('[data-session-type], [data-session-start]');
    if (sessionField) {
      updateSessionDerivedFields(sessionField.closest('form'));
      return;
    }
  });

  main?.addEventListener('input', (e) => {
    const tableSearch = e.target.closest('[data-table-search]');
    if (tableSearch) {
      filterTableRows(tableSearch);
      return;
    }

    const sessionField = e.target.closest('[data-session-type], [data-session-start]');
    if (sessionField) {
      updateSessionDerivedFields(sessionField.closest('form'));
      return;
    }

    const search = e.target.closest('[data-user-search]');
    if (!search) return;
    filterUserPicker(search, { clearSelection: true });
  });

  main?.addEventListener('focusin', (e) => {
    const search = e.target.closest?.('[data-user-search]');
    if (!search) return;

    const picker = search.closest('.db-user-picker');
    const menu = picker?.querySelector('.db-user-picker__menu');
    if (menu) filterUserPicker(search);
  });

  main?.addEventListener('focusout', (e) => {
    const picker = e.target.closest?.('.db-user-picker');
    if (!picker) return;

    setTimeout(() => {
      if (!picker.contains(document.activeElement)) {
        picker.querySelector('.db-user-picker__menu')?.setAttribute('hidden', '');
      }
    }, 80);
  });

  main?.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;

    e.preventDefault();

    if (form.dataset.form === 'task-create') handleTaskCreate(form);
    if (form.dataset.form === 'task-update') handleTaskUpdate(form);
    if (form.dataset.form === 'account-update') handleAccountUpdate(form);
    if (form.dataset.form === 'permission-add') handlePermissionAdd(form);
    if (form.dataset.form === 'admin-table-update') handleAdminTableUpdate(form);
    if (form.dataset.form?.endsWith('-create') && !form.dataset.form.startsWith('task-')) {
      handleErpForm(form);
    }
  });
}


/* ================================================================
   Section 15a  ONBOARDING GATE
   -------------------------------------------------------------
   Non-bypassable modal shown when the logged-in user has:
     a) An email ending in @hiddenroom.local (must be replaced)
     b) A non-empty public.users.temp_password (must be changed)
   Both conditions can be true simultaneously; the modal handles both.
   temp_password is NEVER displayed, logged, or sent anywhere
   other than the check above.
================================================================ */

/**
 * Blocks the dashboard with a full-screen overlay until the user
 * completes all required onboarding steps.
 *
 * @param {boolean} needsEmail    - Must replace @hiddenroom.local email
 * @param {boolean} needsPassword - Must replace temporary password
 * @returns {Promise<void>}       - Resolves only after success + reload
 */
function showOnboardingModal(needsEmail, needsPassword) {
  return new Promise((resolve) => {
    // Remove any previous instance
    document.getElementById('js-onboarding-gate')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'js-onboarding-gate';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'onboarding-title');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:rgba(0,0,0,.88)',
      'z-index:99999',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:16px',
    ].join(';');

    // Build the inner sections conditionally
    const emailSection = needsEmail ? `
      <section id="js-ob-email-section">
        <h3 style="margin:0 0 8px;font-size:1rem;">Actualiza tu correo electrónico</h3>
        <p style="margin:0 0 12px;font-size:.875rem;color:var(--db-muted,#aaa)">
          Tu cuenta usa un correo temporal. Debes ingresar un correo real para continuar.
        </p>
        <label class="db-field">
          <span>Nuevo correo electrónico</span>
          <input id="js-ob-email" type="email" autocomplete="email" placeholder="nombre@ejemplo.com" required />
        </label>
        <div id="js-ob-email-error" style="color:#f87171;font-size:.8rem;min-height:18px;margin-top:4px;"></div>
      </section>
    ` : '';

    const passwordSection = needsPassword ? `
      <section id="js-ob-password-section" style="${needsEmail ? 'margin-top:20px;padding-top:20px;border-top:1px solid var(--db-border,#333);' : ''}">
        <h3 style="margin:0 0 8px;font-size:1rem;">Establece una nueva contraseña</h3>
        <p style="margin:0 0 12px;font-size:.875rem;color:var(--db-muted,#aaa)">
          Tu cuenta tiene una contraseña temporal. Debes crear una nueva contraseña para continuar.
        </p>
        <label class="db-field">
          <span>Nueva contraseña</span>
          <input id="js-ob-password" type="password" autocomplete="new-password" placeholder="Mínimo 8 caracteres" required />
        </label>
        <label class="db-field" style="margin-top:10px;">
          <span>Confirmar contraseña</span>
          <input id="js-ob-password-confirm" type="password" autocomplete="new-password" placeholder="Repetir contraseña" required />
        </label>
        <div id="js-ob-password-error" style="color:#f87171;font-size:.8rem;min-height:18px;margin-top:4px;"></div>
      </section>
    ` : '';

    overlay.innerHTML = `
      <div style="background:var(--db-bg,#111);border:1px solid var(--db-border,#333);border-radius:10px;padding:28px 24px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto;">
        <h2 id="onboarding-title" style="margin:0 0 6px;font-size:1.2rem;">Configuración inicial requerida</h2>
        <p style="margin:0 0 20px;font-size:.875rem;color:var(--db-muted,#aaa)">
          Debes completar los siguientes pasos antes de acceder al panel.
        </p>
        ${emailSection}
        ${passwordSection}
        <div id="js-ob-status" style="min-height:18px;font-size:.85rem;margin-top:12px;"></div>
        <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
          <button id="js-ob-submit" class="btn-primary" type="button">Guardar y continuar</button>
          <button id="js-ob-logout" class="db-btn-secondary" type="button">Cerrar sesión</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Prevent any click on the backdrop from closing it
    overlay.addEventListener('click', (e) => { e.stopPropagation(); });

    // Logout button
    overlay.querySelector('#js-ob-logout').addEventListener('click', () => {
      supabase.auth.signOut().finally(() => { window.location.href = './'; });
    });

    // Submit button
    overlay.querySelector('#js-ob-submit').addEventListener('click', async () => {
      const statusEl  = overlay.querySelector('#js-ob-status');
      const submitBtn = overlay.querySelector('#js-ob-submit');

      // Clear previous errors
      if (overlay.querySelector('#js-ob-email-error'))    overlay.querySelector('#js-ob-email-error').textContent    = '';
      if (overlay.querySelector('#js-ob-password-error')) overlay.querySelector('#js-ob-password-error').textContent = '';
      if (statusEl) statusEl.textContent = '';

      // ── Validate email ───────────────────────────────────────────
      let newEmail = null;
      if (needsEmail) {
        newEmail = (overlay.querySelector('#js-ob-email')?.value ?? '').trim();
        const emailErrorEl = overlay.querySelector('#js-ob-email-error');
        if (!newEmail) {
          if (emailErrorEl) emailErrorEl.textContent = 'El correo no puede estar vacío.';
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          if (emailErrorEl) emailErrorEl.textContent = 'El formato del correo no es válido.';
          return;
        }
        if (newEmail.toLowerCase().endsWith('@hiddenroom.local')) {
          if (emailErrorEl) emailErrorEl.textContent = 'Ingresa un correo real, no @hiddenroom.local.';
          return;
        }
      }

      // ── Validate password ────────────────────────────────────────
      let newPassword = null;
      if (needsPassword) {
        newPassword         = overlay.querySelector('#js-ob-password')?.value ?? '';
        const confirmPass   = overlay.querySelector('#js-ob-password-confirm')?.value ?? '';
        const passErrorEl   = overlay.querySelector('#js-ob-password-error');
        // Retrieve the stored temp_password only for comparison — never display it.
        const tempPass      = state.user?.temp_password ?? '';

        if (!newPassword) {
          if (passErrorEl) passErrorEl.textContent = 'La contraseña no puede estar vacía.';
          return;
        }
        if (newPassword.length < 8) {
          if (passErrorEl) passErrorEl.textContent = 'La contraseña debe tener al menos 8 caracteres.';
          return;
        }
        if (tempPass && newPassword === tempPass) {
          if (passErrorEl) passErrorEl.textContent = 'La nueva contraseña no puede ser igual a la contraseña temporal.';
          return;
        }
        if (newPassword !== confirmPass) {
          if (passErrorEl) passErrorEl.textContent = 'Las contraseñas no coinciden.';
          return;
        }
      }

      // ── Apply updates ────────────────────────────────────────────
      submitBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'Guardando...';

      try {
        // Build single auth.updateUser payload
        const authPayload = {};
        if (needsEmail)    authPayload.email    = newEmail;
        if (needsPassword) authPayload.password = newPassword;

        const { error: authError } = await supabase.auth.updateUser(authPayload);
        if (authError) throw authError;

        // If password changed, clear temp_password in public.users
        if (needsPassword) {
          const { error: clearTempError } = await supabase
            .from('users')
            .update({ temp_password: null })
            .eq('id', state.user.id);

          if (clearTempError) {
            // Non-fatal: log quietly, don't expose to user
            console.warn('[HR] onboarding: could not clear temp_password', clearTempError);
          }
        }

        // NOTE: public.users.email intentionally NOT updated here;
        // the DB trigger syncs it from auth.users.email automatically.

        if (statusEl) {
          statusEl.style.color = '#4ade80';
          statusEl.textContent = needsEmail
            ? 'Configuración guardada. Si Supabase requiere confirmación, revisa tu bandeja de entrada. Recargando...'
            : 'Configuración guardada. Recargando...';
        }

        setTimeout(() => { window.location.reload(); }, 2200);
        resolve();

      } catch (err) {
        console.error('[HR] onboarding gate update:', err);
        submitBtn.disabled = false;
        if (statusEl) {
          statusEl.style.color = '#f87171';
          statusEl.textContent = err.message || 'No se pudo guardar. Intenta de nuevo.';
        }
      }
    });
  });
}


/* ================================================================
   Section 15  INIT
================================================================ */

async function init() {
  const session = await bootstrapSession();

  if (!session) {
    window.location.href = './';
    return;
  }

  setState({
    user:        session.user,
    roles:       session.roles,
    permissions: session.permissions,
  });

  hydrateTopbar();
  applyRoleGates();
  syncLocalStorageRecords();

  attachSidebarListeners();
  attachNotificationListeners();
  attachUserMenuListeners();
  attachMainDelegation();

  await loadAndRenderNotifications();

  // ── Onboarding gate ──────────────────────────────────────────────
  // Check if the user needs to complete mandatory onboarding steps
  // before they can access the dashboard.
  const needsEmailReplacement = (state.user?.email ?? '').toLowerCase().endsWith('@hiddenroom.local');
  // NOTE: temp_password is only read once here for the gate check, never displayed or logged.
  const hasTempPassword = Boolean(state.user?.temp_password);

  if (needsEmailReplacement || hasTempPassword) {
    await showOnboardingModal(needsEmailReplacement, hasTempPassword);
    // showOnboardingModal only resolves after both required steps are done.
    return; // init() re-runs after reload inside the modal on success.
  }
  // ── End onboarding gate ──────────────────────────────────────────

  navigate('overview');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


/* ================================================================
   Section 16  PUBLIC API
================================================================ */
export {
  navigate,
  showToast,
  state,
  expandRoles,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  hasPermission,
  hasAnyPermission,
};
