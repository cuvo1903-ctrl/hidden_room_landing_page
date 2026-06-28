---
name: hiddenroom-dashboard
description: Hidden Room Portal dashboard skill for the vanilla SPA in portal/dashboard.js and dashboard.html. Use when changing role-gated navigation, dashboard sections, admin tables, notifications, toasts, user/profile flows, ERP views, memberships, cloud file manager UI, or dashboard Supabase queries.
---

# Hidden Room Dashboard

## Workflow

1. Read the relevant section in `portal/dashboard.js`; it is organized as a single controller with numbered sections.
2. Preserve the global `state` object as the source of truth for loaded data and active UI state.
3. Keep navigation permission gates cumulative and role-aware.
4. Add new views through existing render/bind/load patterns instead of introducing a second router.
5. Preserve IDs, `data-*` hooks, table column names, and Supabase field names unless a migration updates them.
6. Validate with `node --check portal/dashboard.js` and inspect `/portal/dashboard.html`.

## Architecture

`portal/dashboard.js` is a lightweight SPA over a static HTML shell:

- Supabase session bootstrap.
- Role-composable sidebar gating.
- Client-side section router.
- Per-section render functions.
- Notification/toast system.
- Dashboard preferences in local storage.
- ERP finance, memberships, tasks, cloud manager, profile, scores, and admin data views.

## Permissions

Use roles from `users.roles` and fine-grained rows from `user_permissions`. Keep admin as the strongest role, but use existing permission keys for scoped abilities such as media or scrum behavior.

## References

Read `references/dashboard-sections.md` before changing section routing, permission gates, or ERP views.
