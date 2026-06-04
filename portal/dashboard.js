/**
 * ================================================================
 *  HIDDEN ROOM / MYSAUTH â€” Dashboard Controller
 *  portal/dashboard.js
 * ================================================================
 *  Architecture: lightweight SPA router over a static HTML shell.
 *  No framework. No build step. Vanilla ES modules.
 *
 *  Responsibilities:
 *    1. Session bootstrap (Supabase auth)
 *    2. Role-composable sidebar gating  â† cumulative hierarchy
 *    3. Client-side section router (hash-free, state-driven)
 *    4. Per-module render functions (one per section)
 *    5. Notification + toast system
 *    6. Global state object  â† single source of truth
 * ================================================================
 */

'use strict';


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§1  SUPABASE CLIENT
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§2  GLOBAL STATE
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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
};

/**
 * Immutable-ish state update.
 * @param {Partial<typeof state>} patch
 */
function setState(patch) {
  Object.assign(state, patch);
}


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§3  ROLE ENGINE
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Hierarchy (cumulative, bottom roles inherit all above):
     client = 1
     pr     = 2
     collaborator = 3
     partner = 4
     admin  = 5
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/** Ordered hierarchy â€” index = level (0-based, lower = less access) */
const ROLE_HIERARCHY = ['client', 'pr', 'collaborator', 'partner', 'admin'];

/**
 * Takes the raw roles string from public.users.roles (e.g. "client,pr" or
 * "collaborator") and returns the full cumulative set of roles the user has.
 *
 * Examples:
 *   expandRoles("admin")       â†’ ['client','pr','collaborator','partner','admin']
 *   expandRoles("collaborator") â†’ ['client','pr','collaborator']
 *   expandRoles("client,pr")   â†’ ['client','pr']   (already cumulative, safe)
 *   expandRoles("client")      â†’ ['client']
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
 * Returns true if the user has the given role (cumulative â€” higher roles
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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§4  SECTION REGISTRY
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Maps section key â†’ { label, roleRequired, render }
   roleRequired uses the cumulative hasRole() check.
   render() is always treated as async â€” may return a string or
   a Promise<string>. renderSection() awaits it either way.
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

const SECTIONS = {

  /* â”€â”€ CORE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  overview: {
    label: 'Overview',
    roleRequired: null,
    render: renderOverview,
  },

  /* â”€â”€ CLIENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  /* â”€â”€ COLLABORATOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  'collab-docs': {
    label: 'Documentos',
    roleRequired: 'collaborator',
    render: renderCollabDocs,
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

  /* â”€â”€ MEDIA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  'media-posts': {
    label: 'Posts / Vlog',
    roleRequired: null,
    permissionRequired: 'media.posts',
    render: renderMediaPosts,
  },

  /* â”€â”€ RRPP (pr role) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  'rrpp-contacts': {
    label: 'Contactos',
    roleRequired: 'pr',
    render: renderRrppContacts,
  },
  'rrpp-invitations': {
    label: 'Invitaciones',
    roleRequired: 'pr',
    render: renderRrppInvitations,
  },
  'rrpp-campaigns': {
    label: 'CampaÃ±as',
    roleRequired: 'pr',
    render: renderRrppCampaigns,
  },
  'rrpp-guestlist': {
    label: 'Guest Lists',
    roleRequired: 'pr',
    render: renderRrppGuestlist,
  },
  'rrpp-benefits': {
    label: 'Beneficios',
    roleRequired: 'pr',
    render: renderRrppBenefits,
  },

  /* â”€â”€ ERP / ADMIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
};

const SCRUM_COLUMNS = [
  { key: 'todo', label: 'Todo' },
  { key: 'in_progress', label: 'En progreso' },
  { key: 'review', label: 'Revision' },
  { key: 'done', label: 'Hecho' },
];

const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const AVAILABLE_ROLES = ['client', 'pr', 'collaborator', 'partner', 'admin'];
const SUGGESTED_PERMISSIONS = [
  'scrum.view',
  'scrum.edit',
  'erp.finance.input',
  'erp.ops.input',
  'media.posts',
  'rrpp.manage',
];

const userLabel = (userId) => {
  const user = (state.data.users ?? []).find((u) => String(u.user_id) === String(userId));
  if (!user) return userId ? `ID ${userId}` : 'Sin asignar';
  return user.display_name || user.username || user.email || user.user_id;
};

const usernameLabel = (user) => user?.username ? `@${user.username}` : '@sin_username';


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§5  SESSION BOOTSTRAP
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Auth flow:
     1. supabase.auth.getUser()  â†’ auth user (auth.users.id)
     2. public.users WHERE id = auth.id  â†’ full profile
     3. public.users.user_id  â†’ internal operational ID used in
        transactions / sessions / downloads / contracts / scores
     4. user_permissions WHERE user_id = auth.id  â†’ permission keys
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/**
 * Loads session from Supabase auth, fetches the public profile and
 * permissions, expands roles cumulatively.
 * @returns {Promise<{user:Object, roles:string[], permissions:string[]}|null>}
 */
async function bootstrapSession() {
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) return null;

    // Fetch public profile â€” join key is public.users.id = auth.users.id
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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§6  ROUTER
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   navigate() is sync: updates state + sidebar immediately, then
   calls renderSection() which is async and awaits render().
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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

  // Permission guard â€” uses cumulative hasRole()
  if (section.roleRequired && !hasRole(section.roleRequired)) {
    showToast('Acceso no autorizado para este mÃ³dulo.', 'error');
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

  if (skeleton) skeleton.hidden = true;

  wrap.classList.remove('db-section-wrap--visible');

  // Await the render â€” works whether the function is sync or async
  const html = await section.render();

  wrap.innerHTML = html;

  // Trigger reveal after paint
  requestAnimationFrame(() => {
    wrap.classList.add('db-section-wrap--visible');
  });
}


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§7  TOPBAR HELPERS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function hydrateTopbar() {
  const nameEl   = document.getElementById('js-user-display-name');
  const avatarEl = document.getElementById('js-user-avatar');

  if (!state.user) return;

  if (nameEl)   nameEl.textContent  = state.user.display_name ?? state.user.email ?? 'â€”';
  if (avatarEl) avatarEl.textContent = (state.user.display_name ?? state.user.email ?? '?')[0].toUpperCase();
}

/** @param {string} label */
function updateTopbarTitle(label) {
  const el = document.getElementById('js-topbar-section');
  if (el) el.textContent = label;
}


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§8  SIDEBAR HELPERS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§9  NOTIFICATIONS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

async function fetchNotifications() {
  // Placeholder â€” wire to a notifications table when available
  return [
    { id: 'n1', message: 'Tu sesiÃ³n del Viernes fue confirmada.', type: 'success', ts: Date.now() - 3600_000,  read: false },
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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§10  TOAST SYSTEM
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§11  USER MENU
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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
    if (action === 'settings') showToast('Ajustes disponibles prÃ³ximamente.', 'info');

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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§12  SECTION RENDERERS
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Async renderers return Promise<string>.
   Sync renderers return string.
   renderSection() handles both via await.
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

/* â”€â”€ OVERVIEW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
        <h1 class="db-section__title" id="section-overview-title">Overview</h1>
      </header>

      <div class="db-grid db-grid--2col">

        <article class="db-card db-card--profile" aria-label="Perfil de usuario">
          <div class="db-card__inner">
            <div class="db-profile__avatar" aria-hidden="true">
              ${escapeHTML((user?.display_name ?? user?.email ?? '?')[0].toUpperCase())}
            </div>
            <div class="db-profile__info">
              <h2 class="db-profile__name">${escapeHTML(user?.display_name ?? 'â€”')}</h2>
              <dl class="db-profile__meta">
                <div class="db-profile__row">
                  <dt>ID</dt>
                  <dd>${escapeHTML(String(user?.user_id ?? 'â€”'))}</dd>
                </div>
                <div class="db-profile__row">
                  <dt>Email</dt>
                  <dd>${escapeHTML(user?.email ?? 'â€”')}</dd>
                </div>
                <div class="db-profile__row">
                  <dt>WhatsApp</dt>
                  <dd>${escapeHTML(user?.whatsapp ?? 'â€”')}</dd>
                </div>
              </dl>
              <div class="db-profile__roles" aria-label="Roles activos">
                ${roleBadges}
              </div>
            </div>
          </div>
        </article>

        <article class="db-card" aria-label="Acciones rÃ¡pidas">
          <header class="db-card__header">
            <span class="section-label">Acciones rÃ¡pidas</span>
          </header>
          <div class="db-card__inner">
            <div class="db-quick-actions">
              ${quickActions}
            </div>
          </div>
        </article>

      </div>

      <div class="db-stats-row" id="js-overview-stats" aria-label="EstadÃ­sticas">
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
  if (roles.includes('pr')) {
    actions.push({ label: 'Guest List',        section: 'rrpp-guestlist'      });
  }
  if (roles.includes('collaborator')) {
    actions.push({ label: 'Ver Tareas',        section: 'collab-tasks'        });
  }
  if (hasPermission('media.posts')) {
    actions.push({ label: 'Gestionar Posts',   section: 'media-posts'         });
  }

  if (actions.length === 0) {
    return `<p class="db-empty">Sin acciones disponibles para tus roles actuales.</p>`;
  }

  return actions.map((a) => `
    <button class="db-quick-action" data-section="${escapeHTML(a.section)}">
      ${escapeHTML(a.label)}
      <span class="db-quick-action__arrow" aria-hidden="true">â†’</span>
    </button>
  `).join('');
}

function renderStatsSkeleton() {
  return ['â€”', 'â€”', 'â€”'].map(() => `
    <div class="db-stat-card">
      <span class="db-stat-card__value">â€”</span>
      <span class="db-stat-card__label">Cargandoâ€¦</span>
    </div>
  `).join('');
}


/* â”€â”€ CLIENT: DOWNLOADS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
        <td>${escapeHTML(p.name ?? 'â€”')}</td>
        <td>${escapeHTML(p.type ?? 'â€”')}</td>
        <td>${escapeHTML(p.notes ?? 'â€”')}</td>
        <td>
          ${p.storage_path
            ? `<a class="btn-primary" href="${escapeHTML(p.storage_path)}" target="_blank" rel="noopener noreferrer">Descargar</a>`
            : 'â€”'}
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
              <th scope="col">AcciÃ³n</th>
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


/* â”€â”€ CLIENT: SESSIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
        <td>${escapeHTML(s.concept ?? 'â€”')}</td>
        <td>${s.session_date ? new Date(s.session_date).toLocaleDateString('es-MX') : 'â€”'}</td>
        <td>${escapeHTML(s.status ?? 'â€”')}</td>
        <td>${escapeHTML(s.cost != null ? `$${s.cost}` : 'â€”')}</td>
        <td>${escapeHTML(s.notes ?? 'â€”')}</td>
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


/* â”€â”€ CLIENT: TRANSACTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
        <td>${escapeHTML(tx.concept ?? 'â€”')}</td>
        <td>${escapeHTML(tx.type ?? 'â€”')}</td>
        <td>$${escapeHTML(String(tx.amount ?? 0))}</td>
        <td>${tx.date ? new Date(tx.date).toLocaleDateString('es-MX') : 'â€”'}</td>
        <td>${escapeHTML(tx.via ?? 'â€”')}</td>
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
              <th scope="col">VÃ­a</th>
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


/* â”€â”€ CLIENT: CONTRACTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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


/* â”€â”€ CLIENT: TICKETS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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


/* â”€â”€ CLIENT: STORE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderClientStore() {
  return `
    <section class="db-section" aria-labelledby="title-store">
      <header class="db-section__header">
        <p class="section-label">Cliente</p>
        <h1 class="db-section__title" id="title-store">Tienda Online â€” Pedidos</h1>
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


/* â”€â”€ CLIENT: REWARDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function renderClientRewards() {
  const { data, error } = await supabase
    .from('scores')
    .select('*')
    .eq('user_id', state.user.user_id);

  if (error) {
    console.error('[HR] renderClientRewards:', error);
    return `
      <section class="db-section" aria-labelledby="title-rewards">
        <header class="db-section__header">
          <p class="section-label">Cliente</p>
          <h1 class="db-section__title" id="title-rewards">Rewards</h1>
        </header>
        <p class="db-empty db-empty--error">Error al cargar rewards. Intenta de nuevo.</p>
      </section>
    `;
  }

  let scoresHTML;

  if (!data || data.length === 0) {
    scoresHTML = '<p class="db-empty">Sin partidas registradas.</p>';
  } else {
    scoresHTML = `
      <ul class="db-card-list" role="list">
        ${data.map((s) => `
          <li class="db-card-list__item">
            <span class="db-card-list__label">${escapeHTML(s.game_id ?? 'â€”')}</span>
            <span class="db-card-list__value">${escapeHTML(s.type ?? '')} ${escapeHTML(String(s.amount ?? 0))} pts</span>
          </li>
        `).join('')}
      </ul>
    `;
  }

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
            ${scoresHTML}
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


/* â”€â”€ COLLABORATOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderCollabDocs() {
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

async function renderCollabTasks() {
  if (!hasPermission('scrum.view')) {
    return sectionShell('Colaborador', 'SCRUM / Tareas', 'title-tasks', `
      <p class="db-empty db-empty--error">No tienes permiso para ver este modulo.</p>
    `);
  }

  const editable = canEditScrum();
  const [{ data: users, error: usersError }, { data: tasks, error: tasksError }] = await Promise.all([
    supabase
      .from('users')
      .select('user_id, display_name, username, email')
      .order('display_name', { ascending: true }),
    supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false }),
  ]);

  if (usersError || tasksError) {
    console.error('[HR] renderCollabTasks:', usersError || tasksError);
    return sectionShell('Colaborador', 'SCRUM / Tareas', 'title-tasks', `
      <p class="db-empty db-empty--error">Error al cargar tareas. Intenta de nuevo.</p>
    `);
  }

  state.data.users = users ?? [];
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
  const selected = (state.data.users ?? []).find((u) => String(u.user_id) === String(value));
  const displayValue = selected ? userLabel(selected.user_id) : '';
  const inputId = `user-picker-${escapeAttr(name)}-${Math.random().toString(36).slice(2, 8)}`;
  const options = (state.data.users ?? []).map((user) => `
    <button class="db-user-option" type="button" data-user-id="${escapeHTML(String(user.user_id))}">
      <span>${escapeHTML(user.display_name || user.email || user.user_id)}</span>
      <small>${escapeHTML(usernameLabel(user))}</small>
    </button>
  `).join('');

  return `
    <div class="db-field db-user-picker">
      <label for="${inputId}">${escapeHTML(label)}</label>
      <input id="${inputId}" data-user-search autocomplete="off" placeholder="Buscar usuario" value="${escapeAttr(displayValue)}" />
      <input type="hidden" name="${escapeHTML(name)}" value="${escapeAttr(value)}" />
      <div class="db-user-picker__menu" hidden>${options}</div>
    </div>
  `;
}

function renderErpUserPicker(name, label) {
  if (!state.data.users) return '';
  return renderUserPicker(name, label, '');
}

function optionHTML(value, label, selectedValue) {
  return `<option value="${escapeHTML(value)}"${String(value) === String(selectedValue) ? ' selected' : ''}>${escapeHTML(label)}</option>`;
}


/* â”€â”€ MEDIA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderMediaPosts() {
  return `
    <section class="db-section" aria-labelledby="title-media">
      <header class="db-section__header">
        <p class="section-label">Media</p>
        <h1 class="db-section__title" id="title-media">Posts / Vlog</h1>
        <button class="btn-primary db-section__cta" id="js-media-new">+ Nuevo Post</button>
      </header>
      <div class="db-table-wrap">
        <table class="db-table" aria-label="GestiÃ³n de posts">
          <thead>
            <tr>
              <th scope="col">TÃ­tulo</th>
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


/* â”€â”€ RRPP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function renderRrppContacts() {
  return sectionShell('Relaciones PÃºblicas', 'Contactos', 'title-rrpp-contacts', `
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
  return sectionShell('Relaciones PÃºblicas', 'Invitaciones', 'title-rrpp-inv', `
    <p class="db-empty">Sin invitaciones registradas.</p>
  `);
}

function renderRrppCampaigns() {
  return sectionShell('Relaciones PÃºblicas', 'CampaÃ±as', 'title-rrpp-camp', `
    <p class="db-empty">Sin campaÃ±as activas.</p>
  `);
}

function renderRrppGuestlist() {
  return sectionShell('Relaciones PÃºblicas', 'Guest Lists', 'title-rrpp-guest', `
    <p class="db-empty">Sin guest lists disponibles.</p>
  `);
}

function renderRrppBenefits() {
  return sectionShell('Relaciones PÃºblicas', 'Beneficios', 'title-rrpp-benefits', `
    <p class="db-empty">Sin beneficios registrados.</p>
  `);
}


/* â”€â”€ ERP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function renderErpFinance() {
  await ensureUsersLoaded();
  return sectionShell('ERP', 'Finanzas', 'title-erp-finance', `
    <div class="db-admin-grid">
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Transaccion</span></header>
        <div class="db-card__inner">
          <form class="db-form" data-form="transaction-create">
            ${renderErpUserPicker('user_id', 'Usuario')}
            <div class="db-form__row">
              <label class="db-field"><span>Tipo</span><input name="type" required placeholder="income / expense" /></label>
              <label class="db-field"><span>Monto</span><input name="amount" type="number" step="0.01" required /></label>
            </div>
            <label class="db-field"><span>Concepto</span><input name="concept" required /></label>
            <div class="db-form__row">
              <label class="db-field"><span>Fecha</span><input name="date" type="date" required /></label>
              <label class="db-field"><span>Via</span><input name="via" placeholder="cash / transfer / card" /></label>
            </div>
            <label class="db-field"><span>ID transaccion</span><input name="id_trans" /></label>
            <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
            <button class="btn-primary" type="submit">Crear transaccion</button>
          </form>
        </div>
      </article>
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Score</span></header>
        <div class="db-card__inner">
          <form class="db-form" data-form="score-create">
            ${renderErpUserPicker('user_id', 'Usuario')}
            <label class="db-field"><span>Juego</span><input name="game_id" required /></label>
            <div class="db-form__row">
              <label class="db-field"><span>Tipo</span><input name="type" required placeholder="points / reward" /></label>
              <label class="db-field"><span>Cantidad</span><input name="amount" type="number" required /></label>
            </div>
            <button class="btn-primary" type="submit">Crear score</button>
          </form>
        </div>
      </article>
    </div>
  `);
}

async function renderErpOps() {
  await ensureUsersLoaded();
  return sectionShell('ERP', 'Operaciones', 'title-erp-ops', `
    <div class="db-admin-grid">
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Sesion</span></header>
        <div class="db-card__inner">
          <form class="db-form" data-form="session-create">
            ${renderErpUserPicker('user_id', 'Usuario')}
            <div class="db-form__row">
              <label class="db-field"><span>Fecha</span><input name="session_date" type="date" required /></label>
              <label class="db-field"><span>Hora</span><input name="hour" type="time" /></label>
            </div>
            <label class="db-field"><span>Concepto</span><input name="concept" required /></label>
            <div class="db-form__row">
              <label class="db-field"><span>Status</span><input name="status" placeholder="scheduled" /></label>
              <label class="db-field"><span>Tipo</span><input name="type" /></label>
            </div>
            <div class="db-form__row">
              <label class="db-field"><span>Inicio</span><input name="start" type="time" /></label>
              <label class="db-field"><span>Fin</span><input name="end" type="time" /></label>
            </div>
            <div class="db-form__row">
              <label class="db-field"><span>Costo</span><input name="cost" type="number" step="0.01" /></label>
              <label class="db-field"><span>Promo</span><input name="promo" /></label>
            </div>
            <label class="db-field"><span>Asistencia</span><input name="assistance" /></label>
            <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
            <button class="btn-primary" type="submit">Crear sesion</button>
          </form>
        </div>
      </article>
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Descarga</span></header>
        <div class="db-card__inner">
          <form class="db-form" data-form="download-create">
            ${renderErpUserPicker('user_id', 'Usuario')}
            <label class="db-field"><span>Nombre</span><input name="name" required /></label>
            <label class="db-field"><span>Ruta storage</span><input name="storage_path" required /></label>
            <label class="db-field"><span>Tipo</span><input name="type" /></label>
            <label class="db-field"><span>Notas</span><textarea name="notes" rows="3"></textarea></label>
            <button class="btn-primary" type="submit">Crear descarga</button>
          </form>
        </div>
      </article>
      <article class="db-card">
        <header class="db-card__header"><span class="section-label">Contrato</span></header>
        <div class="db-card__inner">
          <form class="db-form" data-form="contract-create">
            ${renderErpUserPicker('user_id', 'Usuario')}
            <label class="db-field"><span>Contrato</span><input name="contract" required placeholder="URL o ruta" /></label>
            <button class="btn-primary" type="submit">Crear contrato</button>
          </form>
        </div>
      </article>
    </div>
  `);
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
        <tbody>${rows}</tbody>
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

  return `
    <tr data-user-uuid="${escapeHTML(String(user.id))}">
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
      </td>
    </tr>
  `;
}


/* â”€â”€ RENDER HELPER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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

  state.data.users = data ?? [];
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

  const map = {
    'transaction-create': ['transactions', withTargetUsername(values), 'Transaccion creada.'],
    'score-create': ['scores', values, 'Score creado.'],
    'session-create': ['sessions', withTargetUsername(values), 'Sesion creada.'],
    'download-create': ['downloads', values, 'Descarga creada.'],
    'contract-create': ['contracts', values, 'Contrato creado.'],
  };

  const config = map[type];
  if (!config) return;

  const ok = await insertRow(config[0], config[1], config[2]);
  if (ok) form.reset();
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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§13  UTILITY FUNCTIONS
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§14  EVENT DELEGATION â€” MAIN AREA
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function attachMainDelegation() {
  const main = document.getElementById('js-main');

  main?.addEventListener('click', (e) => {
    const qa = e.target.closest('.db-quick-action[data-section]');
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
      picker?.querySelector('.db-user-picker__menu')?.setAttribute('hidden', '');
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
  });

  main?.addEventListener('input', (e) => {
    const search = e.target.closest('[data-user-search]');
    if (!search) return;

    const picker = search.closest('.db-user-picker');
    const menu = picker?.querySelector('.db-user-picker__menu');
    const hidden = picker?.querySelector('input[type="hidden"]');
    const query = search.value.trim().toLowerCase();

    if (hidden) hidden.value = '';
    if (!menu) return;

    menu.hidden = false;
    menu.querySelectorAll('.db-user-option').forEach((option) => {
      const text = option.textContent.toLowerCase();
      option.hidden = query ? !text.includes(query) : false;
    });
  });

  main?.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;

    e.preventDefault();

    if (form.dataset.form === 'task-create') handleTaskCreate(form);
    if (form.dataset.form === 'task-update') handleTaskUpdate(form);
    if (form.dataset.form === 'permission-add') handlePermissionAdd(form);
    if (form.dataset.form?.endsWith('-create') && !form.dataset.form.startsWith('task-')) {
      handleErpForm(form);
    }
  });
}


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§15  INIT
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

async function init() {
  const session = await bootstrapSession();

  if (!session) {
    window.location.href = './index.html';
    return;
  }

  setState({
    user:        session.user,
    roles:       session.roles,
    permissions: session.permissions,
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


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Â§16  PUBLIC API
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
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

