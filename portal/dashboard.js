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
const MEMBERSHIP_SUPPORT_WHATSAPP = '5215542881737';
const LOCAL_SCORE_SYNC_KEYS = ['dem00nz_best', 'gol_gana_record'];
const NOTIFICATIONS_ENABLED = true;
const ACTIVE_SECTION_STORAGE_KEY = 'hr_dashboard_active_section';
const ADMIN_TABLE_STORAGE_KEY = 'hr_dashboard_admin_table';
const DASHBOARD_PREFS_STORAGE_KEY = 'hr_dashboard_prefs';
const MEMBERSHIP_CANONICAL = 'MEMBRESÍA';
const MEMBERSHIP_WEEKLY_COST = 500;
const ERP_TYPE_OPTIONS = ['INGRESO', 'EGRESO'];
const ERP_STATUS_OPTIONS = ['sin apartado', 'apartado', 'saldado'];
const SERVICE_OPTIONS = [
  MEMBERSHIP_CANONICAL,
  'GRABACIÓN',
  'PRODUCCIÓN BÁSICA',
  'PRODUCCIÓN PREMIUM',
  'DISTRIBUCIÓN',
  'PERSONALIZADO',
];
const TRANSACTION_CONCEPT_OPTIONS = [
  MEMBERSHIP_CANONICAL,
  'PAGO',
  'ABONO',
  'APARTADO',
  'SALDO',
  'RENTA DE ESTUDIO',
  'PERSONALIZADO',
];
const FINANCE_STUDIO_SOURCES = [
  { value: 'IXT', label: 'Ixtapaluca' },
  { value: 'VC', label: 'Venustiano Carranza' },
  { value: '003', label: 'Los $antos' },
];
const SESSION_TYPE_OPTIONS = [
  { value: MEMBERSHIP_CANONICAL, label: MEMBERSHIP_CANONICAL, minutes: 120, cost: MEMBERSHIP_WEEKLY_COST },
  { value: 'GRABACIÓN', label: 'GRABACIÓN', minutes: 60, cost: 650 },
  { value: 'SESIÓN BÁSICA', label: 'SESIÓN BÁSICA', minutes: 90, cost: 1700 },
  { value: 'SESIÓN PREMIUM', label: 'SESIÓN PREMIUM', minutes: 150, cost: 3700 },
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

  /** Disabled after Supabase reports public.notifications is not available */
  notificationsAvailable: NOTIFICATIONS_ENABLED,

  /** Whether the sidebar is open on mobile */
  sidebarOpen: false,

  /** Monotonic render guard for async section transitions */
  renderToken: 0,

  /** Session may be stale when UI role and API/RLS responses disagree */
  sessionStale: false,
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
  'erp-auth-audit': {
    label: 'Auth / Registros',
    roleRequired: 'admin',
    render: renderErpAuthAudit,
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
  'events.access',
  'tickets.view',
  'tickets.edit',
  'tickets.validate',
];

const EVENT_PERMISSION_FLAGS = [
  ['can_view', 'Ver Evento'],
  ['can_add_finance', 'Capturar Finanzas'],
  ['can_edit_finance', 'Editar Finanzas'],
  ['can_view_scrum', 'SCRUM View'],
  ['can_edit_scrum', 'Editar SCRUM'],
];

const EVENT_MOVEMENT_TYPES = [
  { value: 'income', label: 'Ingreso', sign: 1, legacyType: 'INGRESO' },
  { value: 'expense', label: 'Egreso', sign: -1, legacyType: 'EGRESO' },
  { value: 'investment_in', label: 'Inversión ingresada', sign: 1, legacyType: 'INVERSION INGRESADA' },
  { value: 'investment_return', label: 'Utilidad devuelta', sign: -1, legacyType: 'UTILIDAD DEVUELTA' },
  { value: 'counterparty_transfer', label: 'Entrega a favor', sign: 1, legacyType: 'ENTREGA A FAVOR' },
  { value: 'internal_absorption', label: 'Absorción interna', sign: 1, legacyType: 'ABSORCION INTERNA' },
  { value: 'adjustment', label: 'Ajuste', sign: 1, legacyType: 'AJUSTE' },
];

const EVENT_STATUS_OPTIONS = ['draft', 'active', 'closed', 'cancelled'];

const ADMIN_TABLE_FETCH_SIZE = 1000;

const TABLE_EDITOR_CONFIG = {
  users: {
    label: 'Usuarios',
    primaryKey: 'id',
    select: 'id, user_id, display_name, email, whatsapp, avatar_url, username, roles, has_auth, old_id, temp_password',
    lockedFields: ['id', 'user_id', 'roles', 'has_auth', 'old_id', 'temp_password'],
    editableFields: ['user_id', 'display_name', 'email', 'whatsapp', 'avatar_url', 'username'],
    hiddenColumns: ['id', 'old_id', 'temp_password'],
    pdfColumns: ['user_id', 'display_name', 'email', 'whatsapp', 'username', 'roles', 'has_auth'],
    pdfColumnLabels: {
      user_id: 'User ID',
      display_name: 'Nombre',
      email: 'Email',
      whatsapp: 'WhatsApp',
      username: 'Username',
      roles: 'Roles',
      has_auth: 'Auth',
    },
  },
  transactions: {
    label: 'Transacciones',
    primaryKey: 'id',
    select: 'id, user_id, type, concept, service, date, amount, via, username, id_trans, notes',
    defaultSort: { field: 'date', direction: 'desc' },
    lockedFields: ['id'],
    editableFields: ['user_id', 'type', 'concept', 'service', 'date', 'amount', 'via', 'username', 'id_trans', 'notes'],
    hiddenColumns: ['id'],
  },
  hr_transactions: {
    label: 'hr_transactions',
    primaryKey: 'id',
    select: 'id, event_id, event_key, movement_type, concept, amount, hidden_room_share, from_user_id, to_user_id, owner_user_id, owner_entity_id, payment_method, movement_date, notes, user_id, username, created_by_user_id, type, via, date',
    defaultSort: { field: 'movement_date', direction: 'desc' },
    lockedFields: ['id', 'created_by_user_id'],
    editableFields: ['event_id', 'event_key', 'movement_type', 'concept', 'amount', 'hidden_room_share', 'from_user_id', 'to_user_id', 'owner_user_id', 'owner_entity_id', 'payment_method', 'movement_date', 'notes', 'user_id', 'username', 'type', 'via', 'date'],
    hiddenColumns: ['id'],
  },
  sessions: {
    label: 'Sesiones',
    primaryKey: 'id',
    select: 'id, session_date, concept, user_id, status, type, notes, username, hour, sc_end, cost, promo',
    defaultSort: { field: 'session_date', direction: 'desc' },
    lockedFields: ['id'],
    editableFields: ['session_date', 'concept', 'user_id', 'status', 'type', 'notes', 'username', 'hour', 'sc_end', 'cost', 'promo'],
    hiddenColumns: ['id'],
  },
  scores: {
    label: 'Puntuaciones',
    primaryKey: 'id',
    select: 'id, created_at, game_id, user_id, username, type, amount',
    defaultSort: { field: 'created_at', direction: 'desc' },
    lockedFields: ['id', 'created_at'],
    editableFields: ['game_id', 'user_id', 'username', 'type', 'amount'],
    hiddenColumns: ['id'],
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
  membership_dashboard: {
    label: 'Membresia',
    primaryKey: null,
    select: 'user_id, username, semana, fecha_de_sesion, estado, fecha_de_saldo, saldo, notas',
    defaultSort: { field: 'fecha_esperada', direction: 'desc' },
    lockedFields: ['user_id', 'username', 'display_name', 'email', 'semana', 'periodo', 'fecha_esperada', 'fecha_de_sesion', 'sesiones_usadas', 'estado', 'estado_operativo', 'fecha_de_saldo', 'saldo', 'notas'],
    editableFields: [],
    hiddenColumns: ['membership_id', 'display_name', 'email'],
    readOnly: true,
    pdfColumnLabels: {
      user_id: 'User ID',
      username: 'Username',
      semana: 'Semana',
      periodo: 'Periodo',
      fecha_esperada: 'Fecha esperada',
      fecha_de_sesion: 'Fecha de sesion',
      sesiones_usadas: 'Sesiones usadas',
      estado: 'Estado',
      estado_operativo: 'Membresia',
      fecha_de_saldo: 'Fecha de saldo',
      saldo: 'Adeudo / crédito',
      notas: 'Notas',
    },
  },
  memberships: {
    label: 'Membresias',
    primaryKey: 'id',
    select: 'id, user_id, username, status, start_date, end_date, weekly_price, sessions_per_week, notes',
    defaultSort: { field: 'start_date', direction: 'desc' },
    lockedFields: ['id'],
    editableFields: ['user_id', 'username', 'status', 'start_date', 'end_date', 'weekly_price', 'sessions_per_week', 'notes'],
    hiddenColumns: ['id'],
  },
  membership_material_deliveries: {
    label: 'Entregas material',
    primaryKey: 'id',
    select: 'id, membership_id, user_id, cycle_number, delivered_at, notes, created_at',
    defaultSort: { field: 'delivered_at', direction: 'desc' },
    lockedFields: ['id', 'created_at'],
    editableFields: ['membership_id', 'user_id', 'cycle_number', 'delivered_at', 'notes'],
    hiddenColumns: ['id'],
  },
  events: {
    label: 'Eventos',
    primaryKey: 'id',
    select: 'id, event_key, name, event_date, venue, city, status, notes',
    defaultSort: { field: 'event_date', direction: 'desc' },
    lockedFields: ['id'],
    editableFields: ['event_key', 'name', 'event_date', 'venue', 'city', 'status', 'notes'],
    hiddenColumns: ['id'],
  },
  event_participations: {
    label: 'Participaciones de evento',
    primaryKey: 'id',
    select: 'id, event_id, user_id, participation_percent, role, notes, created_at',
    defaultSort: { field: 'created_at', direction: 'desc' },
    lockedFields: ['id', 'created_at'],
    editableFields: ['event_id', 'user_id', 'participation_percent', 'role', 'notes'],
    hiddenColumns: ['id'],
    hidden: true,
  },
  participants: {
    label: 'Participantes',
    primaryKey: 'id',
    select: 'id, user_id, role, status, notes, created_at',
    defaultSort: { field: 'created_at', direction: 'desc' },
    lockedFields: ['id', 'created_at'],
    editableFields: ['user_id', 'role', 'status', 'notes'],
    hiddenColumns: ['id'],
  },
  finance_entities: {
    label: 'Entidades financieras',
    primaryKey: 'id',
    select: 'id, entity_key, name, entity_type, status, notes, created_at',
    defaultSort: { field: 'name', direction: 'asc' },
    lockedFields: ['id', 'created_at'],
    editableFields: ['entity_key', 'name', 'entity_type', 'status', 'notes'],
    hiddenColumns: ['id'],
  },
};

async function fetchAllTableEditorRows(tableName, select, defaultSort = null) {
  const rows = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from(tableName)
      .select(select)
      .range(from, from + ADMIN_TABLE_FETCH_SIZE - 1);

    if (defaultSort?.field) {
      query = query.order(defaultSort.field, { ascending: defaultSort.direction !== 'desc' });
    }

    const { data, error } = await query;

    if (error) throw error;

    rows.push(...(data ?? []));

    if (!data || data.length < ADMIN_TABLE_FETCH_SIZE) break;
    from += ADMIN_TABLE_FETCH_SIZE;
  }

  return rows;
}

async function fetchComputedMembershipDashboardRows() {
  const [usersResult, membershipsResult, sessionsResult, transactionsResult, materialDeliveriesResult] = await Promise.all([
    fetchAllTableEditorRows('users', 'user_id, display_name, email, username', { field: 'display_name', direction: 'asc' }),
    fetchAllTableEditorRows('memberships', 'id, user_id, username, status, start_date, end_date, weekly_price, sessions_per_week, notes', { field: 'start_date', direction: 'asc' }),
    fetchAllTableEditorRows('sessions', '*', { field: 'session_date', direction: 'asc' }),
    fetchAllTableEditorRows('transactions', '*', { field: 'date', direction: 'asc' }),
    fetchMembershipMaterialDeliveries(),
  ]);

  const usersByUserId = new Map((usersResult ?? [])
    .filter((user) => user.user_id)
    .map((user) => [String(user.user_id), user]));
  state.data.membershipDashboardUsers = usersResult ?? [];
  state.data.users = uniqueUsers(usersResult ?? []);

  return buildMembershipRows(membershipsResult, sessionsResult, transactionsResult, materialDeliveriesResult)
    .map((row) => {
      const user = usersByUserId.get(String(row.user_id ?? ''));
      return {
        ...row,
        display_name: user?.display_name ?? row.username ?? null,
        email: user?.email ?? null,
        username: row.username ?? user?.username ?? null,
      };
    });
}

async function fetchMembershipMaterialDeliveries(userId = null) {
  try {
    let query = supabase
      .from('membership_material_deliveries')
      .select('id, membership_id, user_id, cycle_number, delivered_at, notes, created_at')
      .order('delivered_at', { ascending: true });

    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.info('[HR] membership material deliveries unavailable:', error?.message ?? error);
    return [];
  }
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

function isDateSortField(field) {
  return /(^|_)(date|fecha)(_de)?|date$|fecha$|_at$/i.test(String(field ?? ''));
}

function setTableSort(tableId, field) {
  const current = getTableSort(tableId);
  const direction = current.field === field
    ? (current.direction === 'asc' ? 'desc' : 'asc')
    : (isDateSortField(field) ? 'desc' : 'asc');
  state.data.tableSorts = {
    ...(state.data.tableSorts ?? {}),
    [tableId]: { field, direction },
  };
}

function sortRowsByColumn(rows, field, direction = 'asc') {
  if (!field) return rows ?? [];
  return sortTableEditorRows(rows ?? [], field, direction);
}

function readDashboardPrefs() {
  try {
    return JSON.parse(localStorage.getItem(DASHBOARD_PREFS_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeDashboardPrefs(patch = {}) {
  try {
    localStorage.setItem(DASHBOARD_PREFS_STORAGE_KEY, JSON.stringify({
      ...readDashboardPrefs(),
      ...patch,
    }));
  } catch {
    // localStorage can fail in private or restricted contexts; memory still works.
  }
}

function persistedDataValue(key, fallback = '') {
  if (state.data[key] !== undefined) return state.data[key];
  const stored = readDashboardPrefs()[key];
  return stored !== undefined ? stored : fallback;
}

function setPersistedDataValue(key, value) {
  state.data[key] = value;
  writeDashboardPrefs({ [key]: value });
  return value;
}

function tableSearchStorageKey(inputOrId) {
  if (!inputOrId) return '';
  if (typeof inputOrId === 'string') return inputOrId;
  return inputOrId.dataset.adminTableName || inputOrId.dataset.tableTarget || '';
}

function tableSearchFor(inputOrId) {
  const key = tableSearchStorageKey(inputOrId);
  if (!key) return '';
  if (state.data.tableSearches?.[key] !== undefined) return state.data.tableSearches[key];
  return readDashboardPrefs().tableSearches?.[key] ?? '';
}

function setTableSearch(inputOrId, query) {
  const key = tableSearchStorageKey(inputOrId);
  if (!key) return;
  state.data.tableSearches = {
    ...(state.data.tableSearches ?? {}),
    [key]: query,
  };
  writeDashboardPrefs({
    tableSearches: {
      ...(readDashboardPrefs().tableSearches ?? {}),
      [key]: query,
    },
  });
}

function adminTableSearchFor(tableName) {
  return state.data.adminTableSearches?.[tableName] ?? tableSearchFor(tableName);
}

function normalizeAdminTableName(tableName) {
  return TABLE_EDITOR_CONFIG[tableName] ? tableName : 'users';
}

function readStoredAdminTableName() {
  try {
    return normalizeAdminTableName(localStorage.getItem(ADMIN_TABLE_STORAGE_KEY));
  } catch {
    return 'users';
  }
}

function setAdminTableName(tableName) {
  const normalized = normalizeAdminTableName(tableName);
  state.data.adminTableName = normalized;
  try {
    localStorage.setItem(ADMIN_TABLE_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage failures; in-memory state still updates.
  }
  return normalized;
}

function setAdminTableSearch(tableName, query) {
  state.data.adminTableSearches = {
    ...(state.data.adminTableSearches ?? {}),
    [tableName]: query,
  };
  setTableSearch(tableName, query);
}

function isSessionStaleError(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code,
  ].filter(Boolean).join(' ').toLowerCase();

  return /jwt|token|expired|permission denied|row-level security|rls|invalid claim|not authorized|unauthorized/.test(text);
}

function persistAdminTableSearchFromDOM(tableName = state.data.adminTableName || readStoredAdminTableName()) {
  const input = [...document.querySelectorAll('[data-table-search]')]
    .find((item) => item.dataset.adminTableName === tableName);
  if (input) setAdminTableSearch(tableName, input.value.trim());
}

function restorePersistedTableSearches(root = document) {
  root.querySelectorAll('[data-table-search]').forEach((input) => {
    const query = tableSearchFor(input);
    if (!query) return;
    input.value = query;
    filterTableRows(input);
  });
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

function currentUserAuditFields() {
  return {
    created_by: state.user?.id ?? null,
    created_by_user_id: state.user?.user_id ?? null,
    created_by_username: state.user?.username ?? state.user?.display_name ?? state.user?.email ?? null,
  };
}

async function ensureCurrentUserOperationalId(authUser, profile = null) {
  if (profile?.user_id) return profile;
  if (!authUser?.id) return profile;

  try {
    const { data: ensuredUserId, error: ensureError } = await supabase.rpc('ensure_my_user_id');
    if (ensureError) {
      console.info('[HR] ensure user_id skipped:', ensureError.message);
      return profile;
    }

    if (!ensuredUserId) return profile;

    const { data: freshProfile, error: freshError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    if (freshError) {
      console.info('[HR] profile refresh after user_id skipped:', freshError.message);
      return { ...(profile ?? {}), id: authUser.id, user_id: ensuredUserId };
    }

    return freshProfile ?? { ...(profile ?? {}), id: authUser.id, user_id: ensuredUserId };
  } catch (err) {
    console.info('[HR] ensure user_id failed:', err?.message ?? err);
    return profile;
  }
}

async function syncLocalStorageRecords() {
  if (!state.user?.user_id) {
    const profile = await ensureCurrentUserOperationalId(state.user, state.user);
    if (profile?.user_id) {
      state.user = { ...state.user, ...profile };
    }
  }

  if (!state.user?.user_id) return;

  for (const key of LOCAL_SCORE_SYNC_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      const amount = Number(raw || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const gameId = key === 'dem00nz_best'
        ? 'flappy-nero'
        : key === 'gol_gana_record'
          ? 'gol-gana'
          : key.replace(/_best$/, '');

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
        username: state.user.username ?? state.user.display_name ?? state.user.email ?? null,
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

    const resolvedProfile = await ensureCurrentUserOperationalId(authUser, profile);

    // Merge auth user as fallback so email/id are always available
    const mergedUser = resolvedProfile ? { ...authUser, ...resolvedProfile } : authUser;

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
  persistActiveSection(sectionKey);
  updateSidebarActiveState(sectionKey);
  updateTopbarTitle(section.label);

  // Fire-and-forget: renderSection is async but navigate stays sync
  renderSection(sectionKey);
}

function persistActiveSection(sectionKey) {
  try {
    localStorage.setItem(ACTIVE_SECTION_STORAGE_KEY, sectionKey);
  } catch (err) {
    console.warn('[HR] active section storage unavailable:', err);
  }

  if (window.location.hash !== `#${sectionKey}`) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${sectionKey}`);
  }
}

function initialSectionKey() {
  const hashKey = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  if (SECTIONS[hashKey]) return hashKey;

  try {
    const stored = localStorage.getItem(ACTIVE_SECTION_STORAGE_KEY);
    if (SECTIONS[stored]) return stored;
  } catch (err) {
    console.warn('[HR] active section restore unavailable:', err);
  }

  return 'overview';
}

function attachRoutePersistenceListener() {
  window.addEventListener('hashchange', () => {
    const key = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
    if (SECTIONS[key] && key !== state.activeSection) navigate(key);
  });
}

function markSessionStale(reason = '') {
  if (state.sessionStale) return;
  state.sessionStale = true;
  console.warn('[HR] stale session suspected:', reason);
  showToast('Tu sesión parece desactualizada. Actualiza sesión para validar permisos.', 'error', 7000);
}

function renderSessionStaleBanner() {
  if (!state.sessionStale) return '';
  return `
    <div class="db-session-banner" role="alert">
      <div>
        <strong>Sesión desactualizada</strong>
        <span>Tu navegador puede estar usando permisos viejos. Actualiza la sesión para volver a consultar datos protegidos.</span>
      </div>
      <button class="db-btn-secondary" type="button" data-action="refresh-session">Actualizar sesión</button>
    </div>
  `;
}

async function handleRefreshSession() {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.session) {
      await supabase.auth.signOut();
      window.location.href = './';
      return;
    }

    const session = await bootstrapSession();
    if (!session) {
      await supabase.auth.signOut();
      window.location.href = './';
      return;
    }

    setState({
      user: session.user,
      roles: session.roles,
      permissions: session.permissions,
      data: {},
      sessionStale: false,
    });
    showToast('Sesión actualizada.', 'success');
    navigate(state.activeSection);
  } catch (err) {
    console.error('[HR] refresh session:', err);
    await supabase.auth.signOut();
    window.location.href = './';
  }
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
    wrap.innerHTML = `${renderSessionStaleBanner()}${html}`;
    enhancePasswordToggles(wrap);
    restorePersistedTableSearches(wrap);
  } catch (error) {
    if (state.renderToken !== renderToken) return;
    console.error('[HR] renderSection:', error);
    if (isSessionStaleError(error)) markSessionStale(error.message || 'render error');
    wrap.innerHTML = sectionShell('Sistema', 'No se pudo cargar', 'title-render-error', `
      ${renderSessionStaleBanner()}
      <p class="db-empty db-empty--error">Error al cargar este modulo.</p>
    `);
    enhancePasswordToggles(wrap);
    restorePersistedTableSearches(wrap);
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
    const fallbackInitial = (state.user.display_name ?? state.user.email ?? '?')[0].toUpperCase();
    const renderFallback = () => {
      avatarEl.textContent = fallbackInitial;
      avatarEl.removeAttribute('aria-label');
    };

    avatarEl.textContent = '';
    avatarEl.replaceChildren();

    if (/^https?:\/\//i.test(avatarUrl) && !isBlockedAvatarHost(avatarUrl)) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'lazy';
      img.addEventListener('error', renderFallback, { once: true });
      avatarEl.appendChild(img);
      avatarEl.setAttribute('aria-label', 'Foto de perfil');
    } else {
      renderFallback();
    }
  }
}

function isBlockedAvatarHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes('cdninstagram')
      || host.includes('fbcdn')
      || host.startsWith('scontent.');
  } catch {
    return false;
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
  document.querySelectorAll('.db-sidebar__item[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.section);
      closeUnifiedNavigation();
    });
  });

  document.querySelectorAll('.db-sidebar__item[data-sidebar-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleNavigationAction(btn.dataset.sidebarAction);
      closeUnifiedNavigation();
    });
  });

  // Tap on the topbar context label also toggles the sidebar on mobile
  document.querySelector('.db-topbar__context')?.addEventListener('click', () => {
    toggleUnifiedNavigation();
  });
}

function toggleUnifiedNavigation({ menuOnly = false } = {}) {
  const toggle = document.getElementById('js-user-menu-toggle');
  const menu = document.getElementById('js-user-menu');
  const sidebar = document.getElementById('js-sidebar');
  const shouldOpenMenu = menu?.hidden;
  const isMobile = window.matchMedia('(max-width: 800px)').matches;

  if (!menuOnly && isMobile) {
    const open = !state.sidebarOpen;
    if (menu) menu.hidden = true;
    setState({ sidebarOpen: open });
    sidebar?.classList.toggle('db-sidebar--open', open);
    toggle?.setAttribute('aria-expanded', String(Boolean(open)));
    return;
  }

  if (menu) menu.hidden = !shouldOpenMenu;
  toggle?.setAttribute('aria-expanded', String(Boolean(shouldOpenMenu)));
}

function closeUnifiedNavigation() {
  const toggle = document.getElementById('js-user-menu-toggle');
  const menu = document.getElementById('js-user-menu');
  const sidebar = document.getElementById('js-sidebar');
  if (menu) menu.hidden = true;
  setState({ sidebarOpen: false });
  sidebar?.classList.remove('db-sidebar--open');
  toggle?.setAttribute('aria-expanded', 'false');
}


/* ================================================================
   Section 9  NOTIFICATIONS
================================================================ */

async function fetchNotifications() {
  if (!state.notificationsAvailable) return [];

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
      if (/schema cache|could not find the table|404/i.test(error.message)) {
        setState({ notificationsAvailable: false });
      }
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
    setState({ notificationsAvailable: false });
    return [];
  }
}

async function loadAndRenderNotifications() {
  if (!NOTIFICATIONS_ENABLED) {
    document.getElementById('js-notifications-toggle')?.setAttribute('hidden', '');
    document.getElementById('js-notifications-panel')?.setAttribute('hidden', '');
    setState({ notifications: [] });
    return;
  }

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
    toggleUnifiedNavigation();
  });

  menu?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    handleNavigationAction(btn.dataset.action);
    closeUnifiedNavigation();
  });

  document.addEventListener('click', () => {
    if (menu && !menu.hidden) {
      closeUnifiedNavigation();
    }
  });
}

function handleNavigationAction(action) {
  if (action === 'logout')   handleLogout();
  if (action === 'profile')  navigate('overview');
  if (action === 'settings') navigate('account-settings');
  if (action === 'minigames') window.location.href = '../minijuegos/';
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
              <input type="password" name="password" autocomplete="new-password" minlength="6" placeholder="Nueva contrasena" />
            </label>
            <label class="db-field">
              <span>Confirmar contrasena</span>
              <input type="password" name="password_confirm" autocomplete="new-password" minlength="6" placeholder="Confirmar contrasena" />
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
    actions.push({ label: 'Cliente > Premios', caption: 'Puntaje de minijuegos', section: 'client-rewards' });
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
      <span class="db-quick-action__copy">
        <span>${escapeHTML(a.label)}</span>
        ${a.caption ? `<small>${escapeHTML(a.caption)}</small>` : ''}
      </span>
      <span class="db-quick-action__arrow" aria-hidden="true">-></span>
    </button>
  `).join('');
}

async function createUserNotification(userId, message, type = 'info') {
  const targetUserId = String(userId ?? '').trim();
  if (!targetUserId || !message) return false;

  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: targetUserId,
        message,
        type,
        read: false,
      });

    if (error) {
      console.info('[HR] notification insert skipped:', error.message);
      if (/schema cache|could not find the table|404/i.test(error.message)) {
        setState({ notificationsAvailable: false });
      }
      return false;
    }

    if (String(state.user?.user_id ?? '') === targetUserId || String(state.user?.id ?? '') === targetUserId) {
      await loadAndRenderNotifications();
    }
    return true;
  } catch (error) {
    console.info('[HR] notification insert unavailable:', error);
    return false;
  }
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
    .eq('user_id', state.user.user_id)
    .order('created_at', { ascending: false });

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
        <td>${s.session_date ? formatDisplayDateOnly(s.session_date) : '-'}</td>
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
        <td>${tx.date ? formatDisplayDateOnly(tx.date) : '-'}</td>
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
    .eq('user_id', state.user.user_id)
    .order('created_at', { ascending: false });

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

async function renderClientMembership() {
  const userId = state.user?.user_id;
  const [membershipsResult, sessionsResult, transactionsResult, materialDeliveriesResult] = await Promise.all([
    supabase
      .from('memberships')
      .select('id, user_id, username, status, start_date, end_date, weekly_price, sessions_per_week, notes')
      .eq('user_id', userId)
      .order('start_date', { ascending: true }),
    supabase
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('session_date', { ascending: true }),
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: true }),
    fetchMembershipMaterialDeliveries(userId),
  ]);

  if (membershipsResult.error || sessionsResult.error || transactionsResult.error) {
    console.error('[HR] renderClientMembership:', membershipsResult.error || sessionsResult.error || transactionsResult.error);
    return `
      <section class="db-section" aria-labelledby="title-membership">
        <header class="db-section__header">
          <p class="section-label">Cliente</p>
          <h1 class="db-section__title" id="title-membership">Membresía</h1>
        </header>
        <p class="db-empty db-empty--error">Error al cargar membresía. Intenta de nuevo.</p>
      </section>
    `;
  }

  const membershipRows = buildMembershipRows(
    membershipsResult.data ?? [],
    sessionsResult.data ?? [],
    transactionsResult.data ?? [],
    materialDeliveriesResult ?? []
  );
  const visibleMembershipRows = sortRowsByColumn(membershipRows, 'fecha_esperada', 'desc');
  const membershipNotices = renderMembershipNotices(membershipRows);
  const membershipSummary = renderMembershipSummary(membershipRows);

  return `
    <section class="db-section" aria-labelledby="title-membership">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-membership">Membresía</h1>
      </header>
      ${membershipNotices}
      ${membershipSummary}
      ${renderMembershipDashboardTable(visibleMembershipRows)}
      ${renderMembershipSyncFooter()}
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
      .eq('user_id', state.user.user_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('rewards')
      .select('id, concept, created_at')
      .eq('user_id', state.user.user_id)
      .order('created_at', { ascending: false }),
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
    scoresHTML = '<p class="db-empty">Ingresa <a href="../minijuegos/">MINIJUEGOS</a> para sincronizar tu puntuación.</p>';
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
        <a class="btn-primary db-section__cta" href="../minijuegos/">MINIJUEGOS</a>
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
  if (!hasRole('admin') && !hasPermission('events.access')) {
    return sectionShell('Colaborador', 'Financiero', 'title-collab-finance', `
      <p class="db-empty db-empty--error">No tienes permiso para ver finanzas de eventos.</p>
    `);
  }

  const filters = getEventFinanceFilters();
  const events = await ensureCollabFinanceEventsLoaded();
  if (!events.length) {
    return sectionShell('Colaborador', 'Financiero', 'title-collab-finance', `
      <p class="db-empty">No tienes eventos asignados todavía.</p>
    `);
  }

  const storedCollabEventId = persistedDataValue('collabFinanceEventId', '');
  if (storedCollabEventId && !events.some((event) => String(event.id ?? event.event_id) === String(storedCollabEventId))) {
    setPersistedDataValue('collabFinanceEventId', '');
  }
  const eventId = persistedDataValue('collabFinanceEventId', '') || String(events[0].id ?? events[0].event_id);
  setPersistedDataValue('collabFinanceEventId', eventId);
  const selectedEvent = events.find((event) => String(event.id ?? event.event_id) === String(eventId));
  const permissions = eventAccessFor(selectedEvent);
  const { data, error } = await fetchCollabFinanceTransactions(filters, eventId, events);
  const participants = await fetchParticipantsForEvent(selectedEvent?.id ?? selectedEvent?.event_id ?? eventId);
  const financeEntities = await fetchFinanceEntities();

  if (error) {
    console.error('[HR] renderCollabFinance:', error);
    return sectionShell('Colaborador', 'Financiero', 'title-collab-finance', `
      <p class="db-empty db-empty--error">Error al cargar transacciones relacionadas.</p>
    `);
  }

  state.data.collabFinanceRows = data ?? [];
  state.data.collabFinanceFilters = { ...filters, scope: 'events', eventId };
  state.data.collabFinanceSelectedEvent = selectedEvent ?? null;

  return sectionShell('Colaborador', 'Financiero', 'title-collab-finance', `
    ${renderCollabFinanceEventFilter(events, eventId)}
    ${renderFinanceFilters(filters)}
    ${renderEventInfo(selectedEvent)}
    ${renderEventSummaryCards(eventSummaryFor(selectedEvent, data ?? []))}
    ${renderEventRightsChart(selectedEvent, data ?? [])}
    ${permissions.can_add_finance ? renderEventMovementForm(selectedEvent, 'collab-event-movement-create', participants, financeEntities) : ''}
    ${renderEventFinanceTransactionsTable(data ?? [], { canEdit: permissions.can_edit_finance })}
  `);
}

async function ensureCollabFinanceEventsLoaded() {
  if (Array.isArray(state.data.collabFinanceEvents)) return state.data.collabFinanceEvents;

  state.data.collabFinanceEvents = await fetchAccessibleEventFinanceOptions('collab finance');
  return state.data.collabFinanceEvents;
}

async function fetchCollabFinanceTransactions(filters, eventId, events = []) {
  return fetchHrEventFinanceTransactions(filters, eventId, events);
}

function renderCollabFinanceEventFilter(events = [], selectedEventId = '') {
  return `
    <div class="db-toolbar">
      <label class="db-field db-field--compact">
        <span>Eventos</span>
        <select data-action="collab-finance-event" aria-label="Filtrar financiero por evento">
          ${events.map((event) => optionHTML(String(event.id ?? event.event_id), eventLabel(event), selectedEventId)).join('')}
        </select>
      </label>
      <button class="db-btn-secondary" type="button" data-action="export-finance-pdf">Exportar PDF</button>
    </div>
  `;
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
      .select('id, name, event_date, date')
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
  if (state.data.scrumEventId === undefined) {
    state.data.scrumEventId = persistedDataValue('scrumEventId', '');
  }
  if (!state.data.scrumEventId && (events ?? []).length) setPersistedDataValue('scrumEventId', String(events[0].id));

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

function renderUserPicker(name, label, value = '', options = {}) {
  const valueField = options.valueField || 'user_id';
  const users = uniqueUsers(state.data.users)
    .filter((user) => !options.requiredField || String(user?.[options.requiredField] ?? '').trim());
  const selected = users.find((u) => String(u?.[valueField] ?? '') === String(value));
  const displayValue = selected
    ? (options.displayValue?.(selected) ?? userLabel(selected.user_id))
    : '';
  const inputId = `user-picker-${escapeAttr(name)}-${Math.random().toString(36).slice(2, 8)}`;
  const optionButtons = users.map((user) => {
    const optionValue = String(user?.[valueField] ?? '');
    const optionDisplay = options.displayValue?.(user) ?? userLabel(user.user_id);
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
    <button class="db-user-option" type="button" data-user-id="${escapeAttr(String(user.user_id ?? ''))}" data-user-value="${escapeAttr(optionValue)}" data-user-display="${escapeAttr(optionDisplay)}" data-search-text="${escapeAttr(searchText)}">
      <span>${escapeHTML(user.display_name || user.email || 'Usuario sin nombre')}</span>
      <small>${escapeHTML(options.caption?.(user) ?? `${usernameLabel(user)} · ${user.user_id ?? '-'}`)}</small>
    </button>
  `;
  }).join('');

  return `
    <div class="db-field db-user-picker">
      <label for="${inputId}">${escapeHTML(label)}</label>
      <input id="${inputId}" data-user-search autocomplete="off" placeholder="${escapeAttr(options.placeholder || 'Buscar usuario')}" value="${escapeAttr(displayValue)}" />
      <input type="hidden" name="${escapeHTML(name)}" value="${escapeAttr(value)}" />
      <div class="db-user-picker__menu" hidden>
        ${optionButtons}
        <div class="db-user-picker__empty" data-user-picker-empty hidden>${escapeHTML(options.emptyLabel || 'Sin usuarios encontrados.')}</div>
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
  const baseFilters = getFinanceFilters();
  const filters = baseFilters.scope === 'events' ? getEventFinanceFilters(baseFilters) : baseFilters;
  const events = await ensureFinanceEventsLoaded();
  if (filters.scope === 'events') {
    if (filters.eventId && !events.some((event) => String(event.id) === String(filters.eventId))) {
      filters.eventId = '';
      setPersistedDataValue('financeEventId', '');
    }
    if (!filters.eventId && events.length) {
      filters.eventId = String(events[0].id);
      setPersistedDataValue('financeEventId', filters.eventId);
    }

    const selectedEvent = events.find((event) => String(event.id) === String(filters.eventId));
    const { data, error } = await fetchFinanceTransactions(filters, events);
    if (error) {
      console.error('[HR] renderErpFinance events:', error);
      return sectionShell('ERP', 'Finanzas', 'title-erp-finance', `
        <p class="db-empty db-empty--error">No se pudo cargar el dashboard financiero de eventos.</p>
      `);
    }

    state.data.erpFinanceRows = data ?? [];
    state.data.erpFinanceFilters = filters;
    await fetchAllEventParticipants();
    await fetchFinanceEntities();

    return sectionShell('ERP', 'Finanzas', 'title-erp-finance', `
      ${renderFinanceScopeFilters(filters, events)}
      ${renderFinanceFilters(filters)}
      ${selectedEvent ? renderEventInfo(selectedEvent) : '<p class="db-empty">Sin eventos disponibles.</p>'}
      ${selectedEvent ? renderEventSummaryCards(selectedEvent) : ''}
      ${selectedEvent ? renderEventRightsChart(selectedEvent, data ?? []) : ''}
      ${selectedEvent ? renderEventInternalInvestors(selectedEvent, data ?? []) : ''}
      ${renderEventFinanceTransactionsTable(data ?? [], { canEdit: true })}
    `);
  }

  if (filters.scope === 'events' && filters.eventId && !events.some((event) => normalizeEventKey(event.event_key) === normalizeEventKey(filters.eventId))) {
    filters.eventId = '';
    setPersistedDataValue('financeEventId', '');
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
    ${renderFinanceMetrics(data ?? [], filters.scope === 'events' ? eventFinanceAmount : transactionAmount, {
      balanceFromAmountWhenNoIncomeExpense: filters.scope === 'events',
    })}
    ${filters.scope === 'events' ? renderEventFinanceTransactionsTable(data ?? []) : renderTransactionsTable(data ?? [])}
  `);
}

async function renderErpOps() {
  await ensureUsersLoaded();
  const events = await ensureFinanceEventsLoaded();
  const participants = await fetchAllEventParticipants();
  const financeEntities = await fetchFinanceEntities();
  const memberships = await fetchMembershipOptionsForOps();
  const activeForm = persistedDataValue('erpOpsForm', 'transaction');
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
          <label class="db-field"><span>Concepto</span><input name="concept" data-session-concept required /></label>
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
          ${renderOperationCreateActions('CREAR')}
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
          ${renderOperationCreateActions('CREAR')}
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
          ${renderOperationCreateActions('CREAR')}
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
          <label class="db-field"><span>User ID</span><input name="user_id" autocomplete="off" /></label>
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
    event: {
      label: 'Evento',
      html: `
        <form class="db-form" data-form="event-create">
          <div class="db-form__row">
            <label class="db-field"><span>Clave del evento</span><input name="event_key" required /></label>
            <label class="db-field"><span>Nombre</span><input name="name" required /></label>
          </div>
          <div class="db-form__row">
            <label class="db-field"><span>Fecha</span><input name="event_date" type="date" /></label>
            <label class="db-field"><span>Status</span><select name="status">${EVENT_STATUS_OPTIONS.map((status) => optionHTML(status, status, 'closed')).join('')}</select></label>
          </div>
          <div class="db-form__row">
            <label class="db-field"><span>Venue</span><input name="venue" /></label>
            <label class="db-field"><span>Ciudad</span><input name="city" /></label>
          </div>
          <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
          <button class="btn-primary" type="submit">Crear evento</button>
        </form>
      `,
    },
    eventMovement: {
      label: 'Nuevo movimiento',
      html: renderEventMovementOpsForm(events, participants, financeEntities),
    },
    eventParticipant: {
      label: 'Nuevo participante',
      html: renderEventParticipantForm(),
    },
    financeEntity: {
      label: 'Entidad financiera',
      html: `
        <form class="db-form" data-form="finance-entity-create">
          <div class="db-form__row">
            <label class="db-field"><span>Clave</span><input name="entity_key" placeholder="productora_nombre" required /></label>
            <label class="db-field"><span>Nombre</span><input name="name" required /></label>
          </div>
          <div class="db-form__row">
            <label class="db-field"><span>Tipo</span><select name="entity_type">${[
              ['producer', 'Productora'],
              ['internal', 'Interna'],
              ['partner', 'Socio'],
              ['other', 'Otra'],
            ].map(([value, label]) => optionHTML(value, label, 'producer')).join('')}</select></label>
            <label class="db-field"><span>Status</span><select name="status">${[
              ['active', 'Activo'],
              ['inactive', 'Inactivo'],
            ].map(([value, label]) => optionHTML(value, label, 'active')).join('')}</select></label>
          </div>
          <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
          <button class="btn-primary" type="submit">Crear entidad financiera</button>
        </form>
      `,
    },
    membership: {
      label: 'Membresías',
      html: renderMembershipOpsForm(memberships),
    },
    userMerge: {
      label: 'Fusionar usuarios',
      html: `
        <form class="db-form" data-form="user-merge">
          ${renderUserPicker('keep_user_id', 'User ID histórico a conservar', '', {
            valueField: 'user_id',
            placeholder: 'Buscar perfil histórico',
            displayValue: (user) => `${user.display_name || user.username || user.email || 'Usuario'} · ${user.user_id ?? '-'}`,
            caption: (user) => `${usernameLabel(user)} · ${user.email ?? 'sin email'}`,
          })}
          ${renderUserPicker('duplicate_email', 'Email del perfil duplicado', '', {
            valueField: 'email',
            requiredField: 'email',
            placeholder: 'Buscar email duplicado',
            displayValue: (user) => `${user.email ?? ''} · ${user.display_name || user.username || 'Usuario'}`,
            caption: (user) => `${usernameLabel(user)} · ${user.email ?? 'sin email'}`,
            emptyLabel: 'Sin emails encontrados.',
          })}
          <p class="db-empty">La fusión conserva operaciones, sesiones, transacciones, premios, contratos, descargas y puntuaciones del User ID histórico. Del email duplicado solo toma Auth para login.</p>
          <button class="btn-primary" type="submit">Fusionar usuarios</button>
          <div class="db-field__hint" data-admin-merge-user-result hidden></div>
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
            ['event', 'Evento'],
            ['eventMovement', 'Nuevo movimiento'],
            ['eventParticipant', 'Nuevo participante'],
            ['financeEntity', 'Entidad financiera'],
            ['membership', 'Membresías'],
            ['userMerge', 'Fusionar usuarios'],
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

function renderEventParticipantForm() {
  return `
    <form class="db-form" data-form="event-participant-create">
      ${renderErpUserPicker('user_id', 'Usuario / participante')}
      ${renderUserAutofillFields()}
      <label class="db-field"><span>Rol general</span><input name="role" placeholder="Inversor, proveedor, venue..." /></label>
      <label class="db-field"><span>Status</span><select name="status">${['active', 'inactive'].map((status) => optionHTML(status, status, 'active')).join('')}</select></label>
      <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
      <button class="btn-primary" type="submit">Crear participante</button>
    </form>
  `;
}

async function fetchMembershipOptionsForOps() {
  try {
    const memberships = await fetchAllTableEditorRows(
      'memberships',
      'id, user_id, username, status, start_date, end_date, weekly_price, sessions_per_week, notes',
      { field: 'start_date', direction: 'desc' }
    );
    state.data.membershipOpsOptions = memberships;
    return memberships;
  } catch (error) {
    console.info('[HR] memberships options unavailable:', error?.message ?? error);
    state.data.membershipOpsOptions = [];
    return [];
  }
}

function membershipOptionLabel(membership) {
  const user = (state.data.users ?? []).find((item) => String(item.user_id) === String(membership.user_id));
  const label = user ? userLabel(user.user_id) : (membership.username || membership.user_id || 'Usuario');
  const dates = `${formatDisplayDateOnly(membership.start_date)}${membership.end_date ? ` a ${formatDisplayDateOnly(membership.end_date)}` : ''}`;
  return `${label} · ${String(membership.status ?? 'active').toUpperCase()} · ${dates}`;
}

function renderMembershipOpsForm(memberships = []) {
  const today = todayDateInputValue();
  const cancellable = (memberships ?? [])
    .filter((membership) => !['cancelled', 'expired'].includes(String(membership.status ?? '').toLowerCase()));

  return `
    <div class="db-membership-ops">
      <section class="db-membership-ops__block">
        <h2 class="db-membership-ops__title">Crear membresía</h2>
          <form class="db-form" data-form="membership-create">
            ${renderErpUserPicker('user_id', 'Usuario')}
            ${renderUserAutofillFields()}
            <div class="db-form__row">
              <label class="db-field"><span>Inicio</span><input name="start_date" type="date" value="${escapeAttr(today)}" required /></label>
              <label class="db-field"><span>Término</span><input name="end_date" type="date" /></label>
            </div>
            <div class="db-form__row">
              <label class="db-field"><span>Precio semanal</span><input name="weekly_price" type="number" step="0.01" value="${MEMBERSHIP_WEEKLY_COST}" required /></label>
              <label class="db-field"><span>Sesiones por semana</span><input name="sessions_per_week" type="number" step="1" min="1" value="1" required /></label>
            </div>
            <label class="db-field"><span>Status</span><select name="status">${['active', 'paused', 'cancelled', 'expired'].map((status) => optionHTML(status, status, 'active')).join('')}</select></label>
            <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
            <button class="btn-primary" type="submit">Crear membresía</button>
          </form>
      </section>
      <section class="db-membership-ops__block">
        <h2 class="db-membership-ops__title">Entrega de material</h2>
          <form class="db-form" data-form="membership-delivery">
            <input type="hidden" name="note_scope" value="delivery" />
            <label class="db-field">
              <span>Membresía</span>
              <select name="membership_id">
                <option value="">Sin public.memberships / legacy</option>
                ${memberships.map((membership) => optionHTML(membership.id, membershipOptionLabel(membership), '')).join('')}
              </select>
            </label>
            ${renderErpUserPicker('user_id', 'Usuario')}
            ${renderUserAutofillFields()}
            <div class="db-form__row">
              <label class="db-field"><span>Ciclo</span><input name="cycle_number" type="number" step="1" min="1" value="1" required /></label>
              <label class="db-field"><span>Fecha de entrega</span><input name="delivered_at" type="date" value="${escapeAttr(today)}" required /></label>
            </div>
            <label class="db-field"><span>Notas de entrega</span><textarea name="notes" rows="3"></textarea></label>
            <button class="btn-primary" type="submit">Registrar entrega</button>
          </form>
      </section>
      <section class="db-membership-ops__block">
        <h2 class="db-membership-ops__title">Cancelar membresía</h2>
          <form class="db-form" data-form="membership-cancel">
            <label class="db-field">
              <span>Membresía</span>
              <select name="membership_id" required>
                <option value="">Seleccionar membresía</option>
                ${cancellable.map((membership) => optionHTML(membership.id, membershipOptionLabel(membership), '')).join('')}
              </select>
            </label>
            <label class="db-field"><span>Fecha de término</span><input name="end_date" type="date" value="${escapeAttr(today)}" required /></label>
            <label class="db-field"><span>Notas de cancelación</span><textarea name="notes" rows="3"></textarea></label>
            <button class="db-btn-danger" type="submit">Cancelar membresía</button>
          </form>
      </section>
    </div>
  `;
}

function renderOperationCreateActions(createLabel = 'CREAR') {
  return `
    <div class="db-form__actions">
      <button class="btn-primary" type="submit" data-operation-action="create-share">CREAR y COMPARTIR COMPROBANTE</button>
      <button class="db-btn-secondary" type="submit" data-operation-action="create">${escapeHTML(createLabel)}</button>
    </div>
  `;
}

function renderTransactionForm(formName) {
  const today = todayDateInputValue();
  return `
    <form class="db-form" data-form="${escapeAttr(formName)}">
      ${renderErpUserPicker('user_id', 'Usuario')}
      ${renderUserAutofillFields()}
      <div class="db-form__row">
        <label class="db-field"><span>Tipo</span><select name="type" required>${ERP_TYPE_OPTIONS.map((type) => optionHTML(type, type, '')).join('')}</select></label>
        <label class="db-field"><span>Servicio</span><select name="service" data-transaction-service required>${SERVICE_OPTIONS.map((service) => optionHTML(service, service, '')).join('')}</select></label>
      </div>
      <div class="db-form__row">
        <label class="db-field"><span>Monto</span><input name="amount" type="number" step="0.01" required /></label>
        <label class="db-field"><span>Concepto</span><select name="concept" data-transaction-concept required>${TRANSACTION_CONCEPT_OPTIONS.map((concept) => optionHTML(concept, concept, '')).join('')}</select></label>
      </div>
      <label class="db-field" data-custom-concept-wrap hidden><span>Concepto personalizado</span><input name="concept_custom" data-custom-concept /></label>
      <label class="db-field"><span>Fecha</span><input name="date" type="date" value="${escapeAttr(today)}" required /></label>
      <div class="db-form__row">
        <label class="db-field"><span>Via</span><select name="via">${['NU', 'NU CRED', 'EFECTIVO'].map((via) => optionHTML(via, via, '')).join('')}</select></label>
        <label class="db-field"><span>ID transaccion</span><input name="id_trans" /></label>
      </div>
      <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
      ${renderOperationCreateActions('CREAR')}
    </form>
  `;
}

function getFinanceFilters() {
  const now = new Date();
  return {
    month: persistedDataValue('financeMonth', ''),
    year: persistedDataValue('financeYear', String(now.getFullYear())),
    type: persistedDataValue('financeType', 'ambos'),
    scope: persistedDataValue('financeScope', 'studio'),
    studio: persistedDataValue('financeStudio', 'IXT'),
    eventId: persistedDataValue('financeEventId', ''),
  };
}

function getEventFinanceFilters(filters = getFinanceFilters()) {
  return {
    ...filters,
    month: persistedDataValue('financeMonth', ''),
    year: persistedDataValue('financeYear', ''),
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

  state.data.financeEvents = await fetchAdminEventFinanceOptions('erp finance');
  return state.data.financeEvents;
}

async function fetchFinanceTransactions(filters, events = []) {
  if (filters.scope === 'studio') {
    return buildFinanceTransactionQuery('transactions', filters).eq('studio', filters.studio);
  }

  return fetchHrEventFinanceTransactions(filters, filters.eventId, events);
}

function buildFinanceTransactionQuery(tableName, filters) {
  let query = supabase
    .from(tableName)
    .select('*')
    .order(tableName === 'hr_transactions' ? 'movement_date' : 'date', { ascending: false });

  query = applyFinanceDateRange(query, filters, tableName === 'hr_transactions' ? 'movement_date' : 'date');

  if (tableName === 'hr_transactions') {
    if (filters.type === 'ingresos') query = query.eq('movement_type', 'income');
    if (filters.type === 'egresos') query = query.eq('movement_type', 'expense');
  } else {
    if (filters.type === 'ingresos') query = query.in('type', ['INGRESO', 'income', 'ingresos']);
    if (filters.type === 'egresos') query = query.in('type', ['EGRESO', 'expense', 'egresos']);
  }

  return query;
}

async function fetchHrEventFinanceTransactions(filters, eventId, events = []) {
  const selectedEvent = events.find((event) => String(event.id ?? event.event_id) === String(eventId));
  let query = buildFinanceTransactionQuery('hr_transactions', filters);

  if (selectedEvent?.id || selectedEvent?.event_id) {
    query = query.eq('event_id', selectedEvent.id ?? selectedEvent.event_id);
  } else if (selectedEvent?.event_key || eventId) {
    query = query.eq('event_key', selectedEvent?.event_key ?? eventId);
  }

  return query;
}

function normalizeEventKey(value) {
  return String(value ?? '').trim().toUpperCase();
}

function applyFinanceDateRange(query, filters, dateField = 'date') {
  if (filters.year && filters.month) {
    const start = `${filters.year}-${filters.month}-01`;
    const endDate = new Date(Number(filters.year), Number(filters.month), 1);
    const end = endDate.toISOString().slice(0, 10);
    return query.gte(dateField, start).lt(dateField, end);
  }

  if (filters.year) {
    return query.gte(dateField, `${filters.year}-01-01`).lt(dateField, `${Number(filters.year) + 1}-01-01`);
  }

  return query;
}

function financePeriodLabel(filters) {
  if (filters.year && filters.month) return `${filters.month}/${filters.year}`;
  if (filters.year) return `Todos los meses de ${filters.year}`;
  return 'Historico completo';
}

function renderFinanceScopeFilters(filters, events = []) {
  const keyedEvents = events.filter((event) => event.id || event.event_id || event.event_key);
  const secondaryOptions = filters.scope === 'events'
    ? (keyedEvents.length
      ? keyedEvents.map((event) => [String(event.id ?? event.event_id ?? event.event_key), eventLabel(event)])
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

function renderFinanceMetrics(transactions, amountGetter = transactionAmount, options = {}) {
  const totals = financeTotals(transactions, amountGetter, options);
  const { ingresos, egresos, balance, hasExplicitIncomeExpense } = totals;
  const showIncomeExpenseAsNE = options.balanceFromAmountWhenNoIncomeExpense && !hasExplicitIncomeExpense;
  const max = Math.max(Math.abs(ingresos), Math.abs(egresos), Math.abs(balance), 1);
  const clients = topClients(transactions, amountGetter);

  return `
    <div class="db-grid db-grid--3col db-finance-summary">
      ${renderStatCard('Total ingresos', showIncomeExpenseAsNE ? 'NE' : money(ingresos))}
      ${renderStatCard('Total egresos', showIncomeExpenseAsNE ? 'NE' : money(egresos))}
      ${renderStatCard('Balance', money(balance))}
    </div>
    <div class="db-grid db-grid--2col db-finance-dashboard">
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Ingresos vs egresos</span></header>
        <div class="db-card__inner">
          <div class="db-bar-chart">
            <div><span>Ingresos</span><i style="--bar:${showIncomeExpenseAsNE ? 0 : Math.round((ingresos / max) * 100)}%"></i><strong>${showIncomeExpenseAsNE ? 'NE' : money(ingresos)}</strong></div>
            <div><span>Egresos</span><i style="--bar:${showIncomeExpenseAsNE ? 0 : Math.round((egresos / max) * 100)}%"></i><strong>${showIncomeExpenseAsNE ? 'NE' : money(egresos)}</strong></div>
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

function eventAccessFor(event, adminDefault = hasRole('admin')) {
  return {
    can_view: adminDefault || Boolean(event?.can_view),
    can_add_finance: adminDefault || Boolean(event?.can_add_finance),
    can_edit_finance: adminDefault || Boolean(event?.can_edit_finance),
    can_view_scrum: adminDefault || Boolean(event?.can_view_scrum),
    can_edit_scrum: adminDefault || Boolean(event?.can_edit_scrum),
  };
}

const participantLabel = (participant) => {
  if (!participant) return '-';
  const role = participant.role ? ` · ${participant.role}` : '';
  return `${userLabel(participant.user_id)}${role}`;
};

function renderParticipantOptions(participants = [], selectedValue = '', placeholder = 'Seleccionar') {
  return [
    optionHTML('', placeholder, selectedValue),
    ...participants.map((participant) => optionHTML(String(participant.user_id), participantLabel(participant), selectedValue)),
  ].join('');
}

function participantName(userId) {
  if (!userId) return '-';
  const participant = (state.data.eventParticipantsAll ?? []).find((item) => String(item.user_id) === String(userId));
  return participant ? participantLabel(participant) : userLabel(userId);
}

async function fetchFinanceEntities() {
  if (Array.isArray(state.data.financeEntities)) return state.data.financeEntities;

  const { data, error } = await supabase
    .from('finance_entities')
    .select('id, entity_key, name, entity_type, status, notes')
    .eq('status', 'active')
    .order('name', { ascending: true });

  if (error) {
    console.info('[HR] finance entities unavailable:', error.message);
    state.data.financeEntities = [];
    return [];
  }

  state.data.financeEntities = data ?? [];
  return state.data.financeEntities;
}

function financeEntityLabel(entity) {
  if (!entity) return '-';
  const type = entity.entity_type ? ` · ${entity.entity_type}` : '';
  return `${entity.name ?? entity.entity_key ?? 'Entidad'}${type}`;
}

function renderFinanceEntityOptions(entities = [], selectedValue = '', placeholder = 'Sin asignar') {
  return [
    optionHTML('', placeholder, selectedValue),
    ...entities.map((entity) => optionHTML(String(entity.id), financeEntityLabel(entity), selectedValue)),
  ].join('');
}

function financeEntityName(entityId, legacyUserId = null) {
  if (entityId) {
    const entity = (state.data.financeEntities ?? []).find((item) => String(item.id) === String(entityId));
    if (entity) return financeEntityLabel(entity);
  }
  return legacyUserId ? participantName(legacyUserId) : '-';
}

function eventRightsTotals(event, transactions = []) {
  const expenseTransactions = (transactions ?? []).filter((tx) => {
    const amount = Number(tx.amount ?? 0);
    return tx.movement_type === 'expense' || amount < 0;
  });

  const totalCost = expenseTransactions.length
    ? expenseTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.amount ?? 0)), 0)
    : Number(event?.rights_total_cost ?? event?.egresos ?? 0);

  const hiddenRoom = expenseTransactions.length
    ? expenseTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.hidden_room_share ?? 0)), 0)
    : Number(event?.rights_hidden_room_acquired ?? Math.abs(Number(event?.hidden_room_share_total ?? 0)));

  const counterparty = Math.max(totalCost - hiddenRoom, 0);
  const hiddenRoomPercent = totalCost > 0 ? (hiddenRoom / totalCost) * 100 : 0;
  const counterpartyPercent = totalCost > 0 ? (counterparty / totalCost) * 100 : 0;

  return { totalCost, hiddenRoom, counterparty, hiddenRoomPercent, counterpartyPercent };
}

function renderEventRightsChart(event, transactions = []) {
  const totals = eventRightsTotals(event, transactions);
  const hiddenRoomDeg = totals.totalCost > 0 ? Math.max(0, Math.min(360, totals.hiddenRoomPercent * 3.6)) : 0;

  return `
    <div class="db-grid db-grid--2col db-event-rights">
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Derechos Adquiridos</span></header>
        <div class="db-card__inner db-event-rights__inner">
          <div class="db-pie-chart" style="--hr-deg:${hiddenRoomDeg}deg" aria-label="Derechos adquiridos"></div>
          <div class="db-event-rights__legend">
            <span><i class="db-event-rights__swatch db-event-rights__swatch--hr"></i>Hidden Room ${totals.hiddenRoomPercent.toFixed(2)}%</span>
            <span><i class="db-event-rights__swatch db-event-rights__swatch--counterparty"></i>Contraparte ${totals.counterpartyPercent.toFixed(2)}%</span>
          </div>
        </div>
      </article>
      <div class="db-grid db-grid--1col db-finance-summary">
        ${renderStatCard('Costo Total Evento', money(totals.totalCost))}
        ${renderStatCard('Hidden Room Adquirido', money(totals.hiddenRoom))}
        ${renderStatCard('Contraparte Adquirido', money(totals.counterparty))}
      </div>
    </div>
  `;
}

function internalInvestorRows(transactions = [], totalCost = 0) {
  const totals = new Map();

  (transactions ?? [])
    .filter((tx) => tx.movement_type === 'investment_in')
    .forEach((tx) => {
      const investorId = tx.from_user_id ? String(tx.from_user_id) : 'sin_inversor';
      const current = totals.get(investorId) ?? { id: investorId, label: tx.from_user_id ? participantName(tx.from_user_id) : 'Sin inversor asignado', total: 0 };
      current.total += Math.abs(Number(tx.amount ?? 0));
      totals.set(investorId, current);
    });

  return [...totals.values()]
    .map((item) => ({
      ...item,
      percent: Number(totalCost) > 0 ? (item.total / Number(totalCost)) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

function investorPieGradient(investors = []) {
  const colors = ['var(--red)', 'var(--teal)', '#f0ece4', '#9b5cff', '#f4b860', '#55a6ff', '#6ddf8d'];
  if (!investors.length) return 'rgba(240, 236, 228, 0.08) 0 360deg';

  let cursor = 0;
  return investors.map((investor, index) => {
    const start = cursor;
    const end = index === investors.length - 1 ? 360 : cursor + ((investor.percent / 100) * 360);
    cursor = end;
    return `${colors[index % colors.length]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  }).join(', ');
}

function renderEventInternalInvestors(event, transactions = []) {
  const rightsTotals = eventRightsTotals(event, transactions);
  const investors = internalInvestorRows(transactions, rightsTotals.totalCost);
  const total = investors.reduce((sum, investor) => sum + investor.total, 0);
  const colors = ['var(--red)', 'var(--teal)', '#f0ece4', '#9b5cff', '#f4b860', '#55a6ff', '#6ddf8d'];
  const pieGradient = investorPieGradient(investors);
  const legend = investors.length
    ? investors.map((investor, index) => `
      <span><i style="background:${colors[index % colors.length]}"></i>${escapeHTML(investor.label)} ${investor.percent.toFixed(2)}%</span>
    `).join('')
    : '<span><i></i>Sin inversiones internas</span>';

  const rows = investors.length
    ? investors.map((investor) => `
      <tr>
        <td>${escapeHTML(investor.label)}</td>
        <td>${money(investor.total)}</td>
        <td>${investor.percent.toFixed(2)}%</td>
        <td><div class="db-investor-share"><i style="--bar:${Math.max(2, investor.percent)}%"></i></div></td>
      </tr>
    `).join('')
    : '<tr class="db-table__empty-row"><td colspan="4" class="db-empty">Sin inversiones internas registradas.</td></tr>';

  return `
    <article class="db-card db-event-investors">
      <header class="db-card__header"><span class="section-label">Inversores internos sobre costo total</span></header>
      <div class="db-card__inner">
        <div class="db-event-investors__summary">
          <div class="db-pie-chart db-investor-pie" style="background:conic-gradient(${pieGradient})" aria-label="Distribucion de inversion interna"></div>
          <div class="db-event-investors__legend">${legend}</div>
          ${renderStatCard('Inversión interna total', money(total))}
          ${renderStatCard('Costo total del evento', money(rightsTotals.totalCost))}
        </div>
        <div class="db-table-wrap">
          <table class="db-table" aria-label="Porcentaje de inversión sobre costo total por participante">
            <thead>
              <tr>
                <th scope="col">Participante</th>
                <th scope="col">Inversión</th>
                <th scope="col">% costo total</th>
                <th scope="col">Cobertura</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </article>
  `;
}

function renderEventInfo(event) {
  if (!event) return '';
  return `
    <div class="db-grid db-grid--3col">
      ${renderStatCard('Evento', event.name ?? event.event_key ?? '-')}
      ${renderStatCard('Clave', event.event_key ?? '-')}
      ${renderStatCard('Fecha / status', `${formatDisplayDateOnly(event.event_date)} · ${event.status ?? '-'}`)}
    </div>
  `;
}

function renderEventSummaryCards(event) {
  const metrics = [
    ['Ingresos', event?.ingresos],
    ['Egresos', event?.egresos],
    ['Inversión ingresada', event?.inversion_ingresada],
    ['Utilidad devuelta', event?.utilidad_devuelta],
    ['Entregas a favor', event?.entregas_a_favor],
    ['M.A.I.', event?.mai],
    ['M.A.I. acumulado', event?.hidden_room_share_total],
    ['Balance evento', event?.balance_evento],
  ];

  return `
    <div class="db-grid db-grid--4col db-finance-summary">
      ${metrics.map(([label, value]) => renderStatCard(label, money(value ?? 0))).join('')}
    </div>
  `;
}

function eventSummaryFor(event, transactions = []) {
  const hasViewSummary = [
    'ingresos',
    'egresos',
    'inversion_ingresada',
    'utilidad_devuelta',
    'entregas_a_favor',
    'mai',
    'hidden_room_share_total',
    'balance_evento',
  ].some((key) => event?.[key] !== undefined && event?.[key] !== null);

  if (hasViewSummary) return event;

  const amountByType = (type) => transactions
    .filter((tx) => tx.movement_type === type)
    .reduce((sum, tx) => sum + Number(tx.amount ?? 0), 0);
  const hiddenRoomShareTotal = transactions.reduce((sum, tx) => sum + Number(tx.hidden_room_share ?? eventFinanceAmount(tx) ?? 0), 0);
  const amountTotal = transactions.reduce((sum, tx) => sum + Number(tx.amount ?? 0), 0);

  return {
    ...(event ?? {}),
    ingresos: amountByType('income'),
    egresos: Math.abs(amountByType('expense')),
    inversion_ingresada: amountByType('investment_in'),
    utilidad_devuelta: Math.abs(amountByType('investment_return')),
    entregas_a_favor: amountByType('counterparty_transfer'),
    mai: hiddenRoomShareTotal,
    hidden_room_share_total: hiddenRoomShareTotal,
    balance_evento: amountTotal + hiddenRoomShareTotal,
  };
}

function renderEventMovementForm(event, formName, participants = [], financeEntities = []) {
  const today = todayDateInputValue();
  return `
    <article class="db-card">
      <header class="db-card__header"><span class="section-label">Nuevo movimiento</span></header>
      <div class="db-card__inner">
        <form class="db-form" data-form="${escapeAttr(formName)}">
          <input type="hidden" name="event_id" value="${escapeAttr(event?.id ?? event?.event_id ?? '')}" />
          <input type="hidden" name="event_key" value="${escapeAttr(event?.event_key ?? '')}" />
          <label class="db-field"><span>Event</span><input value="${escapeAttr(eventLabel(event ?? {}))}" readonly /></label>
          <div class="db-form__row">
            <label class="db-field"><span>Movement Type</span><select name="movement_type" required>${EVENT_MOVEMENT_TYPES.map((item) => optionHTML(item.value, item.label, '')).join('')}</select></label>
            <label class="db-field"><span>Amount</span><input name="amount" type="number" step="0.01" required /></label>
          </div>
          <label class="db-field"><span>Concept</span><input name="concept" required /></label>
          <div class="db-form__row">
            <label class="db-field"><span>FROM</span><select name="from_user_id">${renderParticipantOptions(participants, '', 'Sin origen')}</select></label>
            <label class="db-field"><span>TO</span><select name="to_user_id">${renderParticipantOptions(participants, '', 'Sin destino')}</select></label>
          </div>
          <label class="db-field"><span>CORRESPONDE A</span><select name="owner_entity_id">${renderFinanceEntityOptions(financeEntities, '', 'Sin asignar')}</select></label>
          <div class="db-form__row">
            <label class="db-field"><span>Monto Absorbido Internamente (M.A.I.)</span><input name="hidden_room_share" type="number" step="0.01" value="0" /></label>
            <label class="db-field"><span>Payment Method</span><input name="payment_method" /></label>
          </div>
          <label class="db-field"><span>Date</span><input name="movement_date" type="date" value="${escapeAttr(today)}" required /></label>
          <label class="db-field"><span>Notes</span><textarea name="notes" rows="3"></textarea></label>
          <button class="btn-primary" type="submit">Guardar movimiento</button>
        </form>
      </div>
    </article>
  `;
}

function renderEventMovementOpsForm(events = [], participants = [], financeEntities = []) {
  const today = todayDateInputValue();
  const availableEvents = events.filter((event) => event.id || event.event_id);

  if (!availableEvents.length) {
    return '<p class="db-empty">Sin eventos disponibles para capturar movimientos.</p>';
  }

  return `
    <form class="db-form" data-form="admin-event-movement-create">
      <label class="db-field">
        <span>Evento</span>
        <select name="event_id" required>
          ${availableEvents.map((event) => optionHTML(String(event.id ?? event.event_id), eventLabel(event), '')).join('')}
        </select>
      </label>
      <div class="db-form__row">
        <label class="db-field"><span>Movement Type</span><select name="movement_type" required>${EVENT_MOVEMENT_TYPES.map((item) => optionHTML(item.value, item.label, '')).join('')}</select></label>
        <label class="db-field"><span>Amount</span><input name="amount" type="number" step="0.01" required /></label>
      </div>
      <label class="db-field"><span>Concept</span><input name="concept" required /></label>
      <div class="db-form__row">
        <label class="db-field"><span>FROM</span><select name="from_user_id">${renderParticipantOptions(participants, '', 'Sin origen')}</select></label>
        <label class="db-field"><span>TO</span><select name="to_user_id">${renderParticipantOptions(participants, '', 'Sin destino')}</select></label>
      </div>
      <label class="db-field"><span>CORRESPONDE A</span><select name="owner_entity_id">${renderFinanceEntityOptions(financeEntities, '', 'Sin asignar')}</select></label>
      <div class="db-form__row">
        <label class="db-field"><span>Monto Absorbido Internamente (M.A.I.)</span><input name="hidden_room_share" type="number" step="0.01" value="0" /></label>
        <label class="db-field"><span>Payment Method</span><input name="payment_method" /></label>
      </div>
      <label class="db-field"><span>Date</span><input name="movement_date" type="date" value="${escapeAttr(today)}" required /></label>
      <label class="db-field"><span>Notes</span><textarea name="notes" rows="3"></textarea></label>
      <button class="btn-primary" type="submit">Guardar movimiento</button>
    </form>
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
        <td>${escapeHTML(formatDisplayDateOnly(tx.date))}</td>
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

function renderEventFinanceTransactionsTable(transactions, options = {}) {
  const tableId = `event-transactions-${state.activeSection}`;
  const activeSort = getTableSort(tableId, 'movement_date', 'desc');
  const sortedTransactions = sortRowsByColumn(transactions, activeSort.field, activeSort.direction);
  const headers = [
    ['concept', 'Concepto'],
    ['movement_type', 'Tipo'],
    ['amount', 'Monto'],
    ['hidden_room_share', 'M.A.I.'],
    ['from_user_id', 'FROM'],
    ['to_user_id', 'TO'],
    ['owner_entity_id', 'Corresponde a'],
    ['movement_date', 'Fecha'],
    ['payment_method', 'Metodo'],
    ['created_by_user_id', 'Creado por'],
    ['notes', 'Notas'],
  ];
  const rows = sortedTransactions.length
    ? sortedTransactions.map((tx) => `
      <tr>
        <td>${escapeHTML(tx.concept ?? '-')}</td>
        <td>${escapeHTML(movementTypeLabel(tx.movement_type) || tx.type || '-')}</td>
        <td>${money(Number(tx.amount ?? 0))}</td>
        <td>${money(Number(tx.hidden_room_share ?? eventFinanceAmount(tx) ?? 0))}</td>
        <td>${escapeHTML(participantName(tx.from_user_id))}</td>
        <td>${escapeHTML(participantName(tx.to_user_id))}</td>
        <td>${escapeHTML(financeEntityName(tx.owner_entity_id, tx.owner_user_id))}</td>
        <td>${escapeHTML(formatDisplayDateOnly(tx.movement_date ?? tx.date))}</td>
        <td>${escapeHTML(tx.payment_method ?? tx.via ?? '-')}</td>
        <td>${escapeHTML(tx.created_by_user_id ?? '-')}</td>
        <td>${escapeHTML(tx.notes ?? '-')}</td>
        ${options.canEdit ? `<td><button class="db-btn-secondary" type="button" data-action="event-movement-edit" data-event-movement="${escapeAttr(encodeURIComponent(JSON.stringify(tx)))}">Editar</button></td>` : ''}
      </tr>
    `).join('')
    : `<tr class="db-table__empty-row"><td colspan="${headers.length + (options.canEdit ? 1 : 0)}" class="db-empty">Sin transacciones en el periodo.</td></tr>`;

  return `
    <div class="db-table-wrap">
      <table class="db-table" aria-label="Desglose financiero de eventos">
        <thead><tr>
          ${headers.map(([field, label]) => renderSortableHeader(tableId, field, label, activeSort)).join('')}
          ${options.canEdit ? '<th scope="col">Acciones</th>' : ''}
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

  const [
    { data: users, error: usersError },
    { data: permissions, error: permissionsError },
    { data: events, error: eventsError },
    { data: eventPermissions, error: eventPermissionsError },
  ] = await Promise.all([
    supabase
      .from('users')
      .select('id, user_id, display_name, username, email, roles')
      .order('display_name', { ascending: true }),
    supabase
      .from('user_permissions')
      .select('id, user_id, permission_key')
      .order('permission_key', { ascending: true }),
    supabase
      .from('events')
      .select('id, event_key, name, event_date, status')
      .order('event_date', { ascending: false }),
    supabase
      .from('event_user_permissions')
      .select('id, event_id, user_id, can_view, can_add_finance, can_edit_finance, can_view_scrum, can_edit_scrum'),
  ]);

  if (usersError || permissionsError || eventsError || eventPermissionsError) {
    const error = usersError || permissionsError || eventsError || eventPermissionsError;
    console.error('[HR] renderErpPermissions:', error);
    if (isSessionStaleError(error)) markSessionStale(error.message || 'permissions fetch');
    return sectionShell('ERP', 'Permisos', 'title-erp-permissions', `
      <p class="db-empty db-empty--error">Error al cargar usuarios y permisos.</p>
    `);
  }

  state.data.permissionUsers = users ?? [];
  state.data.userPermissions = permissions ?? [];
  state.data.permissionEvents = events ?? [];
  state.data.eventUserPermissions = eventPermissions ?? [];

  const suspiciousAdminEmpty = hasRole('admin') && (users ?? []).length === 0;
  if (suspiciousAdminEmpty) markSessionStale('erp permissions users returned 0 rows');

  const rows = (users ?? []).length
    ? users.map(renderPermissionUserRow).join('')
    : `<tr class="db-table__empty-row"><td colspan="6" class="db-empty">${suspiciousAdminEmpty ? 'No se pudieron validar tus permisos. Actualiza sesión.' : 'Sin usuarios registrados.'}</td></tr>`;
  const permissionSearch = tableSearchFor('js-permissions-table-body');

  return sectionShell('ERP', 'Permisos', 'title-erp-permissions', `
    <div class="db-toolbar">
      <label class="db-field db-field--compact db-field--search">
        <span>Buscar</span>
        <input data-table-search data-table-target="js-permissions-table-body" data-table-count="js-permissions-table-count" placeholder="Buscar por nombre, usuario, rol o permiso" value="${escapeAttr(permissionSearch)}" />
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

async function renderErpAuthAudit() {
  if (!hasRole('admin')) {
    return sectionShell('ERP', 'Auth / Registros', 'title-erp-auth-audit', `
      <p class="db-empty db-empty--error">Acceso no autorizado.</p>
    `);
  }

  let audit;
  try {
    const { data, error } = await supabase.functions.invoke('admin-auth-audit', {
      body: { limit: 25 },
    });

    if (error || data?.success === false) {
      throw error || new Error(data?.error || 'No se pudo cargar Auth.');
    }

    audit = data;
  } catch (err) {
    console.error('[HR] renderErpAuthAudit:', err);
    return sectionShell('ERP', 'Auth / Registros', 'title-erp-auth-audit', `
      <p class="db-empty db-empty--error">No se pudo cargar la auditoría de Auth. Revisa que la Edge Function admin-auth-audit esté desplegada.</p>
    `);
  }

  const totals = audit?.totals ?? {};
  const generatedAt = audit?.generated_at ? formatDateTime(audit.generated_at) : '-';
  const alerts =
    Number(totals.auth_without_public_profile ?? 0)
    + Number(totals.public_profiles_without_auth ?? 0)
    + Number(totals.duplicate_emails ?? 0)
    + Number(totals.duplicate_user_ids ?? 0);

  return sectionShell('ERP', 'Auth / Registros', 'title-erp-auth-audit', `
    ${renderAuthAuditFilterBar(persistedDataValue('authAuditFilter', 'all'))}
    <div class="db-grid db-grid--3col">
      ${renderStatCard('Auth users', String(totals.auth_users ?? 0))}
      ${renderStatCard('Perfiles public.users', String(totals.public_profiles ?? 0))}
      ${renderStatCard('Alertas de fusión', String(alerts))}
    </div>
    <p class="db-empty">Generado: ${escapeHTML(generatedAt)}</p>
    ${renderAuthUsersTable('Últimos usuarios logueados', audit?.recent_logins ?? [], 'last_sign_in_at', ['auth'], 'js-auth-logins')}
    ${renderAuthUsersTable('Últimos usuarios creados en Auth', audit?.recent_created ?? [], 'created_at', ['auth'], 'js-auth-created')}
    ${renderAuthUsersTable('Auth sin perfil public.users', audit?.possible_merges?.auth_without_public_profile ?? [], 'created_at', ['auth', 'alerts', 'missing-profile'], 'js-auth-missing-profile')}
    ${renderPublicProfilesTable('public.users sin Auth', audit?.possible_merges?.public_profiles_without_auth ?? [], ['public', 'alerts'], 'js-public-without-auth')}
    ${renderDuplicateEmailAudit(audit?.possible_merges?.duplicate_emails ?? [], ['alerts'], 'js-duplicate-emails')}
    ${renderDuplicateUserIdAudit(audit?.possible_merges?.duplicate_user_ids ?? [], ['alerts'], 'js-duplicate-user-ids')}
  `);
}

function renderAuthAuditFilterBar(activeFilter = 'all') {
  return `
    <div class="db-toolbar">
      <label class="db-field db-field--compact">
        <span>Filtro</span>
        <select data-action="auth-audit-filter" aria-label="Filtrar auditoría de Auth">
          ${[
            ['all', 'Todos'],
            ['auth', 'Auth users'],
            ['public', 'Perfiles public.users'],
            ['alerts', 'Alertas de fusión'],
            ['missing-profile', 'Sin perfil'],
          ].map(([value, label]) => optionHTML(value, label, activeFilter)).join('')}
        </select>
      </label>
    </div>
  `;
}

function authAuditBlockAttrs(groups = []) {
  const groupText = groups.join(' ');
  const activeFilter = persistedDataValue('authAuditFilter', 'all');
  const hidden = activeFilter !== 'all' && !groups.includes(activeFilter);
  return `data-auth-audit-groups="${escapeAttr(groupText)}"${hidden ? ' hidden' : ''}`;
}

function renderAuditTableSearch(tableId, rowCount, label = 'Buscar') {
  const searchQuery = tableSearchFor(tableId);
  return `
    <label class="db-field db-field--compact db-field--search">
      <span>${escapeHTML(label)}</span>
      <input data-table-search data-table-target="${escapeAttr(tableId)}" data-table-count="${escapeAttr(`${tableId}-count`)}" placeholder="Buscar por email, User ID, perfil o estado" value="${escapeAttr(searchQuery)}" />
      <small id="${escapeAttr(`${tableId}-count`)}" class="db-field__hint">${rowCount} filas visibles</small>
    </label>
  `;
}

function renderAuthUsersTable(title, users = [], dateField = 'created_at', groups = ['auth'], tableId = 'js-auth-users') {
  const rows = users.length
    ? users.map((user) => {
      const profile = user.profile ?? {};
      const searchText = [
        user?.[dateField],
        user.email,
        user.id,
        profile.user_id,
        profile.display_name,
        profile.username,
        user.needs_profile_merge ? 'Sin perfil' : 'OK',
      ].filter(Boolean).join(' ');
      return `
        <tr data-search-row data-search-text="${escapeAttr(searchText)}">
          <td>${escapeHTML(formatDateTime(user?.[dateField]))}</td>
          <td>${escapeHTML(user.email ?? '-')}</td>
          <td><code>${escapeHTML(user.id ?? '-')}</code></td>
          <td>${escapeHTML(profile.user_id ?? '-')}</td>
          <td>${escapeHTML(profile.display_name ?? profile.username ?? '-')}</td>
          <td>${user.needs_profile_merge ? '<span class="db-auth-audit__flag">Sin perfil</span>' : '<span class="db-auth-audit__ok">OK</span>'}</td>
        </tr>
      `;
    }).join('')
    : '<tr class="db-table__empty-row"><td colspan="6" class="db-empty">Sin registros.</td></tr>';

  return `
    <article class="db-auth-audit-block" ${authAuditBlockAttrs(groups)}>
      <h2 class="db-auth-audit-block__title">${escapeHTML(title)}</h2>
      ${renderAuditTableSearch(tableId, users.length)}
      <div class="db-table-wrap">
        <table class="db-table" aria-label="${escapeAttr(title)}">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Email Auth</th>
              <th scope="col">Auth ID</th>
              <th scope="col">User ID</th>
              <th scope="col">Perfil</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody id="${escapeAttr(tableId)}">${rows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function renderPublicProfilesTable(title, profiles = [], groups = ['public'], tableId = 'js-public-profiles') {
  const rows = profiles.length
    ? profiles.map((profile) => {
      const searchText = [
        profile.email,
        profile.id,
        profile.user_id,
        profile.display_name,
        profile.username,
        profile.roles,
      ].filter(Boolean).join(' ');
      return `
        <tr data-search-row data-search-text="${escapeAttr(searchText)}">
          <td>${escapeHTML(profile.email ?? '-')}</td>
          <td><code>${escapeHTML(profile.id ?? '-')}</code></td>
          <td>${escapeHTML(profile.user_id ?? '-')}</td>
          <td>${escapeHTML(profile.display_name ?? profile.username ?? '-')}</td>
          <td>${escapeHTML(profile.roles ?? '-')}</td>
        </tr>
      `;
    }).join('')
    : '<tr class="db-table__empty-row"><td colspan="5" class="db-empty">Sin registros.</td></tr>';

  return `
    <article class="db-auth-audit-block" ${authAuditBlockAttrs(groups)}>
      <h2 class="db-auth-audit-block__title">${escapeHTML(title)}</h2>
      ${renderAuditTableSearch(tableId, profiles.length)}
      <div class="db-table-wrap">
        <table class="db-table" aria-label="${escapeAttr(title)}">
          <thead>
            <tr>
              <th scope="col">Email public.users</th>
              <th scope="col">Public ID</th>
              <th scope="col">User ID</th>
              <th scope="col">Perfil</th>
              <th scope="col">Rol</th>
            </tr>
          </thead>
          <tbody id="${escapeAttr(tableId)}">${rows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function renderDuplicateEmailAudit(emailGroups = [], groups = ['alerts'], tableId = 'js-duplicate-emails') {
  const rows = emailGroups.length
    ? emailGroups.map((group) => {
      const possibleProfiles = (group.public_profiles ?? []).map((profile) => profile.user_id || profile.display_name || profile.id).join(', ') || '-';
      const searchText = [
        group.email,
        possibleProfiles,
        ...(group.auth_users ?? []).map((user) => user.email || user.id),
      ].filter(Boolean).join(' ');
      return `
        <tr data-search-row data-search-text="${escapeAttr(searchText)}">
          <td>${escapeHTML(group.email ?? '-')}</td>
          <td>${escapeHTML(String(group.auth_users?.length ?? 0))}</td>
          <td>${escapeHTML(String(group.public_profiles?.length ?? 0))}</td>
          <td>${escapeHTML(possibleProfiles)}</td>
        </tr>
      `;
    }).join('')
    : '<tr class="db-table__empty-row"><td colspan="4" class="db-empty">Sin emails duplicados.</td></tr>';

  return `
    <article class="db-auth-audit-block" ${authAuditBlockAttrs(groups)}>
      <h2 class="db-auth-audit-block__title">Emails duplicados</h2>
      ${renderAuditTableSearch(tableId, emailGroups.length)}
      <div class="db-table-wrap">
        <table class="db-table" aria-label="Emails duplicados">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Auth</th>
              <th scope="col">public.users</th>
              <th scope="col">Perfiles posibles</th>
            </tr>
          </thead>
          <tbody id="${escapeAttr(tableId)}">${rows}</tbody>
        </table>
      </div>
    </article>
  `;
}

function renderDuplicateUserIdAudit(userIdGroups = [], groups = ['alerts'], tableId = 'js-duplicate-user-ids') {
  const rows = userIdGroups.length
    ? userIdGroups.map((group) => {
      const possibleEmails = (group.public_profiles ?? []).map((profile) => profile.email || profile.display_name || profile.id).join(', ') || '-';
      const searchText = [
        group.user_id,
        possibleEmails,
      ].filter(Boolean).join(' ');
      return `
        <tr data-search-row data-search-text="${escapeAttr(searchText)}">
          <td>${escapeHTML(group.user_id ?? '-')}</td>
          <td>${escapeHTML(String(group.public_profiles?.length ?? 0))}</td>
          <td>${escapeHTML(possibleEmails)}</td>
        </tr>
      `;
    }).join('')
    : '<tr class="db-table__empty-row"><td colspan="3" class="db-empty">Sin User ID duplicados.</td></tr>';

  return `
    <article class="db-auth-audit-block" ${authAuditBlockAttrs(groups)}>
      <h2 class="db-auth-audit-block__title">User ID duplicados</h2>
      ${renderAuditTableSearch(tableId, userIdGroups.length)}
      <div class="db-table-wrap">
        <table class="db-table" aria-label="User ID duplicados">
          <thead>
            <tr>
              <th scope="col">User ID</th>
              <th scope="col">Perfiles</th>
              <th scope="col">Emails posibles</th>
            </tr>
          </thead>
          <tbody id="${escapeAttr(tableId)}">${rows}</tbody>
        </table>
      </div>
    </article>
  `;
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

  const tableName = state.data.adminTableName || setAdminTableName(readStoredAdminTableName());
  const config = TABLE_EDITOR_CONFIG[tableName] || TABLE_EDITOR_CONFIG.users;
  let data = [];

  try {
    data = tableName === 'membership_dashboard'
      ? await fetchComputedMembershipDashboardRows()
      : await fetchAllTableEditorRows(tableName, config.select, config.defaultSort);
  } catch (error) {
    console.error('[HR] renderAdminTableEditor:', error);
    if (isSessionStaleError(error)) markSessionStale(error.message || 'admin table fetch');
    return sectionShell('ERP', 'BB.DD', 'title-admin-table-editor', `
      <p class="db-empty db-empty--error">No se pudo cargar ${escapeHTML(config.label)}. Revisa RLS/permisos.</p>
    `);
  }

  state.data.adminTableRows = data ?? [];

  const columns = [...config.lockedFields, ...config.editableFields]
    .filter((field, index, arr) => arr.indexOf(field) === index);
  const visibleColumns = columns.filter((field) => !(config.hiddenColumns ?? []).includes(field));
  const tableId = `admin-${tableName}`;
  const defaultSort = config.defaultSort ?? { field: '', direction: 'asc' };
  const activeSort = getTableSort(tableId, defaultSort.field, defaultSort.direction);
  const sortField = visibleColumns.includes(activeSort.field) ? activeSort.field : '';
  const sortedData = sortRowsByColumn(data ?? [], sortField, activeSort.direction);
  const searchQuery = adminTableSearchFor(tableName);
  const visibleData = sortedData.filter((row) => rowMatchesSearch(row, columns, searchQuery));
  const membershipDashboardContext = tableName === 'membership_dashboard'
    ? renderAdminMembershipDashboardContext(visibleData, searchQuery)
    : '';
  const isMembershipDashboard = tableName === 'membership_dashboard';
  const membershipDashboardHasUser = isMembershipDashboard && Boolean(searchQuery);
  const searchControl = isMembershipDashboard
    ? renderMembershipDashboardUserPicker(searchQuery)
    : `
      <label class="db-field db-field--compact db-field--search">
        <span>Buscar</span>
        <input data-table-search data-admin-table-name="${escapeAttr(tableName)}" data-table-target="js-admin-table-body" data-table-count="js-admin-table-count" placeholder="Buscar por nombre, email, user_id..." value="${escapeAttr(searchQuery)}" />
        <small id="js-admin-table-count" class="db-field__hint">${searchQuery ? `${visibleData.length} resultado${visibleData.length === 1 ? '' : 's'}` : `${visibleData.length} filas visibles`}</small>
      </label>
    `;

  const suspiciousAdminEmpty = hasRole('admin') && tableName === 'users' && !searchQuery && (data ?? []).length === 0;
  if (suspiciousAdminEmpty) markSessionStale('admin users table returned 0 rows');

  const rows = sortedData.length
    ? sortedData.map((row, index) => renderAdminTableEditorRow(tableName, config, row, index, {
      hidden: Boolean(searchQuery) && !rowMatchesSearch(row, columns, searchQuery),
    })).join('')
    : `<tr class="db-table__empty-row"><td colspan="99" class="db-empty">${suspiciousAdminEmpty ? 'No se pudieron validar tus permisos. Actualiza sesión.' : 'Sin filas disponibles.'}</td></tr>`;
  const membershipDashboardTable = isMembershipDashboard
    ? renderMembershipDashboardTable(visibleData, { canEditMaterialDelivery: true })
    : '';

  return sectionShell('ERP', 'BB.DD', 'title-admin-table-editor', `
    <div class="db-toolbar">
      <label class="db-field db-field--compact">
        <span>Tabla</span>
        <select data-action="table-editor-table" aria-label="Seleccionar tabla">
          ${Object.entries(TABLE_EDITOR_CONFIG).filter(([, item]) => !item.hidden).map(([key, item]) => optionHTML(key, item.label, tableName)).join('')}
        </select>
      </label>
      ${searchControl}
      ${config.readOnly && !isMembershipDashboard ? '' : '<button class="db-btn-secondary" type="button" data-action="admin-table-save-all">GUARDAR</button>'}
      ${isMembershipDashboard ? '' : `<button class="db-btn-secondary" type="button" data-action="export-admin-pdf" data-table-label="${escapeAttr(config.label)}">Exportar PDF</button>`}
    </div>
    ${tableName === 'users' ? '<p class="db-empty">El campo email se guarda a través de Auth (Edge Function). El cambio se aplica al confirmar el correo.</p>' : ''}
    ${membershipDashboardContext}
    ${isMembershipDashboard && !membershipDashboardHasUser ? '<p class="db-empty">Selecciona un usuario para consultar su dashboard de membresía.</p>' : `
    ${isMembershipDashboard ? membershipDashboardTable : `
    <div class="db-table-wrap">
      <table class="db-table db-table--editor" aria-label="Editor de ${escapeAttr(config.label)}">
        <thead>
          <tr>
            ${visibleColumns.map((field) => renderSortableHeader(tableId, field, adminFieldLabel(config, field), activeSort)).join('')}
            ${config.readOnly ? '' : '<th scope="col">Acciones</th>'}
          </tr>
        </thead>
        <tbody id="js-admin-table-body">${rows}</tbody>
      </table>
    </div>
    `}
    ${isMembershipDashboard ? renderMembershipSyncFooter() : ''}
    `}
  `);
}

function renderAdminMembershipDashboardContext(rows = [], searchQuery = '') {
  if (!searchQuery || !rows.length) return '';

  const users = new Set(rows.map((row) => String(row.user_id ?? '')).filter(Boolean));
  if (users.size !== 1) {
    return `<p class="db-empty">Filtra hasta un solo usuario para ver los avisos de su membresía.</p>`;
  }

  return `
    ${renderMembershipNotices(rows)}
    ${renderMembershipSummary(rows)}
  `;
}

function renderMembershipDashboardUserPicker(selectedUserId = '') {
  const users = state.data.users?.length
    ? state.data.users
    : uniqueUsers(state.data.membershipDashboardUsers ?? []);

  const previousUsers = state.data.users;
  state.data.users = users;
  const picker = renderUserPicker('membership_user_id', 'Buscar usuario', selectedUserId, {
    placeholder: 'Buscar usuario',
    emptyLabel: 'Sin usuarios encontrados.',
  }).replace('class="db-field db-user-picker"', 'class="db-field db-field--compact db-field--search db-user-picker" data-membership-user-picker="true"');
  state.data.users = previousUsers;

  return picker;
}

function renderAdminTableEditorRow(tableName, config, row, index, options = {}) {
  const columns = [...config.lockedFields, ...config.editableFields]
    .filter((field, fieldIndex, arr) => arr.indexOf(field) === fieldIndex);
  const visibleColumns = columns.filter((field) => !(config.hiddenColumns ?? []).includes(field));

  const original = encodeURIComponent(JSON.stringify(row));
  const searchText = columns
    .map((field) => row[field])
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();

  const rowClass = tableName === 'membership_dashboard'
    ? ` class="db-membership-row db-membership-row--${escapeAttr(membershipRowTone(row))}"`
    : '';

  return `
    <tr${rowClass} data-search-row data-search-text="${escapeAttr(searchText)}"${options.hidden ? ' hidden' : ''}>
      ${visibleColumns.map((field) => {
        const value = adminTableCellValue(tableName, field, row);
        const isEditable = config.editableFields.includes(field);
        const cellToneClass = tableName === 'membership_dashboard' ? membershipCellClass(field, row) : '';
        if (config.lockedFields.includes(field) && !isEditable) {
          return `<td class="db-table-cell--readonly${escapeAttr(cellToneClass)}"><code class="${field === 'temp_password' ? 'db-readonly-secret' : ''}">${escapeHTML(String(value))}</code></td>`;
        }

        return `
          <td class="db-table-cell--editable${escapeAttr(cellToneClass)}">
            <input
              class="db-table-input"
              form="admin-table-form-${index}"
              name="${escapeAttr(field)}"
              value="${escapeAttr(value)}"
            />
          </td>
        `;
      }).join('')}
      ${config.readOnly ? '' : `
      <td class="db-table-cell--actions">
        <form class="db-inline-form" id="admin-table-form-${index}" data-form="admin-table-update">
          <input type="hidden" name="table_name" value="${escapeAttr(tableName)}" />
          <input type="hidden" name="original" value="${escapeAttr(original)}" />
          <button class="db-btn-secondary" type="submit">Guardar</button>
        </form>
        <button class="db-btn-danger" type="button" data-action="admin-table-delete" data-table-name="${escapeAttr(tableName)}" data-row-original="${escapeAttr(original)}">Eliminar</button>
        ${tableName === 'users' && row.temp_password ? `<button class="db-btn-secondary" type="button" data-action="share-login" data-user-row="${escapeAttr(original)}">Compartir</button>` : ''}
      </td>
      `}
    </tr>
  `;
}

function adminTableCellValue(tableName, field, row) {
  if (tableName === 'membership_dashboard') {
    if (field === 'saldo') return formatMembershipRowBalance(row);
    if (field === 'fecha_esperada' || field === 'fecha_de_sesion' || field === 'fecha_de_saldo') return formatDisplayDateOnly(row[field]);
    if (field === 'sesiones_usadas') return formatMembershipSessionDates(row) || '-';
    if (field === 'periodo') return row.periodo || '-';
  }

  return row[field] ?? '';
}

function membershipRowTone(row) {
  const saldo = Number(row?.saldo ?? 0);
  if (row?.saldo_tipo === 'pendiente') return 'neutral';
  if (saldo < 0 || (row?.estado === 'ATRASADO' && !row?.fecha_de_saldo)) return 'debt';
  if (saldo > 0) return 'credit';
  return 'neutral';
}

function membershipFieldTone(field, row) {
  const value = String(row?.[field] ?? '').toUpperCase();
  if (field === 'estado') {
    if (value === 'ATRASADO') return 'danger';
    if (value === 'ADELANTADO' || value === 'CORRIENTE') return 'success';
    if (value === 'PENDIENTE') return 'warning';
  }
  if (field === 'estado_operativo') {
    if (value === 'ACTIVE') return 'success';
    if (value === 'PAUSED') return 'warning';
    if (value === 'CANCELLED' || value === 'EXPIRED') return 'danger';
  }
  if (field === 'saldo') {
    const saldo = Number(row?.saldo ?? 0);
    if (row?.saldo_tipo === 'pendiente') return 'warning';
    if (saldo < 0) return 'danger';
    if (saldo > 0) return 'success';
  }
  return 'neutral';
}

function membershipCellClass(field, row) {
  const tone = membershipFieldTone(field, row);
  return tone === 'neutral' ? '' : ` db-membership-cell--${tone}`;
}

function renderMembershipDashboardTable(rows = [], options = {}) {
  const deliveryByWeek = membershipDeliveryByWeek(rows);
  const body = rows.length
    ? rows.map((row) => renderMembershipDashboardRow(row, deliveryByWeek.get(Number(row.semana ?? 0)), options)).join('')
    : `
      <tr class="db-table__empty-row">
        <td colspan="8" class="db-empty">Sin datos de membresía.</td>
      </tr>
    `;

  return `
    <div class="db-table-wrap db-table-wrap--membership">
      <table class="db-table" aria-label="Membresía">
        <thead>
          <tr>
            <th scope="col">Semana</th>
            <th scope="col">Fecha de sesión</th>
            <th scope="col">Estado</th>
            <th scope="col">Saldo</th>
            <th scope="col">Fecha de saldo</th>
            <th scope="col">Entrega programada</th>
            <th scope="col">Fecha de entrega</th>
            <th scope="col">Notas</th>
          </tr>
        </thead>
        <tbody id="js-admin-table-body">${body}</tbody>
      </table>
    </div>
  `;
}

function formatMembershipSessionDates(row) {
  if (Array.isArray(row?.sesiones_usadas_lista) && row.sesiones_usadas_lista.length) {
    return formatDisplayDateList(row.sesiones_usadas_lista);
  }

  return formatDisplayDateList(
    String(row?.sesiones_usadas ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function renderMembershipDashboardRow(row, delivery = null, options = {}) {
  const sessionDates = formatMembershipSessionDates(row);
  const displayNotes = row.notas && row.notas !== '-' ? row.notas : '-';
  const deliveryFormId = membershipDeliveryFormId(row);
  const sessionNotesFormId = membershipSessionNotesFormId(row);
  const cycleNumber = Math.floor((Number(row.semana ?? 1) - 1) / 4) + 1;
  const deliveredAtText = delivery?.deliveredAt
    ? formatDisplayDateOnly(delivery.deliveredAt)
    : 'No entregado';

  return `
    <tr class="db-membership-row db-membership-row--${escapeAttr(membershipRowTone(row))}">
      <td>${escapeHTML(String(row.semana ?? '-'))}</td>
      <td>${escapeHTML(sessionDates || 'Sin sesión registrada')}</td>
      <td class="${escapeAttr(membershipCellClass('estado', row).trim())}">${escapeHTML(row.estado ?? '-')}</td>
      <td class="${escapeAttr(membershipCellClass('saldo', row).trim())}">${formatMembershipRowBalance(row)}</td>
      <td>${escapeHTML(formatDisplayDateOnly(row.fecha_de_saldo))}</td>
      <td>${escapeHTML(formatDisplayDateOnly(delivery?.estimatedDelivery))}</td>
      <td>${options.canEditMaterialDelivery ? renderMembershipDeliveryDateInput(row, delivery, deliveryFormId, cycleNumber, deliveredAtText) : escapeHTML(deliveredAtText)}</td>
      <td>${options.canEditMaterialDelivery ? renderMembershipSessionNotesInput(row, sessionNotesFormId) : escapeHTML(displayNotes || '-')}</td>
    </tr>
  `;
}

function membershipDeliveryFormId(row) {
  return [
    'membership-delivery',
    row.membership_id ?? 'legacy',
    row.user_id ?? 'user',
    row.semana ?? '0',
  ]
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, '-'))
    .join('-');
}

function membershipSessionNotesFormId(row) {
  return [
    'membership-session-notes',
    row.session_id ?? 'none',
    row.membership_id ?? 'legacy',
    row.semana ?? '0',
  ]
    .map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, '-'))
    .join('-');
}

function renderMembershipDeliveryDateInput(row, delivery, formId, cycleNumber, deliveredAtText) {
  const isDelivered = Boolean(delivery?.deliveredAt);
  return `
    <form class="db-membership-delivery-form" id="${formId}" data-form="membership-delivery" data-stay-section="admin-table-editor">
      <input type="hidden" name="membership_id" value="${escapeAttr(row.membership_id ?? '')}" />
      <input type="hidden" name="user_id" value="${escapeAttr(row.user_id ?? '')}" />
      <input type="hidden" name="cycle_number" value="${escapeAttr(String(cycleNumber))}" />
      <input type="hidden" name="delivered_at_original" value="${escapeAttr(delivery?.deliveredAt ?? '')}" />
      <span class="db-membership-delivery-status db-membership-delivery-status--${isDelivered ? 'done' : 'pending'}">${escapeHTML(deliveredAtText)}</span>
      <input class="db-table-input db-table-input--compact db-membership-editable-cell" name="delivered_at" type="date" value="${escapeAttr(delivery?.deliveredAt ?? '')}" aria-label="Fecha real de entrega" />
    </form>
  `;
}

function renderMembershipSessionNotesInput(row, formId) {
  const sessionId = row.session_id ? String(row.session_id) : '';
  const notes = row.session_notes ?? '';
  if (!sessionId) return '-';

  return `
    <div class="db-membership-delivery-edit">
      <form id="${formId}" data-form="membership-session-notes" data-stay-section="admin-table-editor">
        <input type="hidden" name="session_id" value="${escapeAttr(sessionId)}" />
        <input type="hidden" name="notes_original" value="${escapeAttr(notes || '')}" />
        <textarea class="db-table-input db-table-input--notes db-membership-editable-cell" name="notes" rows="3" aria-label="Notas de sesión">${escapeHTML(notes || '')}</textarea>
      </form>
    </div>
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
  const canonicalValue = canonicalSessionTypeValue(value);
  return SESSION_TYPE_OPTIONS.find((item) => item.value === canonicalValue) ?? SESSION_TYPE_OPTIONS[0];
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
  const conceptInput = form.querySelector('[data-session-concept]');
  const config = sessionTypeConfig(typeSelect?.value);
  const isMembership = isMembershipValue(typeSelect?.value);

  if (costInput) costInput.value = config?.cost ?? '';
  if (endInput) endInput.value = addMinutesToTime(startInput?.value, config?.minutes);
  if (conceptInput && isMembership) {
    conceptInput.value = MEMBERSHIP_CANONICAL;
    conceptInput.readOnly = true;
  } else if (conceptInput) {
    conceptInput.readOnly = false;
  }
}

function updateTransactionConceptFields(form) {
  if (!form || form.dataset.form !== 'transaction-create') return;

  const serviceSelect = form.querySelector('[data-transaction-service]');
  const conceptSelect = form.querySelector('[data-transaction-concept]');
  const customWrap = form.querySelector('[data-custom-concept-wrap]');
  const customInput = form.querySelector('[data-custom-concept]');

  if (serviceSelect && isMembershipValue(serviceSelect.value)) {
    serviceSelect.value = MEMBERSHIP_CANONICAL;
    if (conceptSelect && (!conceptSelect.value || conceptSelect.value === 'PERSONALIZADO')) {
      conceptSelect.value = MEMBERSHIP_CANONICAL;
    }
  }

  const custom = conceptSelect?.value === 'PERSONALIZADO';
  if (customWrap) customWrap.hidden = !custom;
  if (customInput) {
    customInput.disabled = !custom;
    customInput.required = custom;
    if (!custom) customInput.value = '';
  }
}

function formatDateOnly(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

function formatDisplayDateOnly(value) {
  const raw = formatDateOnly(value);
  if (!raw || raw === '-') return '-';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return raw;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

function formatDisplayDateList(values = []) {
  return values
    .map((value) => formatDisplayDateOnly(value))
    .filter((value) => value && value !== '-')
    .join(', ');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDisplayDateOnly(value);
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function normalizeCatalogValue(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isMembershipValue(value) {
  const normalized = normalizeCatalogValue(value).replace(/[^A-Z0-9]/g, '');
  return normalized.includes('MEMBRESIA') || normalized.includes('MEMBRES');
}

function canonicalServiceValue(value) {
  return isMembershipValue(value) ? MEMBERSHIP_CANONICAL : String(value ?? '').trim();
}

function canonicalSessionTypeValue(value) {
  const normalized = normalizeCatalogValue(value);
  if (isMembershipValue(normalized)) return MEMBERSHIP_CANONICAL;
  if (normalized.includes('BASICA') || normalized.includes('BÁSICA')) return 'SESIÓN BÁSICA';
  if (normalized.includes('PREMIUM')) return 'SESIÓN PREMIUM';
  if (normalized.includes('GRABACION') || normalized.includes('GRABACIÓN')) return 'GRABACIÓN';
  return String(value ?? '').trim();
}

function compareDateOnly(a, b) {
  return String(formatDateOnly(a)).localeCompare(String(formatDateOnly(b)));
}

function dateOnlyToLocalDate(value) {
  const raw = formatDateOnly(value);
  if (!raw || raw === '-') return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day);
}

function addDaysToDateOnly(value, days) {
  const date = dateOnlyToLocalDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function getWeekStartMonday(value) {
  const date = dateOnlyToLocalDate(value);
  if (!date) return null;
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function getWeekEndSunday(value) {
  const start = getWeekStartMonday(value);
  return start ? addDaysToDateOnly(start, 6) : null;
}

function membershipIdOf(row) {
  return row?.membership_id ?? row?.membershipId ?? null;
}

function rowMatchesMembership(row, membership) {
  const rowMembershipId = membershipIdOf(row);
  if (rowMembershipId) return String(rowMembershipId) === String(membership.id);
  return String(row?.user_id ?? '') === String(membership.user_id ?? '');
}

function membershipEndDate(membership, today = todayDateInputValue()) {
  if (membership.end_date) return formatDateOnly(membership.end_date);
  return formatDateOnly(today);
}

function generateMembershipWeeks(membership, today = todayDateInputValue()) {
  const startDate = getWeekStartMonday(membership.start_date);
  const endDate = getWeekEndSunday(membershipEndDate(membership, today));
  if (!dateOnlyToLocalDate(startDate) || compareDateOnly(startDate, endDate) > 0) return [];

  const weeks = [];
  let weekStart = startDate;
  let index = 1;

  while (weekStart && compareDateOnly(weekStart, endDate) <= 0) {
    weeks.push({
      membership,
      semana: index,
      fecha_esperada: weekStart,
      week_end: getWeekEndSunday(weekStart),
      weekly_price: Number(membership.weekly_price ?? MEMBERSHIP_WEEKLY_COST) || MEMBERSHIP_WEEKLY_COST,
    });
    weekStart = addDaysToDateOnly(startDate, index * 7);
    index += 1;
  }

  return weeks;
}

function sessionsForMembershipWeek(week, sessions = []) {
  return sessions.filter((session) => {
    if (!rowMatchesMembership(session, week.membership)) return false;
    if (!(isMembershipValue(session.type) || isMembershipValue(session.concept))) return false;
    const sessionDate = formatDateOnly(session.session_date);
    return compareDateOnly(sessionDate, week.fecha_esperada) >= 0
      && compareDateOnly(sessionDate, week.week_end) <= 0;
  }).sort((a, b) => compareDateOnly(a.session_date, b.session_date) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

function membershipSessionNotes(sessions = []) {
  const notes = sessions
    .map((session) => ({
      date: formatDisplayDateOnly(session.session_date),
      notes: String(session.notes ?? '').trim(),
    }))
    .filter((session) => session.notes);

  if (!notes.length) return '-';
  if (notes.length === 1) return notes[0].notes;
  return notes.map((session) => `${session.date}: ${session.notes}`).join(' · ');
}

function membershipWeekObligation(week, sessions = []) {
  return week.weekly_price;
}

function buildLegacyMembershipsFromSessions(sessions = []) {
  const grouped = new Map();

  (sessions ?? [])
    .filter((session) => isMembershipValue(session.type) || isMembershipValue(session.concept))
    .forEach((session) => {
      const userId = String(session.user_id ?? '').trim();
      if (!userId) return;
      const current = grouped.get(userId);
      const sessionDate = formatDateOnly(session.session_date);
      if (!current) {
        grouped.set(userId, {
          id: `legacy-${userId}`,
          user_id: userId,
          username: session.username ?? null,
          status: 'active',
          start_date: sessionDate,
          end_date: sessionDate,
          weekly_price: MEMBERSHIP_WEEKLY_COST,
          sessions_per_week: 1,
          notes: 'Membresía histórica sin registro en public.memberships.',
          legacy: true,
        });
        return;
      }

      if (compareDateOnly(sessionDate, current.start_date) < 0) current.start_date = sessionDate;
      if (compareDateOnly(sessionDate, current.end_date) > 0) current.end_date = sessionDate;
    });

  return [...grouped.values()];
}

function buildMembershipRows(memberships = [], sessions = [], transactions = [], materialDeliveries = []) {
  const sourceMemberships = (memberships ?? []).length
    ? memberships
    : buildLegacyMembershipsFromSessions(sessions);

  const membershipSessions = (sessions ?? [])
    .filter((session) => isMembershipValue(session.type) || isMembershipValue(session.concept))
    .sort((a, b) => compareDateOnly(a.session_date, b.session_date) || String(a.id ?? '').localeCompare(String(b.id ?? '')));

  const membershipPayments = (transactions ?? [])
    .filter((tx) => isMembershipValue(tx.service))
    .map((tx) => ({
      ...tx,
      amount: Math.max(0, Number(tx.amount ?? 0)),
      date: formatDateOnly(tx.date),
    }))
    .filter((tx) => tx.amount > 0)
    .sort((a, b) => compareDateOnly(a.date, b.date) || String(a.id ?? '').localeCompare(String(b.id ?? '')));

  const today = todayDateInputValue();
  const rows = [];

  sourceMemberships
    .slice()
    .sort((a, b) => compareDateOnly(a.start_date, b.start_date) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
    .forEach((membership) => {
      const membershipSessionRows = membershipSessions.filter((session) => rowMatchesMembership(session, membership));
      const latestSessionDate = membershipSessionRows.reduce((latest, session) => {
        const sessionDate = formatDateOnly(session.session_date);
        return !latest || compareDateOnly(sessionDate, latest) > 0 ? sessionDate : latest;
      }, null);
      const generationEndDate = latestSessionDate && compareDateOnly(latestSessionDate, today) > 0
        ? latestSessionDate
        : today;
      const weeks = generateMembershipWeeks(membership, generationEndDate);
      const payments = membershipPayments.filter((tx) => rowMatchesMembership(tx, membership));
      let paymentIndex = 0;
      let availableCredit = 0;
      let availableCreditDate = null;

      weeks.forEach((week) => {
        const weekSessions = sessionsForMembershipWeek(week, membershipSessionRows);
        const firstSession = weekSessions[0] ?? null;
        const usedSessionDates = [...new Set(weekSessions.map((session) => formatDateOnly(session.session_date)))];
        const weekObligation = membershipWeekObligation(week, weekSessions);

        while (paymentIndex < payments.length && compareDateOnly(payments[paymentIndex].date, week.fecha_esperada) <= 0) {
          availableCredit += payments[paymentIndex].amount;
          availableCreditDate = payments[paymentIndex].date;
          paymentIndex += 1;
        }

        let coveringPayment = null;
        while (availableCredit < weekObligation && paymentIndex < payments.length) {
          availableCredit += payments[paymentIndex].amount;
          coveringPayment = payments[paymentIndex];
          availableCreditDate = payments[paymentIndex].date;
          paymentIndex += 1;
        }

        const covered = availableCredit >= weekObligation;
        const fechaSaldo = covered ? (coveringPayment?.date ?? availableCreditDate ?? week.fecha_esperada) : null;
        let estado = 'PENDIENTE';
        let saldo = null;
        let saldo_tipo = null;

        if (covered) {
          if (fechaSaldo < week.fecha_esperada) estado = 'ADELANTADO';
          else if (compareDateOnly(fechaSaldo, week.week_end) <= 0) estado = 'CORRIENTE';
          else estado = 'ATRASADO';

          availableCredit -= weekObligation;
          saldo = availableCredit > 0 ? availableCredit : null;
          if (availableCredit <= 0) availableCreditDate = null;
        } else if (compareDateOnly(week.week_end, today) < 0) {
          estado = 'ATRASADO';
          saldo = availableCredit - weekObligation;
          saldo_tipo = 'adeudo';
          availableCredit = 0;
          availableCreditDate = null;
        } else if (availableCredit < weekObligation) {
          saldo = availableCredit - weekObligation;
          saldo_tipo = 'pendiente';
        }

        rows.push({
          membership_id: membership.id,
          membership_start_date: formatDateOnly(membership.start_date),
          membership_end_date: membership.end_date ? formatDateOnly(membership.end_date) : null,
          user_id: membership.user_id,
          username: membership.username,
          semana: week.semana,
          periodo: `${formatDateOnly(week.fecha_esperada)} a ${formatDateOnly(week.week_end)}`,
          fecha_esperada: week.fecha_esperada,
          obligacion: weekObligation,
          session_id: firstSession?.id ?? null,
          session_notes: firstSession?.notes ?? '',
          fecha_de_sesion: firstSession ? formatDateOnly(firstSession.session_date) : null,
          sesiones_usadas: usedSessionDates.join(', '),
          sesiones_usadas_lista: usedSessionDates,
          estado,
          estado_operativo: String(membership.status ?? 'active').toUpperCase(),
          fecha_de_saldo: fechaSaldo,
          saldo,
          saldo_tipo,
          notas: membershipSessionNotes(weekSessions),
        });
      });
    });

  return applyMembershipMaterialDeliveries(rows, materialDeliveries);
}

function materialDeliveryKey({ membershipId = null, userId = null, cycleNumber = null }) {
  return [
    membershipId ? String(membershipId) : 'legacy',
    userId ? String(userId) : '',
    Number(cycleNumber ?? 0),
  ].join('|');
}

function applyMembershipMaterialDeliveries(rows = [], materialDeliveries = []) {
  if (!rows.length || !materialDeliveries?.length) return rows;

  const deliveriesByKey = new Map();
  materialDeliveries.forEach((delivery) => {
    const cycleNumber = Number(delivery.cycle_number ?? delivery.cycleNumber ?? 0);
    if (!Number.isFinite(cycleNumber) || cycleNumber < 1) return;
    const key = materialDeliveryKey({
      membershipId: delivery.membership_id ?? null,
      userId: delivery.user_id,
      cycleNumber,
    });
    deliveriesByKey.set(key, delivery);
  });

  return rows.map((row) => {
    const weekNumber = Number(row.semana ?? 0);
    if (!Number.isFinite(weekNumber) || weekNumber < 1) return row;
    const cycleNumber = Math.floor((weekNumber - 1) / 4) + 1;
    const exactKey = materialDeliveryKey({
      membershipId: row.membership_id ?? null,
      userId: row.user_id,
      cycleNumber,
    });
    const legacyKey = materialDeliveryKey({
      membershipId: null,
      userId: row.user_id,
      cycleNumber,
    });
    const delivery = deliveriesByKey.get(exactKey) ?? deliveriesByKey.get(legacyKey);
    if (!delivery) return row;

    return {
      ...row,
      material_cycle_number: cycleNumber,
      material_delivered_at: delivery.delivered_at ? formatDateOnly(delivery.delivered_at) : null,
      material_delivery_notes: delivery.notes ?? '',
    };
  });
}

function formatMembershipRowBalance(row) {
  const saldo = Number(row?.saldo ?? 0);
  if (!row || row.saldo === null || row.saldo === undefined || saldo === 0) return '-';
  if (saldo < 0) {
    return row.saldo_tipo === 'pendiente'
      ? `Pendiente por pagar ${money(Math.abs(saldo))}`
      : `Adeudo ${money(Math.abs(saldo))}`;
  }
  return `Crédito ${money(saldo)}`;
}

function renderMembershipNotices(membershipRows = []) {
  if (!membershipRows.length) return '';

  const paidLateCount = membershipRows
    .filter((row) => row.estado === 'ATRASADO' && row.fecha_de_saldo)
    .length;
  const openRows = membershipRows.filter((row) => !row.fecha_de_saldo && row.estado === 'ATRASADO');
  const pendingBalance = openRows.reduce((sum, row) => sum + Math.min(0, Number(row.saldo ?? 0)), 0);
  const creditBalance = membershipRows.reduce((sum, row) => sum + Math.max(0, Number(row.saldo ?? 0)), 0);
  const latestBalance = pendingBalance < 0 ? pendingBalance : creditBalance;
  const notices = [];

  if (paidLateCount > 0) {
    notices.push({
      tone: 'warning',
      text: `Tienes ${paidLateCount} sesiones saldadas CON ATRASO`,
    });
  }

  if (latestBalance < 0) {
    notices.push({
      tone: 'danger',
      text: `AVISO: Tu cuenta presenta un adeudo pendiente por un total de ${money(Math.abs(latestBalance))}. En caso de incumplimiento, Hidden Room podrá suspender o cancelar la membresía de acuerdo con los Términos y Condiciones aceptados durante su contratación. Consulta los TyC para conocer los detalles aplicables.`,
    });
  } else if (latestBalance > 0) {
    notices.push({
      tone: 'success',
      text: `Tienes un saldo a favor de ${money(latestBalance)}, ¡MUCHAS FELICIDADES!`,
    });
  } else {
    notices.push({
      tone: 'success',
      text: '¡FELICIDADES! Tu cuenta se encuentra al corriente. Eres acreedor a recompensas y dinámicas.',
    });
  }

  return `
    <div class="db-membership-notices" aria-live="polite">
      ${notices.map((notice) => `
        <p class="db-membership-notice db-membership-notice--${escapeAttr(notice.tone)}">${escapeHTML(notice.text)}</p>
      `).join('')}
    </div>
  `;
}

function membershipBalanceParts(rows = []) {
  const overdue = rows
    .filter((row) => row.saldo_tipo === 'adeudo')
    .reduce((sum, row) => sum + Math.min(0, Number(row.saldo ?? 0)), 0);
  const pending = rows
    .filter((row) => row.saldo_tipo === 'pendiente')
    .reduce((sum, row) => sum + Math.min(0, Number(row.saldo ?? 0)), 0);
  const credit = rows.reduce((sum, row) => sum + Math.max(0, Number(row.saldo ?? 0)), 0);
  return { overdue, pending, credit };
}

function membershipOverdueBalanceSummary(rows = []) {
  const { overdue, credit } = membershipBalanceParts(rows);
  if (overdue < 0) return money(Math.abs(overdue));
  if (credit > 0) return `Crédito ${money(credit)}`;
  return 'Sin saldo vencido';
}

function membershipPendingBalanceSummary(rows = []) {
  const { pending } = membershipBalanceParts(rows);
  return pending < 0 ? money(Math.abs(pending)) : 'Sin saldo pendiente';
}

function membershipSummaryTone(key, value) {
  const normalized = normalizeCatalogValue(value);
  if (key === 'status') {
    if (normalized === 'CON ADEUDO') return 'danger';
    if (normalized === 'ACTIVE') return 'success';
    if (normalized === 'PAUSED') return 'warning';
      if (normalized === 'CANCELLED' || normalized === 'EXPIRED') return 'danger';
  }
  if (key === 'overdue-balance') {
    if (normalized.includes('SIN SALDO')) return 'success';
    if (normalized.includes('CREDITO')) return 'success';
    return 'danger';
  }
  if (key === 'pending-balance') {
    return 'muted';
  }
  if (key === 'balance') {
    if (normalized.includes('ADEUDO') || normalized.includes('ATRASO')) return 'danger';
    if (normalized.includes('CREDITO') || normalized.includes('CORRIENTE')) return 'success';
  }
  if (key === 'expired') {
    return normalized.includes('SIN MEMBRESIAS VENCIDAS') ? 'success' : 'danger';
  }
  return 'neutral';
}

function membershipDisplayStatus(rows = []) {
  const latest = rows
    .slice()
    .sort((a, b) => compareDateOnly(a.fecha_esperada, b.fecha_esperada))
    .at(-1);
  if (!latest) return '-';
  if (rows.some(rowHasOpenMembershipDebt)) return 'CON ADEUDO';
  return latest.estado_operativo || '-';
}

function monthLabel(monthKey) {
  if (!monthKey) return '-';
  const [year, month] = String(monthKey).split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return String(monthKey);
  return new Date(year, month - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}

function endOfNextMonth(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const date = new Date(year, month + 1, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rowHasOpenMembershipDebt(row) {
  return row?.saldo_tipo === 'adeudo' || (row?.estado === 'ATRASADO' && !row?.fecha_de_saldo);
}

function membershipCurrentBalanceValue(rows = []) {
  const openRows = rows.filter((row) => row.saldo_tipo === 'adeudo' || row.saldo_tipo === 'pendiente');
  const pendingBalance = openRows.reduce((sum, row) => sum + Math.min(0, Number(row.saldo ?? 0)), 0);
  const creditBalance = rows.reduce((sum, row) => sum + Math.max(0, Number(row.saldo ?? 0)), 0);
  return pendingBalance < 0 ? pendingBalance : creditBalance;
}

function membershipIsActiveAndCurrent(rows = []) {
  const latest = rows
    .slice()
    .sort((a, b) => compareDateOnly(a.fecha_esperada, b.fecha_esperada))
    .at(-1);
  return latest?.estado_operativo === 'ACTIVE' && !rows.some(rowHasOpenMembershipDebt);
}

function membershipMaterialDeliveries(rows = []) {
  const sortedRows = rows
    .slice()
    .sort((a, b) => Number(a.semana ?? 0) - Number(b.semana ?? 0));
  const cycles = new Map();
  const currentBalance = membershipCurrentBalanceValue(rows);
  const today = todayDateInputValue();
  const latest = sortedRows[sortedRows.length - 1] ?? {};
  const membershipActive = latest.estado_operativo === 'ACTIVE';

  sortedRows.forEach((row) => {
    const weekNumber = Number(row.semana ?? 0);
    if (!Number.isFinite(weekNumber) || weekNumber < 1) return;
    const cycleNumber = Math.floor((weekNumber - 1) / 4) + 1;
    const current = cycles.get(cycleNumber) ?? {
      cycleNumber,
      rows: [],
      sessionDates: new Set(),
    };

    current.rows.push(row);
    (Array.isArray(row.sesiones_usadas_lista) ? row.sesiones_usadas_lista : []).forEach((date) => {
      current.sessionDates.add(formatDateOnly(date));
    });
    cycles.set(cycleNumber, current);
  });

  return [...cycles.values()]
    .sort((a, b) => a.cycleNumber - b.cycleNumber)
    .map((cycle) => {
      const rowList = cycle.rows.sort((a, b) => Number(a.semana ?? 0) - Number(b.semana ?? 0));
      const firstWeek = (cycle.cycleNumber - 1) * 4 + 1;
      const lastWeek = firstWeek + 3;
      const periodStart = rowList[0]?.fecha_esperada ?? null;
      const periodEnd = periodStart ? addDaysToDateOnly(periodStart, 27) : null;
      const deliveryBase = periodEnd ? addDaysToDateOnly(periodEnd, 28) : null;
      const lateWeeks = rowList.filter((row) => row.estado === 'ATRASADO' && row.fecha_de_saldo).length;
      const missingWeeks = Math.max(0, 4 - rowList.length);
      const unpaidWeeks = rowList.filter((row) => row.saldo_tipo === 'adeudo' || row.saldo_tipo === 'pendiente').length;
      const pendingWeeks = missingWeeks + unpaidWeeks;
      const estimatedDelivery = deliveryBase ? addDaysToDateOnly(deliveryBase, lateWeeks * 7) : null;
      const deliveredRow = rowList.find((row) => row.material_delivered_at);
      const deliveredAt = deliveredRow?.material_delivered_at ?? null;
      const deliveryNotes = deliveredRow?.material_delivery_notes ?? null;
      let status = 'PROGRAMADA';
      let reason = 'Entrega programada según regla contractual';

      if (deliveredAt) {
        status = 'ENTREGADA';
        reason = deliveryNotes || `Material entregado el ${formatDisplayDateOnly(deliveredAt)}`;
      } else if (pendingWeeks > 0 || currentBalance < 0) {
        status = 'BLOQUEADA POR ADEUDO';
        reason = pendingWeeks > 0
          ? `${pendingWeeks} semana${pendingWeeks === 1 ? '' : 's'} pendiente${pendingWeeks === 1 ? '' : 's'} de pago`
          : 'Saldo actual negativo';
      } else if (!membershipActive) {
        status = 'BLOQUEADA POR MEMBRESÍA INACTIVA';
        reason = `Membresía ${latest.estado_operativo || '-'}`;
      } else if (lateWeeks > 0 && compareDateOnly(today, estimatedDelivery) < 0) {
        status = 'DIFERIDA POR ATRASO';
        reason = `${lateWeeks} semana${lateWeeks === 1 ? '' : 's'} ${lateWeeks === 1 ? 'fue saldada' : 'fueron saldadas'} con atraso`;
      } else if (lateWeeks === 0 && compareDateOnly(today, deliveryBase) < 0) {
        status = 'PROGRAMADA';
        reason = 'Sin atrasos; entrega programada al cierre del siguiente ciclo';
      } else {
        status = 'DISPONIBLE';
        reason = lateWeeks > 0
          ? `${lateWeeks} semana${lateWeeks === 1 ? '' : 's'} de atraso aplicada${lateWeeks === 1 ? '' : 's'}`
          : 'Fecha de entrega alcanzada';
      }

      return {
        cycle: `Mes ${cycle.cycleNumber}`,
        firstWeek,
        lastWeek,
        includedWeeks: `Semana ${firstWeek} a Semana ${lastWeek}`,
        workedPeriod: `${formatDisplayDateOnly(periodStart)} a ${formatDisplayDateOnly(periodEnd)}`,
        deliveryBase,
        lateWeeks,
        delayApplied: lateWeeks ? `${lateWeeks} semana${lateWeeks === 1 ? '' : 's'}` : 'Sin atraso',
        estimatedDelivery,
        deliveredAt,
        deliveryNotes,
        pendingWeeks,
        status,
        sessionDates: [...cycle.sessionDates].sort(compareDateOnly),
        reason,
      };
    });
}

function membershipDeliveryByWeek(rows = []) {
  const deliveries = membershipMaterialDeliveries(rows);
  const byWeek = new Map();

  deliveries.forEach((delivery) => {
    for (let week = delivery.firstWeek; week <= delivery.lastWeek; week += 1) {
      byWeek.set(week, delivery);
    }
  });

  return byWeek;
}

function nextMembershipDeliveryText(rows = []) {
  const deliveries = membershipMaterialDeliveries(rows);
  if (!deliveries.length) return 'Sin material trabajado';
  const nextDelivery = deliveries.find((item) => item.status !== 'ENTREGADA');
  if (!nextDelivery) return 'Sin próxima entrega';
  return `${formatDisplayDateOnly(nextDelivery.estimatedDelivery)} · ${nextDelivery.status}`;
}

function renderMembershipSummary(rows = []) {
  if (!rows.length) return '';

  const today = todayDateInputValue();
  const sortedAsc = rows
    .slice()
    .sort((a, b) => compareDateOnly(a.fecha_esperada, b.fecha_esperada));
  const latest = sortedAsc[sortedAsc.length - 1] ?? {};
  const upcoming = sortedAsc.find((row) => compareDateOnly(row.fecha_de_sesion || row.fecha_esperada, today) >= 0);
  const expiredMemberships = new Map();

  rows.forEach((row) => {
    if (row.estado_operativo !== 'EXPIRED') return;
    const membershipId = row.membership_id ?? `${row.user_id}-${row.fecha_esperada}`;
    if (expiredMemberships.has(membershipId)) return;
    expiredMemberships.set(membershipId, {
      start: row.membership_start_date || row.fecha_esperada,
      end: row.membership_end_date || row.fecha_esperada,
    });
  });

  const expiredText = expiredMemberships.size
    ? [...expiredMemberships.values()]
      .map((item) => `${formatDisplayDateOnly(item.start)} a ${formatDisplayDateOnly(item.end)}`)
      .join(', ')
    : 'Sin membresías vencidas';

  const items = [
    { key: 'status', label: 'ESTADO DE MEMBRESÍA:', value: membershipDisplayStatus(rows) },
    { key: 'overdue-balance', label: 'SALDO VENCIDO:', value: membershipOverdueBalanceSummary(rows) },
    { key: 'pending-balance', label: 'SALDO PENDIENTE:', value: membershipPendingBalanceSummary(rows) },
    { key: 'next-session', label: 'PRÓXIMA SESIÓN:', value: upcoming ? formatDisplayDateOnly(upcoming.fecha_de_sesion || upcoming.fecha_esperada) : 'Sin próxima sesión' },
    { key: 'next-delivery', label: 'PRÓXIMA ENTREGA:', value: nextMembershipDeliveryText(rows) },
    { key: 'expired', label: 'MEMBRESÍAS VENCIDAS:', value: expiredText },
  ];

  return `
    <div class="db-membership-summary" aria-label="Resumen de membresía">
      ${items.map((item) => `
        <div class="db-membership-summary__item db-membership-summary__item--${escapeAttr(membershipSummaryTone(item.key, item.value))}">
          <span>${escapeHTML(item.label)}</span>
          <strong>${escapeHTML(item.value)}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMembershipSyncFooter() {
  const message = 'Hola, quiero reportar o aclarar información de mi dashboard de membresía en Mysauth OS.';
  return `
    <div class="db-membership-sync">
      <p>Sincronizado desde Mysauth OS. ¿Crees que hay un error? Contáctanos para reportarlo, solicitar aclaraciones o actualización de datos.</p>
      <a class="db-btn-secondary db-membership-sync__button" href="${escapeAttr(buildWhatsAppLink(MEMBERSHIP_SUPPORT_WHATSAPP, message))}" target="_blank" rel="noopener noreferrer">Mensaje por WhatsApp</a>
    </div>
  `;
}

function normalizeTransactionType(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (['INCOME', 'INGRESO', 'INGRESOS'].includes(raw)) return 'INGRESO';
  if (['EXPENSE', 'EGRESO', 'EGRESOS'].includes(raw)) return 'EGRESO';
  return raw;
}

function transactionAmount(tx) {
  return Number(tx?.amount || 0);
}

function eventFinanceAmount(tx) {
  return Number(tx?.hidden_room_share ?? tx?.['M.A.I.'] ?? tx?.['M.A.I'] ?? tx?.MAI ?? tx?.mai ?? 0);
}

function movementTypeConfig(value) {
  return EVENT_MOVEMENT_TYPES.find((item) => item.value === value) ?? EVENT_MOVEMENT_TYPES[0];
}

function movementTypeLabel(value) {
  return EVENT_MOVEMENT_TYPES.find((item) => item.value === value)?.label ?? '';
}

function financeTotals(transactions, amountGetter = transactionAmount, options = {}) {
  const ingresos = sumTransactions(transactions, 'INGRESO', amountGetter);
  const egresos = sumTransactions(transactions, 'EGRESO', amountGetter);
  const hasExplicitIncomeExpense = transactions.some((tx) => {
    const type = normalizeTransactionType(tx.type);
    return type === 'INGRESO' || type === 'EGRESO';
  });
  const fallbackBalance = options.balanceFromAmountWhenNoIncomeExpense && !hasExplicitIncomeExpense
    ? transactions.reduce((sum, tx) => sum + amountGetter(tx), 0)
    : null;

  return {
    ingresos,
    egresos,
    hasExplicitIncomeExpense,
    balance: fallbackBalance ?? ingresos - egresos,
  };
}

function sumTransactions(transactions, type, amountGetter = transactionAmount) {
  return transactions
    .filter((tx) => normalizeTransactionType(tx.type) === type)
    .reduce((sum, tx) => sum + amountGetter(tx), 0);
}

function topClients(transactions, amountGetter = transactionAmount) {
  const totals = new Map();
  transactions
    .filter((tx) => normalizeTransactionType(tx.type) === 'INGRESO')
    .forEach((tx) => {
      const key = tx.username || tx.user_id || 'Sin cliente';
      totals.set(key, (totals.get(key) || 0) + amountGetter(tx));
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
  const name = event.name ?? `Evento ${event.id}`;
  const date = event.event_date ?? event.date;
  return date ? `${name} · ${formatDisplayDateOnly(date)}` : name;
}

async function fetchEventFinanceOptions(context = 'finance') {
  return fetchAdminEventFinanceOptions(context);
}

async function fetchAdminEventFinanceOptions(context = 'finance') {
  try {
    const { data, error } = await supabase
      .from('hr_events_dashboard')
      .select('*')
      .order('event_date', { ascending: false });

    if (error) {
      console.info(`[HR] ${context} events unavailable:`, error.message);
      return [];
    }

    return normalizeEventFinanceOptions(data ?? []);
  } catch (err) {
    console.info(`[HR] ${context} events skipped:`, err?.message ?? err);
    return [];
  }
}

async function fetchAccessibleEventFinanceOptions(context = 'finance') {
  if (hasRole('admin')) return fetchAdminEventFinanceOptions(context);
  if (!state.user?.user_id) return [];

  try {
    const { data, error } = await supabase
      .from('hr_events_user_access')
      .select('*')
      .eq('user_id', state.user.user_id)
      .order('event_date', { ascending: false });

    if (error) {
      console.info(`[HR] ${context} assigned events unavailable:`, error.message);
      return [];
    }

    return normalizeEventFinanceOptions(data ?? []);
  } catch (err) {
    console.info(`[HR] ${context} assigned events skipped:`, err?.message ?? err);
    return [];
  }
}

async function fetchAllEventParticipants() {
  if (Array.isArray(state.data.eventParticipantsAll)) return state.data.eventParticipantsAll;

  const { data, error } = await supabase
    .from('participants')
    .select('id, user_id, role, status, notes')
    .eq('status', 'active')
    .order('user_id', { ascending: true });

  if (error) {
    console.info('[HR] participants unavailable:', error.message);
    state.data.eventParticipantsAll = [];
    return [];
  }

  state.data.eventParticipantsAll = data ?? [];
  return state.data.eventParticipantsAll;
}

async function fetchParticipantsForEvent(eventId) {
  return fetchAllEventParticipants();
}

function normalizeEventFinanceOptions(events = []) {
  const seen = new Set();
  return (events ?? [])
    .map((event) => ({
      ...event,
      id: event?.id ?? event?.event_id ?? null,
      event_id: event?.event_id ?? event?.id ?? null,
      name: String(event?.name ?? event?.event_key ?? '').trim(),
      event_key: String(event?.event_key ?? '').trim(),
    }))
    .filter((event) => {
      const key = String(event.id ?? event.event_id ?? event.event_key ?? '').trim();
      return key && !seen.has(key) && seen.add(key);
    })
    .sort((a, b) => (b.event_date ?? '').localeCompare(a.event_date ?? '') || a.name.localeCompare(b.name, 'es'));
}

function hasEventKeyCache(events) {
  return Array.isArray(events)
    && events.length > 0
    && events.every((event) => Object.prototype.hasOwnProperty.call(event, 'event_key'));
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

async function insertRow(table, payload, successMessage, options = {}) {
  const request = options.returning
    ? supabase.from(table).insert(payload).select(options.returning).maybeSingle()
    : supabase.from(table).insert(payload);
  const { data, error } = await request;
  if (error) {
    console.error(`[HR] ${table} insert:`, error);
    showToast('No se pudo guardar. Revisa permisos/RLS.', 'error');
    return { ok: false, data: null };
  }

  showToast(successMessage, 'success');
  return { ok: true, data };
}

async function handleTaskCreate(form) {
  if (!canEditScrum()) return showToast('No tienes permiso para editar SCRUM.', 'error');
  const payload = formValues(form);
  payload.created_by = state.user?.user_id ?? null;
  if (payload.due_date) payload.due_date = formatDateOnly(payload.due_date);

  const result = await insertRow('tasks', payload, 'Tarea creada.');
  if (result.ok) {
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
  const operationAction = form.dataset.operationAction || 'create';
  const shouldShareReceipt = operationAction === 'create-share';

  if (type === 'user-merge') {
    await handleAdminUserMerge(form, values);
    return;
  }

  if (type === 'collab-event-movement-create' || type === 'admin-event-movement-create') {
    await handleEventMovementCreate(form, values);
    return;
  }

  if (type === 'event-participant-create') {
    await handleEventParticipantCreate(form, values);
    return;
  }

  if (type === 'membership-cancel') {
    await handleMembershipCancel(form, values);
    return;
  }

  if (type === 'membership-delivery') {
    await handleMembershipDelivery(form, values);
    return;
  }

  if (type === 'membership-session-notes') {
    await handleMembershipSessionNotes(form, values);
    return;
  }

  if ('user_id' in values && !values.user_id) {
    showToast('Selecciona un usuario valido.', 'error');
    return;
  }

  const numericKeys = ['amount', 'cost', 'weekly_price', 'sessions_per_week'];
  numericKeys.forEach((key) => {
    if (values[key] != null) values[key] = Number(values[key]);
  });

  ['date', 'session_date', 'due_date', 'event_date', 'start_date', 'end_date'].forEach((key) => {
    if (values[key]) values[key] = formatDateOnly(values[key]);
  });

  if (values.type) values.type = normalizeTransactionType(values.type);
  if (type === 'transaction-create') {
    values.service = canonicalServiceValue(values.service);
    if (values.concept === 'PERSONALIZADO') values.concept = String(values.concept_custom ?? '').trim();
    if (isMembershipValue(values.service)) {
      values.service = MEMBERSHIP_CANONICAL;
      if (!values.concept) values.concept = MEMBERSHIP_CANONICAL;
    }
    delete values.concept_custom;
  }
  if (type === 'session-create') {
    values.type = canonicalSessionTypeValue(values.type);
    if (isMembershipValue(values.type)) {
      values.type = MEMBERSHIP_CANONICAL;
      values.concept = MEMBERSHIP_CANONICAL;
      values.cost = MEMBERSHIP_WEEKLY_COST;
    }
    if (!values.status) values.status = 'sin apartado';
  }
  if (type === 'membership-create') {
    values.status = String(values.status || 'active').toLowerCase();
    values.weekly_price = Number(values.weekly_price || MEMBERSHIP_WEEKLY_COST);
    values.sessions_per_week = Number(values.sessions_per_week || 1);
    if (!values.end_date) values.end_date = null;
  }
  if (type === 'finance-entity-create') {
    values.entity_key = String(values.entity_key ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    values.name = String(values.name ?? '').trim();
    values.entity_type = String(values.entity_type || 'producer').toLowerCase();
    values.status = String(values.status || 'active').toLowerCase();
    values.notes = String(values.notes ?? '').trim() || null;

    if (!values.entity_key || !values.name) {
      showToast('Ingresa una clave y nombre válidos.', 'error');
      return;
    }
  }

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
    'membership-create': ['memberships', withTargetUsername(operationPayload), 'Membresía creada.'],
    'download-create': ['downloads', operationPayload, 'Descarga creada.'],
    'contract-create': ['contracts', operationPayload, 'Contrato creado.'],
    'event-create': ['events', operationPayload, 'Evento creado.'],
    'finance-entity-create': ['finance_entities', operationPayload, 'Entidad financiera creada.'],
  };

  const config = map[type];
  if (!config) return;

  const result = await insertRow(config[0], config[1], config[2], { returning: 'id' });
  if (result.ok) {
    if (type === 'event-create') {
      // Fuerza a que los selectores y permisos usen el evento recién creado.
      state.data.financeEvents = null;
      state.data.collabFinanceEvents = null;
      state.data.permissionEvents = null;
    } else if (type === 'finance-entity-create') {
      state.data.financeEntities = null;
    } else if (shouldShareReceipt) {
      await createUserNotification(
        operationPayload.user_id,
        operationNotificationMessage(type, operationPayload),
        'success'
      );
      await handleOperationReceipt(form);
    }
    form.reset();
    delete form.dataset.operationAction;
  }
}

async function handleMembershipCancel(form, values = formValues(form)) {
  const membershipId = String(values.membership_id ?? '').trim();
  if (!membershipId) {
    showToast('Selecciona una membresía.', 'error');
    return;
  }

  const payload = {
    status: 'cancelled',
    end_date: values.end_date ? formatDateOnly(values.end_date) : todayDateInputValue(),
  };
  const notes = String(values.notes ?? '').trim();
  if (notes) payload.notes = notes;

  const { error } = await supabase
    .from('memberships')
    .update(payload)
    .eq('id', membershipId);

  if (error) {
    console.error('[HR] membership cancel:', error);
    showToast('No se pudo cancelar la membresía.', 'error');
    return;
  }

  showToast('Membresía cancelada.', 'success');
  form.reset();
  navigate('erp-ops');
}

async function handleMembershipDelivery(form, values = formValues(form)) {
  if (!hasRole('admin')) {
    showToast('Acceso no autorizado.', 'error');
    return;
  }
  const staySection = form.dataset.staySection;
  const ok = await saveMembershipDeliveryValues(values);
  if (!ok) return;

  showToast('Entrega de material guardada.', 'success');
  if (staySection === 'admin-table-editor') {
    navigate('admin-table-editor');
  } else {
    form.reset();
    navigate('erp-ops');
  }
}

async function saveMembershipDeliveryValues(values = {}) {
  const membershipId = String(values.membership_id ?? '').trim() || null;
  const cycleNumber = Number(values.cycle_number ?? 0);
  const deliveredAt = values.delivered_at ? formatDateOnly(values.delivered_at) : null;
  let userId = String(values.user_id ?? '').trim();

  if (!Number.isFinite(cycleNumber) || cycleNumber < 1) {
    showToast('Ingresa un ciclo valido.', 'error');
    return false;
  }

  if (!deliveredAt) {
    showToast('Ingresa la fecha real de entrega.', 'error');
    return false;
  }

  if (membershipId) {
    const cachedMembership = (state.data.membershipOpsOptions ?? [])
      .find((membership) => String(membership.id) === membershipId);
    if (cachedMembership?.user_id) {
      userId = String(cachedMembership.user_id);
    } else {
      const { data, error } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('id', membershipId)
        .maybeSingle();
      if (error) {
        console.error('[HR] membership delivery membership lookup:', error);
        showToast('No se pudo validar la membresía.', 'error');
        return false;
      }
      if (data?.user_id) userId = String(data.user_id);
    }
  }

  if (!userId) {
    showToast('Selecciona un usuario o una membresía.', 'error');
    return false;
  }

  const payload = {
    membership_id: membershipId,
    user_id: userId,
    cycle_number: cycleNumber,
    delivered_at: deliveredAt,
  };
  if (values.note_scope === 'delivery' && Object.prototype.hasOwnProperty.call(values, 'notes')) {
    payload.notes = String(values.notes ?? '').trim() || null;
  }

  let existingQuery = supabase
    .from('membership_material_deliveries')
    .select('id')
    .eq('user_id', userId)
    .eq('cycle_number', cycleNumber)
    .limit(1);

  existingQuery = membershipId
    ? existingQuery.eq('membership_id', membershipId)
    : existingQuery.is('membership_id', null);

  const { data: existingRows, error: lookupError } = await existingQuery;
  if (lookupError) {
    console.error('[HR] membership delivery lookup:', lookupError);
    showToast('No se pudo revisar la entrega existente.', 'error');
    return false;
  }

  const existingId = existingRows?.[0]?.id;
  const request = existingId
    ? supabase.from('membership_material_deliveries').update(payload).eq('id', existingId)
    : supabase.from('membership_material_deliveries').insert(payload);

  const { error } = await request;
  if (error) {
    console.error('[HR] membership delivery save:', error);
    showToast('No se pudo guardar la entrega de material.', 'error');
    return false;
  }

  return true;
}

async function handleMembershipSessionNotes(form, values = formValues(form)) {
  if (!hasRole('admin')) {
    showToast('Acceso no autorizado.', 'error');
    return;
  }

  const ok = await saveMembershipSessionNotesValues(values);
  if (!ok) return;

  showToast('Notas de sesión guardadas.', 'success');
  if (form.dataset.staySection === 'admin-table-editor') {
    navigate('admin-table-editor');
  }
}

async function saveMembershipSessionNotesValues(values = {}) {
  const sessionId = String(values.session_id ?? '').trim();
  if (!sessionId) {
    showToast('Esta fila no tiene una sesión registrada para editar.', 'error');
    return false;
  }

  const { error } = await supabase
    .from('sessions')
    .update({ notes: String(values.notes ?? '').trim() || null })
    .eq('id', sessionId);

  if (error) {
    console.error('[HR] membership session notes save:', error);
    showToast('No se pudieron guardar las notas de la sesión.', 'error');
    return false;
  }

  return true;
}

async function handleAdminUserMerge(form, values = formValues(form)) {
  if (!hasRole('admin')) {
    showToast('Acceso no autorizado.', 'error');
    return;
  }

  const keepUserId = String(values.keep_user_id ?? '').trim();
  const duplicateEmail = String(values.duplicate_email ?? '').trim().toLowerCase();
  const holder = form.querySelector('[data-admin-merge-user-result]');

  if (!keepUserId || !duplicateEmail) {
    showToast('Ingresa el User ID historico y el email duplicado.', 'error');
    return;
  }

  const confirmed = window.confirm(
    `Advertencia: vas a conectar el Auth/email de ${duplicateEmail} al User ID historico ${keepUserId}.\n\nSe conservaran los datos operativos del User ID historico. No se importara el historial del perfil duplicado. ¿Confirmas la fusion?`
  );

  if (!confirmed) return;

  try {
    const { data, error } = await supabase.rpc('admin_merge_public_user_profiles', {
      p_keep_user_id: keepUserId,
      p_duplicate_email: duplicateEmail,
    });

    if (error || data?.success === false) {
      console.error('[HR] admin user merge:', error || data);
      const message = error?.message || data?.error || 'No se pudo fusionar usuarios.';
      showToast(message, 'error');
      if (holder) {
        holder.hidden = false;
        holder.textContent = message;
      }
      return;
    }

    state.data.users = null;
    showToast('Usuarios fusionados.', 'success');
    if (holder) {
      holder.hidden = false;
      holder.textContent = `Fusion realizada. User ID conservado: ${data?.kept_user_id ?? keepUserId}. Email activo: ${data?.email ?? duplicateEmail}.`;
    }
    form.reset();
  } catch (err) {
    console.error('[HR] admin user merge invoke:', err);
    const message = err?.message || 'Error al fusionar usuarios.';
    showToast(message, 'error');
    if (holder) {
      holder.hidden = false;
      holder.textContent = message;
    }
  }
}

async function handleEventParticipantCreate(form, values = formValues(form)) {
  if (!hasRole('admin')) {
    showToast('Acceso no autorizado.', 'error');
    return;
  }

  const userId = String(values.user_id ?? '').trim();
  if (!userId) {
    showToast('Selecciona un usuario participante.', 'error');
    return;
  }

  const participationPayload = {
    user_id: userId,
    role: values.role ?? null,
    status: values.status ?? 'active',
    notes: values.notes ?? null,
  };

  const { error: participationError } = await supabase
    .from('participants')
    .upsert(participationPayload, { onConflict: 'user_id' });

  if (participationError) {
    console.error('[HR] participant upsert:', participationError);
    showToast('No se pudo guardar el participante.', 'error');
    return;
  } else {
    showToast('Participante guardado.', 'success');
  }

  state.data.eventParticipantsAll = null;
  form.reset();
  navigate('erp-ops');
}

async function handleEventMovementCreate(form, values = formValues(form)) {
  const isAdmin = hasRole('admin');
  const eventId = values.event_id;
  const eventKey = values.event_key;
  const events = state.activeSection === 'collab-finance'
    ? (state.data.collabFinanceEvents ?? [])
    : (state.data.financeEvents ?? []);
  const selectedEvent = events.find((event) => String(event.id ?? event.event_id) === String(eventId));
  const permissions = eventAccessFor(selectedEvent, isAdmin);

  if (!permissions.can_add_finance) {
    showToast('No tienes permiso para capturar finanzas de este evento.', 'error');
    return;
  }

  const movement = movementTypeConfig(values.movement_type);
  const rawAmount = Math.abs(Number(values.amount ?? 0));
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    showToast('Ingresa un monto valido.', 'error');
    return;
  }

  const signedAmount = rawAmount * movement.sign;
  const rawHiddenRoomShare = Math.abs(Number(values.hidden_room_share ?? 0));
  const signedHiddenRoomShare = Number.isFinite(rawHiddenRoomShare) ? rawHiddenRoomShare * movement.sign : 0;
  const movementDate = values.movement_date ? formatDateOnly(values.movement_date) : todayDateInputValue();
  const payload = {
    event_id: eventId || null,
    event_key: eventKey || selectedEvent?.event_key || null,
    movement_type: movement.value,
    concept: values.concept,
    amount: signedAmount,
    hidden_room_share: signedHiddenRoomShare,
    from_user_id: values.from_user_id ?? null,
    to_user_id: values.to_user_id ?? null,
    owner_user_id: null,
    owner_entity_id: values.owner_entity_id ?? null,
    payment_method: values.payment_method ?? null,
    movement_date: movementDate,
    notes: values.notes ?? null,
    user_id: state.user?.user_id ?? null,
    username: state.user?.username ?? state.user?.display_name ?? state.user?.email ?? null,
    ...currentUserAuditFields(),
    type: movement.legacyType,
    via: values.payment_method ?? null,
    date: movementDate,
    'M.A.I.': signedHiddenRoomShare,
  };

  const result = await insertRow('hr_transactions', payload, 'Movimiento financiero creado.');
  if (result.ok) {
    form.reset();
    state.data.financeEvents = null;
    state.data.collabFinanceEvents = null;
    navigate(state.activeSection);
  }
}

async function handleEventMovementEdit(encodedTx) {
  let tx;
  try {
    tx = JSON.parse(decodeURIComponent(encodedTx));
  } catch (err) {
    console.error('[HR] event movement edit parse:', err);
    showToast('No se pudo leer el movimiento.', 'error');
    return;
  }

  const events = state.activeSection === 'collab-finance'
    ? (state.data.collabFinanceEvents ?? [])
    : (state.data.financeEvents ?? []);
  const selectedEvent = events.find((event) => String(event.id ?? event.event_id) === String(tx.event_id));
  const permissions = eventAccessFor(selectedEvent, hasRole('admin'));
  if (!permissions.can_edit_finance) {
    showToast('No tienes permiso para editar finanzas de este evento.', 'error');
    return;
  }

  const concept = window.prompt('Concepto', tx.concept ?? '');
  if (concept === null) return;
  const amountInput = window.prompt('Monto firmado', String(tx.amount ?? 0));
  if (amountInput === null) return;
  const hiddenShareInput = window.prompt('Hidden Room Share', String(tx.hidden_room_share ?? eventFinanceAmount(tx) ?? 0));
  if (hiddenShareInput === null) return;
  const paymentMethod = window.prompt('Metodo de pago', tx.payment_method ?? tx.via ?? '');
  if (paymentMethod === null) return;
  const movementDate = window.prompt('Fecha', formatDateOnly(tx.movement_date ?? tx.date));
  if (movementDate === null) return;
  const notes = window.prompt('Notas', tx.notes ?? '');
  if (notes === null) return;

  const amount = Number(amountInput);
  const hiddenRoomShare = Number(hiddenShareInput);
  if (!Number.isFinite(amount) || !Number.isFinite(hiddenRoomShare)) {
    showToast('Monto invalido.', 'error');
    return;
  }

  const payload = {
    concept: concept.trim() || null,
    amount,
    hidden_room_share: hiddenRoomShare,
    payment_method: paymentMethod.trim() || null,
    movement_date: movementDate ? formatDateOnly(movementDate) : null,
    notes: notes.trim() || null,
    via: paymentMethod.trim() || null,
    date: movementDate ? formatDateOnly(movementDate) : null,
    'M.A.I.': hiddenRoomShare,
  };

  const { error } = await supabase
    .from('hr_transactions')
    .update(payload)
    .eq('id', tx.id);

  if (error) {
    console.error('[HR] event movement edit:', error);
    showToast('No se pudo editar el movimiento.', 'error');
    return;
  }

  state.data.financeEvents = null;
  state.data.collabFinanceEvents = null;
  showToast('Movimiento actualizado.', 'success');
  navigate(state.activeSection);
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

function operationNotificationMessage(formType, values = {}) {
  const labels = {
    'transaction-create': 'Se registró una transacción en tu cuenta.',
    'session-create': 'Se registró una sesión en tu cuenta.',
    'download-create': 'Se agregó una descarga a tu cuenta.',
    'contract-create': 'Se agregó un contrato a tu cuenta.',
  };
  const base = labels[formType] ?? 'Se registró una operación en tu cuenta.';
  const amount = values.amount ? ` Monto: ${money(values.amount)}.` : '';
  const date = values.date || values.session_date
    ? ` Fecha: ${formatDisplayDateOnly(values.date || values.session_date)}.`
    : '';
  return `${base}${amount}${date}`;
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
      ['Fecha', values.date ? formatDisplayDateOnly(values.date) : formatDisplayDateOnly(new Date().toISOString())],
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
      ['Fecha', values.session_date ? formatDisplayDateOnly(values.session_date) : '-'],
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
          user_id: values.user_id ?? null,
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
  const userId = result?.user?.user_id ?? values.user_id ?? '';
  holder.hidden = false;
  holder.innerHTML = `
    <strong>Usuario creado.</strong>
    <span style="display:block;margin-top:6px;">Email: ${escapeHTML(email)}</span>
    <span style="display:block;margin-top:6px;">User ID: ${escapeHTML(userId || '-')}</span>
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

  const result = await insertRow(
    'user_permissions',
    { user_id: userUuid, permission_key: permissionKey },
    'Permiso agregado.'
  );

  if (result.ok) navigate('erp-permissions');
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

function renderEventPermissionsEditor(user) {
  const events = state.data.permissionEvents ?? [];
  const userHasAdminDefaults = expandRoles(user?.roles).includes('admin');
  const assigned = new Map(
    (state.data.eventUserPermissions ?? [])
      .filter((permission) => String(permission.user_id) === String(user.user_id))
      .map((permission) => [String(permission.event_id), permission])
  );

  const rows = events.length
    ? events.map((event) => {
      const permission = assigned.get(String(event.id)) ?? {};
      const searchText = normalizeSearchText([
        event.name,
        event.event_key,
        event.status,
        event.event_date,
      ].filter(Boolean).join(' '));

      return `
        <tr data-search-row data-search-text="${escapeAttr(searchText)}">
          <td class="db-event-permissions__event">
            <strong>${escapeHTML(event.name ?? event.event_key ?? 'Evento')}</strong>
            <small>${escapeHTML(event.event_key ?? '')} ${event.event_date ? `· ${formatDisplayDateOnly(event.event_date)}` : ''}</small>
          </td>
          ${EVENT_PERMISSION_FLAGS.map(([flag, label]) => `
            <td>
              <label class="db-checkbox-label">
                <input type="checkbox" name="${escapeAttr(`${event.id}:${flag}`)}" ${userHasAdminDefaults || permission[flag] ? 'checked' : ''} />
                <span>${escapeHTML(label)}</span>
              </label>
            </td>
          `).join('')}
        </tr>
      `;
    }).join('')
    : '<tr class="db-table__empty-row"><td colspan="5" class="db-empty">Sin eventos disponibles.</td></tr>';
  const eventPermissionSearch = tableSearchFor('js-event-permissions-body');

  return `
    <section class="db-event-permissions">
      <h3>Permisos por Evento</h3>
      <label class="db-field">
        <span>Buscar eventos</span>
        <input data-table-search data-table-target="js-event-permissions-body" data-table-count="js-event-permissions-count" placeholder="Buscar evento" value="${escapeAttr(eventPermissionSearch)}" />
        <small id="js-event-permissions-count" class="db-field__hint">${events.length} eventos visibles</small>
      </label>
      <div class="db-table-wrap db-event-permissions__table-wrap">
        <table class="db-table db-event-permissions__table" aria-label="Permisos por evento">
          <thead>
            <tr>
              <th scope="col">Evento</th>
              ${EVENT_PERMISSION_FLAGS.map(([, label]) => `<th scope="col">${escapeHTML(label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody id="js-event-permissions-body">${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

async function handleEventPermissionsSave(user, form) {
  if (!requireAdminMutation()) return false;
  if (!user?.user_id) {
    showToast('El usuario no tiene User ID operativo.', 'error');
    return false;
  }

  const events = state.data.permissionEvents ?? [];
  const existing = new Map(
    (state.data.eventUserPermissions ?? [])
      .filter((permission) => String(permission.user_id) === String(user.user_id))
      .map((permission) => [String(permission.event_id), permission])
  );

  for (const event of events) {
    const flags = Object.fromEntries(
      EVENT_PERMISSION_FLAGS.map(([flag]) => [
        flag,
        Boolean(form.querySelector(`input[name="${CSS.escape(`${event.id}:${flag}`)}"]`)?.checked),
      ])
    );
    const hasAny = Object.values(flags).some(Boolean);
    const current = existing.get(String(event.id));

    if (hasAny) {
      const { error } = await supabase
        .from('event_user_permissions')
        .upsert({
          event_id: event.id,
          user_id: user.user_id,
          ...flags,
        }, { onConflict: 'event_id,user_id' });

      if (error) {
        console.error('[HR] event permission upsert:', error);
        showToast('No se pudieron guardar permisos por evento.', 'error');
        return false;
      }
    } else if (current?.id) {
      const { error } = await supabase
        .from('event_user_permissions')
        .delete()
        .eq('id', current.id);

      if (error) {
        console.error('[HR] event permission delete:', error);
        showToast('No se pudieron quitar permisos por evento.', 'error');
        return false;
      }
    }
  }

  return true;
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
  overlay.className = 'db-modal';
  overlay.innerHTML = `
    <div class="db-modal__dialog db-modal__dialog--wide">
      <h2 class="db-modal__title">Editar usuario</h2>
      <form id="js-admin-user-edit-form" class="db-form db-modal__body">
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
          <small class="db-field__hint">Cambiar el email requiere confirmación del usuario. Se enruta via Edge Function.</small>
        </label>
        ${renderEventPermissionsEditor(user)}
        <div class="db-modal__actions">
          <button class="btn-primary" type="submit">Guardar</button>
          <button class="db-btn-secondary" type="button" id="js-admin-user-edit-cancel">Cancelar</button>
        </div>
        <div id="js-admin-user-edit-status" class="db-modal__status"></div>
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

    const profileOk = await handleAdminUserUpdate(
      user,
      newEmail,
      { display_name, username, whatsapp, avatar_url }
    );
    const eventPermissionsOk = profileOk
      ? await handleEventPermissionsSave(user, e.target)
      : false;

    submitBtn.disabled = false;
    if (profileOk && eventPermissionsOk) {
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
  persistAdminTableSearchFromDOM(tableName);
  const config = TABLE_EDITOR_CONFIG[tableName];

  if (!config) {
    showToast('Tabla no permitida.', 'error');
    return;
  }
  if (config.readOnly) {
    showToast('Esta vista es solo lectura.', 'info');
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

  const ok = await saveAdminTableRow(tableName, config, original, payload, { confirmUserId: true });
  if (ok) {
    showToast('Fila actualizada.', 'success');
    navigate('admin-table-editor');
  }
}

async function saveAdminTableRow(tableName, config, original, payload, options = {}) {
  if (tableName === 'users' && 'user_id' in payload && String(payload.user_id ?? '') !== String(original.user_id ?? '') && options.confirmUserId !== false) {
    const confirmed = window.confirm(
      `Advertencia: vas a cambiar el User ID operativo de este usuario.\n\nAnterior: ${original.user_id ?? '-'}\nNuevo: ${payload.user_id || '-'}\n\nEste campo conecta historial, sesiones, transacciones y membresias. Confirma solo si sabes que este cambio es intencional.`
    );

    if (!confirmed) return false;
  }

  // public.users.email must be updated through auth.users via the Edge Function.
  // The DB trigger then syncs auth.users.email → public.users.email automatically.
  if (tableName === 'users' && 'email' in payload) {
    const newEmail = payload.email ?? '';
    delete payload.email; // never write email directly to public.users

    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      showToast('El email no tiene un formato válido.', 'error');
      return false;
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
            user_id:      payload.user_id      ?? original.user_id     ?? null,
          },
        },
      });

      if (fnError) {
        console.error('[HR] table editor admin-update-user:', fnError);
        showToast(fnError.message || 'No se pudo actualizar el email. Revisa la Edge Function.', 'error');
        return false;
      }
    } catch (err) {
      console.error('[HR] table editor admin-update-user invoke:', err);
      showToast('Error al contactar la función de actualización de email.', 'error');
      return false;
    }

    // If there are no other fields left to update, we're done.
    if (Object.keys(payload).length === 0) {
      return true;
    }
  }

  // Update remaining non-email fields directly in public.users (or any other table).
  if (Object.keys(payload).length === 0) {
    return true;
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
    return false;
  }

  return true;
}

function adminRowLabel(row) {
  return row.display_name || row.username || row.email || row.concept || row.name || row.user_id || row.id || 'Fila';
}

function adminFieldLabel(config, field) {
  return config.pdfColumnLabels?.[field] ?? field;
}

function collectAdminTableFormChange(form, config) {
  const values = formValues(form);
  let original;
  try {
    original = JSON.parse(decodeURIComponent(values.original));
  } catch (err) {
    console.error('[HR] table editor original parse:', err);
    return null;
  }

  const payload = {};
  const changes = [];
  config.editableFields.forEach((field) => {
    if (!(field in values)) return;
    const beforeValue = original[field] ?? '';
    const afterValue = values[field] ?? '';
    if (String(beforeValue) === String(afterValue)) return;
    payload[field] = afterValue;
    changes.push({ field, beforeValue, afterValue });
  });

  if (!changes.length) return null;
  return { original, payload, changes };
}

async function handleAdminTableSaveAll() {
  if (!requireAdminMutation()) return;

  const tableName = state.data.adminTableName || setAdminTableName(readStoredAdminTableName());
  persistAdminTableSearchFromDOM(tableName);
  if (tableName === 'membership_dashboard') {
    await handleMembershipDashboardSaveAll();
    return;
  }

  const config = TABLE_EDITOR_CONFIG[tableName];

  if (!config) {
    showToast('Tabla no permitida.', 'error');
    return;
  }
  if (config.readOnly) {
    showToast('Esta vista es solo lectura.', 'info');
    return;
  }

  const forms = [...document.querySelectorAll('form[data-form="admin-table-update"]')];
  const pending = forms
    .map((form) => collectAdminTableFormChange(form, config))
    .filter(Boolean);

  if (!pending.length) {
    showToast('No hay cambios pendientes.', 'info');
    return;
  }

  const summary = pending.flatMap((item, index) => {
    const label = adminRowLabel(item.original);
    return item.changes.map((change) => {
      const beforeText = String(change.beforeValue || '-');
      const afterText = String(change.afterValue || '-');
      return `${index + 1}. ${label} - ${adminFieldLabel(config, change.field)}: ${beforeText} -> ${afterText}`;
    });
  });
  const extraCount = Math.max(0, summary.length - 18);
  const preview = summary.slice(0, 18).join('\n');
  const confirmed = window.confirm(
    `Vas a guardar ${pending.length} fila${pending.length === 1 ? '' : 's'} con ${summary.length} cambio${summary.length === 1 ? '' : 's'}:\n\n${preview}${extraCount ? `\n... y ${extraCount} cambio${extraCount === 1 ? '' : 's'} más.` : ''}\n\n¿Confirmas guardar estos cambios?`
  );

  if (!confirmed) return;

  for (const item of pending) {
    const ok = await saveAdminTableRow(tableName, config, item.original, { ...item.payload }, { confirmUserId: false });
    if (!ok) return;
  }

  showToast('Cambios guardados.', 'success');
  navigate('admin-table-editor');
}

function collectMembershipDeliveryFormChange(form) {
  const values = formValues(form);
  const beforeDeliveredAt = values.delivered_at_original ?? '';
  const afterDeliveredAt = values.delivered_at ?? '';
  const changes = [];

  if (String(beforeDeliveredAt) !== String(afterDeliveredAt)) {
    changes.push({
      field: 'Fecha de entrega',
      beforeValue: beforeDeliveredAt ? formatDisplayDateOnly(beforeDeliveredAt) : '-',
      afterValue: afterDeliveredAt ? formatDisplayDateOnly(afterDeliveredAt) : '-',
    });
  }

  if (!changes.length) return null;

  return {
    type: 'delivery',
    values,
    changes,
    label: `Ciclo ${values.cycle_number || '-'}`,
  };
}

function collectMembershipSessionNotesFormChange(form) {
  const values = formValues(form);
  const beforeNotes = values.notes_original ?? '';
  const afterNotes = values.notes ?? '';
  const changes = [];

  if (String(beforeNotes) !== String(afterNotes)) {
    changes.push({
      field: 'Notas de sesión',
      beforeValue: beforeNotes || '-',
      afterValue: afterNotes || '-',
    });
  }

  if (!changes.length) return null;

  return {
    type: 'session-notes',
    values,
    changes,
    label: `Sesión ${values.session_id || '-'}`,
  };
}

async function handleMembershipDashboardSaveAll() {
  if (!requireAdminMutation()) return;
  persistAdminTableSearchFromDOM('membership_dashboard');

  const deliveryForms = [...document.querySelectorAll('form[data-form="membership-delivery"][data-stay-section="admin-table-editor"]')];
  const sessionNotesForms = [...document.querySelectorAll('form[data-form="membership-session-notes"][data-stay-section="admin-table-editor"]')];
  const pending = [
    ...deliveryForms.map(collectMembershipDeliveryFormChange),
    ...sessionNotesForms.map(collectMembershipSessionNotesFormChange),
  ]
    .filter(Boolean);

  if (!pending.length) {
    showToast('No hay cambios pendientes.', 'info');
    return;
  }

  const invalid = pending.find((item) => item.type === 'delivery' && !item.values.delivered_at);
  if (invalid) {
    showToast('Fecha de entrega es obligatoria para guardar cambios de entrega.', 'error');
    return;
  }

  const summary = pending.flatMap((item, index) => item.changes.map((change) => (
    `${index + 1}. ${item.label} - ${change.field}: ${change.beforeValue} -> ${change.afterValue}`
  )));
  const extraCount = Math.max(0, summary.length - 18);
  const preview = summary.slice(0, 18).join('\n');
  const confirmed = window.confirm(
    `Vas a guardar ${pending.length} fila${pending.length === 1 ? '' : 's'} con ${summary.length} cambio${summary.length === 1 ? '' : 's'}:\n\n${preview}${extraCount ? `\n... y ${extraCount} cambio${extraCount === 1 ? '' : 's'} más.` : ''}\n\n¿Confirmas guardar estos cambios?`
  );

  if (!confirmed) return;

  for (const item of pending) {
    const ok = item.type === 'session-notes'
      ? await saveMembershipSessionNotesValues(item.values)
      : await saveMembershipDeliveryValues(item.values);
    if (!ok) return;
  }

  showToast('Cambios guardados.', 'success');
  navigate('admin-table-editor');
}

async function handleAdminTableDelete(tableName, encodedRow) {
  if (!requireAdminMutation()) return;
  persistAdminTableSearchFromDOM(tableName);

  const config = TABLE_EDITOR_CONFIG[tableName];
  if (!config) {
    showToast('Tabla no permitida.', 'error');
    return;
  }
  if (config.readOnly) {
    showToast('Esta vista es solo lectura.', 'info');
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
  const prefersConcept = tableName === 'transactions' || tableName === 'hr_transactions' || tableName === 'sessions';
  const readable = prefersConcept
    ? (original.concept || original.name || original.id || original.user_id || 'esta fila')
    : (original.display_name || original.username || original.concept || original.name || original.id || original.user_id || 'esta fila');
  const confirmed = window.confirm(
    `Advertencia: vas a eliminar permanentemente ${readable} de ${label}.\n\nEsta acción no se puede deshacer. ¿Confirmas la eliminación?`
  );

  if (!confirmed) return;

  if (tableName === 'users') {
    await handleAdminUserDelete(original);
    return;
  }

  let query = supabase.from(tableName).delete({ count: 'exact' });
  if (config.primaryKey) {
    query = query.eq(config.primaryKey, original[config.primaryKey]);
  } else if (original.id) {
    query = query.eq('id', original.id);
  } else {
    (config.matchFields ?? []).forEach((field) => {
      query = query.eq(field, original[field]);
    });
  }

  const { error, count } = await query;
  if (error) {
    console.error('[HR] table editor delete:', error);
    showToast('No se pudo eliminar la fila. Revisa RLS/permisos.', 'error');
    return;
  }

  if (count === 0) {
    console.warn('[HR] table editor delete affected 0 rows:', { tableName, original });
    showToast('No se eliminó ninguna fila. Revisa policies DELETE/RLS.', 'error');
    return;
  }

  showToast('Fila eliminada.', 'success');
  navigate('admin-table-editor');
}

async function handleAdminUserDelete(user) {
  try {
    const { data, error } = await supabase.functions.invoke('admin-delete-user', {
      body: {
        user_id: user.id ?? null,
      },
    });

    if (error) {
      console.error('[HR] admin-delete-user function:', error);
      showToast(error.message || 'No se pudo eliminar el usuario.', 'error');
      return;
    }

    if (data?.error || data?.success === false) {
      console.error('[HR] admin-delete-user:', data.error);
      showToast(data.error, 'error');
      return;
    }

    showToast('Usuario eliminado de Auth y BB.DD.', 'success');
    state.data.users = null;
    navigate('admin-table-editor');
  } catch (err) {
    console.error('[HR] admin-delete-user invoke:', err);
    showToast('Error al contactar la función de eliminación.', 'error');
  }
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

  const tableName = state.data.adminTableName || setAdminTableName(readStoredAdminTableName());
  const config = TABLE_EDITOR_CONFIG[tableName] || {};
  const configuredColumns = [...(config.lockedFields ?? []), ...(config.editableFields ?? [])]
    .filter((field, index, arr) => arr.indexOf(field) === index);
  const visibleColumns = configuredColumns.filter((field) => !(config.hiddenColumns ?? []).includes(field));
  const visibleHeaders = [...table.querySelectorAll('thead th')]
    .map((th) => th.textContent.trim())
    .filter((text) => text && text.toLowerCase() !== 'acciones');

  const visibleRows = [...table.querySelectorAll('tbody tr')]
    .filter((tr) => !tr.hidden && !tr.classList.contains('db-table__empty-row'))
    .map((tr) => [...tr.children]
      .slice(0, visibleHeaders.length)
      .map((td) => {
        const input = td.querySelector('input, textarea, select');
        return input ? input.value : td.textContent.trim();
      }));

  const pdfColumns = config.pdfColumns?.length
    ? config.pdfColumns.filter((field) => visibleColumns.includes(field))
    : visibleColumns;
  const columnIndexes = pdfColumns.map((field) => visibleColumns.indexOf(field));
  const headers = pdfColumns.map((field) => config.pdfColumnLabels?.[field] ?? field);
  const rows = visibleRows.map((row) => columnIndexes.map((index) => row[index] ?? '-'));

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
      styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak', valign: 'top' },
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
  const isCollabFinance = state.activeSection === 'collab-finance';
  if (!isCollabFinance && !requireAdminMutation()) return;
  if (isCollabFinance && !hasRole('admin') && !hasPermission('events.access')) {
    showToast('No tienes permiso para exportar finanzas de eventos.', 'error');
    return;
  }

  const rows = isCollabFinance ? (state.data.collabFinanceRows ?? []) : (state.data.erpFinanceRows ?? []);
  const filters = isCollabFinance
    ? (state.data.collabFinanceFilters ?? { ...getEventFinanceFilters(), scope: 'events', eventId: persistedDataValue('collabFinanceEventId', '') })
    : (state.data.erpFinanceFilters ?? getFinanceFilters());
  const events = isCollabFinance ? (state.data.collabFinanceEvents ?? []) : (state.data.financeEvents ?? []);
  const selectedEvent = isCollabFinance
    ? state.data.collabFinanceSelectedEvent
    : events.find((event) => String(event.id ?? event.event_id ?? event.event_key) === String(filters.eventId));
  const scopeLabel = filters.scope === 'events'
    ? (selectedEvent ? eventLabel(selectedEvent) : (filters.eventId || 'Todos los eventos'))
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
    const isEventFinance = filters.scope === 'events';
    const amountGetter = isEventFinance ? eventFinanceAmount : transactionAmount;
    const { ingresos, egresos, balance, hasExplicitIncomeExpense } = financeTotals(rows, amountGetter, {
      balanceFromAmountWhenNoIncomeExpense: isEventFinance,
    });
    const showIncomeExpenseAsNE = isEventFinance && !hasExplicitIncomeExpense;

    doc.setFontSize(16);
    doc.text('Hidden Room - Finanzas', 40, 40);
    doc.setFontSize(10);
    doc.text(`Generado: ${generatedAt}`, 40, 58);
    doc.text(`Origen: ${filters.scope === 'events' ? 'Eventos' : 'Estudio'} / ${scopeLabel}`, 40, 74);
    doc.text(`Periodo: ${financePeriodLabel(filters)} - Tipo: ${filters.type}`, 40, 90);
    doc.text(`Ingresos: ${showIncomeExpenseAsNE ? 'NE' : money(ingresos)}   Egresos: ${showIncomeExpenseAsNE ? 'NE' : money(egresos)}   Balance: ${money(balance)}`, 40, 106);

    doc.autoTable({
      head: [isEventFinance
        ? ['Concepto', 'Tipo', 'Monto', 'M.A.I.', 'FROM', 'TO', 'Corresponde a', 'Fecha', 'Metodo', 'Creado por', 'Notas']
        : ['Concepto', 'Tipo', 'Monto', 'Fecha', 'Status', 'Cliente']],
      body: rows.map((tx) => isEventFinance
        ? [
          tx.concept ?? '-',
          movementTypeLabel(tx.movement_type) || tx.type || '-',
          money(Number(tx.amount ?? 0)),
          money(Number(tx.hidden_room_share ?? eventFinanceAmount(tx) ?? 0)),
          participantName(tx.from_user_id),
          participantName(tx.to_user_id),
          financeEntityName(tx.owner_entity_id, tx.owner_user_id),
          formatDisplayDateOnly(tx.movement_date ?? tx.date),
          tx.payment_method ?? tx.via ?? '-',
          tx.created_by_user_id ?? '-',
          tx.notes ?? '-',
        ]
        : [
          tx.concept ?? '-',
          tx.type ?? '-',
          money(Number(tx.amount ?? 0)),
          formatDisplayDateOnly(tx.date),
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
  else setTableSearch(input, query);

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

function applyAuthAuditFilter(filter = 'all') {
  document.querySelectorAll('[data-auth-audit-groups]').forEach((block) => {
    const groups = String(block.dataset.authAuditGroups ?? '').split(/\s+/).filter(Boolean);
    block.hidden = filter !== 'all' && !groups.includes(filter);
  });
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

function enhancePasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-password-toggle-ready]), input[type="text"][data-password-visible="true"]:not([data-password-toggle-ready])').forEach((input) => {
    input.dataset.passwordToggleReady = 'true';
    const wrapper = document.createElement('div');
    wrapper.className = 'db-password-field';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'db-password-toggle';
    button.dataset.action = 'toggle-password';
    button.setAttribute('aria-label', 'Ver contrasena');
    button.innerHTML = '<span class="password-eye" aria-hidden="true"></span>';
    wrapper.appendChild(button);
  });
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
    const passwordToggle = e.target.closest('[data-action="toggle-password"]');
    if (passwordToggle) {
      const input = passwordToggle.closest('.db-password-field')?.querySelector('input');
      if (input) {
        const visible = input.type === 'text';
        input.type = visible ? 'password' : 'text';
        input.dataset.passwordVisible = visible ? 'false' : 'true';
        passwordToggle.innerHTML = '<span class="password-eye" aria-hidden="true"></span>';
        passwordToggle.setAttribute('aria-label', visible ? 'Ver contrasena' : 'Ocultar contrasena');
      }
      return;
    }

    const qa = e.target.closest('.db-quick-action[data-section], .db-profile-action[data-section]');
    if (qa) {
      navigate(qa.dataset.section);
    }

    const userOption = e.target.closest('.db-user-option[data-user-value]');
    if (userOption) {
      const picker = userOption.closest('.db-user-picker');
      const hidden = picker?.querySelector('input[type="hidden"]');
      const search = picker?.querySelector('[data-user-search]');
      const user = (state.data.users ?? []).find((u) => String(u.user_id) === String(userOption.dataset.userId));
      if (hidden) hidden.value = userOption.dataset.userValue ?? '';
      if (search) search.value = userOption.dataset.userDisplay || userLabel(userOption.dataset.userId);
      syncUserAutofillFields(picker, user);
      picker?.querySelector('.db-user-picker__menu')?.setAttribute('hidden', '');
      picker?.querySelectorAll('.db-user-option').forEach((option) => {
        option.hidden = false;
        option.style.display = '';
      });
      if (user) search?.setAttribute('aria-label', usernameLabel(user));
      if (picker?.dataset.membershipUserPicker === 'true') {
        setAdminTableSearch('membership_dashboard', hidden?.value || '');
        navigate('admin-table-editor');
        return;
      }
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

    if (action === 'refresh-session') {
      handleRefreshSession();
    }

    if (action === 'table-sort') {
      const btn = e.target.closest('[data-table-id][data-sort-field]');
      if (btn) {
        persistAdminTableSearchFromDOM();
        setTableSort(btn.dataset.tableId, btn.dataset.sortField);
        navigate(state.activeSection);
      }
    }

    if (action === 'export-admin-pdf') {
      handleAdminPdfExport(e.target.closest('[data-table-label]')?.dataset.tableLabel);
    }

    if (action === 'admin-table-save-all') {
      handleAdminTableSaveAll();
    }

    if (action === 'export-finance-pdf') {
      handleFinancePdfExport();
    }

    if (action === 'event-movement-edit') {
      const btn = e.target.closest('[data-event-movement]');
      if (btn?.dataset.eventMovement) handleEventMovementEdit(btn.dataset.eventMovement);
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
      persistAdminTableSearchFromDOM();
      setAdminTableName(tableSelect.value);
      navigate('admin-table-editor');
      return;
    }

    const membershipTableSearch = e.target.closest('input[data-table-search][data-admin-table-name="membership_dashboard"]');
    if (membershipTableSearch) {
      setAdminTableSearch('membership_dashboard', membershipTableSearch.value.trim());
      navigate('admin-table-editor');
      return;
    }

    const scrumEvent = e.target.closest('select[data-action="scrum-event-change"]');
    if (scrumEvent) {
      setPersistedDataValue('scrumEventId', scrumEvent.value);
      navigate('collab-tasks');
      return;
    }

    const financeFilter = e.target.closest('select[data-action="finance-filter"]');
    if (financeFilter) {
      setPersistedDataValue(financeFilter.dataset.filterKey, financeFilter.value);
      if (financeFilter.dataset.filterKey === 'financeScope') {
        if (financeFilter.value === 'studio' && !persistedDataValue('financeStudio', '')) {
          setPersistedDataValue('financeStudio', 'IXT');
        }
      }
      navigate(state.activeSection);
      return;
    }

    const collabFinanceEvent = e.target.closest('select[data-action="collab-finance-event"]');
    if (collabFinanceEvent) {
      setPersistedDataValue('collabFinanceEventId', collabFinanceEvent.value);
      navigate('collab-finance');
      return;
    }

    const opsForm = e.target.closest('select[data-action="erp-ops-form"]');
    if (opsForm) {
      setPersistedDataValue('erpOpsForm', opsForm.value);
      navigate('erp-ops');
      return;
    }

    const authAuditFilter = e.target.closest('select[data-action="auth-audit-filter"]');
    if (authAuditFilter) {
      setPersistedDataValue('authAuditFilter', authAuditFilter.value);
      applyAuthAuditFilter(authAuditFilter.value);
      return;
    }

    const sessionField = e.target.closest('[data-session-type], [data-session-start]');
    if (sessionField) {
      updateSessionDerivedFields(sessionField.closest('form'));
      return;
    }

    const transactionField = e.target.closest('[data-transaction-service], [data-transaction-concept]');
    if (transactionField) {
      updateTransactionConceptFields(transactionField.closest('form'));
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

    const transactionField = e.target.closest('[data-transaction-service], [data-transaction-concept]');
    if (transactionField) {
      updateTransactionConceptFields(transactionField.closest('form'));
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
    form.dataset.operationAction = e.submitter?.dataset.operationAction || 'create';

    if (form.dataset.form === 'task-create') handleTaskCreate(form);
    if (form.dataset.form === 'task-update') handleTaskUpdate(form);
    if (form.dataset.form === 'account-update') handleAccountUpdate(form);
    if (form.dataset.form === 'permission-add') handlePermissionAdd(form);
    if (form.dataset.form === 'admin-table-update') handleAdminTableUpdate(form);
    if (form.dataset.form === 'user-merge') handleErpForm(form);
    if (form.dataset.form === 'membership-cancel') handleErpForm(form);
    if (form.dataset.form === 'membership-delivery') handleErpForm(form);
    if (form.dataset.form === 'membership-session-notes') handleErpForm(form);
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
          <input id="js-ob-email" type="email" autocomplete="email" placeholder="Nombre@ejemplo.com" required />
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
          <input id="js-ob-password" type="password" autocomplete="new-password" placeholder="Nueva contraseña" required />
        </label>
        <label class="db-field" style="margin-top:10px;">
          <span>Confirmar contraseña</span>
          <input id="js-ob-password-confirm" type="password" autocomplete="new-password" placeholder="Confirmar contraseña" required />
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
    enhancePasswordToggles(overlay);

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
  attachRoutePersistenceListener();

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

  navigate(initialSectionKey());
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
