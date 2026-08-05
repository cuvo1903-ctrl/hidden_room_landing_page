# ERP Model

## Tables and Concepts

- `events`: event catalog with `event_key`, name, date, status.
- `hr_transactions`: finance rows linked to events and event keys.
- `event_user_permissions`: per-event booleans such as `can_view`, `can_add_finance`, `can_edit_finance`, `can_view_scrum`, `can_edit_scrum`.
- `event_counterparties`: people/entities participating in events.
- `event_participations`: percentages and roles for counterparties.
- `tasks`: scrum/operations tasks guarded by role or permission key.
- `sessions`, `contracts`, `downloads`, `scores`, `notifications`: client and member operational data.
- Store/media/tickets may surface in dashboard but keep their own module rules.

## Option Strings

Dashboard constants include:

- Transaction types: `INGRESO`, `EGRESO`.
- Payment status: `sin apartado`, `apartado`, `saldado`.
- Session/service concepts include membership, recording, basic/premium sessions, distribution, custom.

Treat option strings as data contracts; changing them requires migration and compatibility UI.

## RLS Pattern

Admin has broad access through `is_admin()` or role helpers. Event collaborators gain scoped access through `event_user_permissions`. Client records are usually scoped to the public `users.user_id` mapped from `auth.uid()`.
