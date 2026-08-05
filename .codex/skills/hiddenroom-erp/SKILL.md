---
name: hiddenroom-erp
description: "Hidden Room ERP skill for operational dashboard data: event finance, transactions, events, memberships, studio sessions, participations, counterparties, tasks, contracts, downloads, user records, scores, and admin workflows. Use when changing ERP tables, portal ERP views, finance calculations, membership handling, or event permission behavior."
---

# Hidden Room ERP

## Workflow

1. Identify whether the change is UI-only, query-level, or schema-level.
2. For schema changes, use a Supabase migration and update RLS with the same authorization model.
3. Keep event permissions based on `event_user_permissions` and admin override.
4. Preserve finance semantics: `INGRESO`/`EGRESO`, status values, event keys, counterparties, participations, and membership records.
5. Keep dashboard renderers deterministic and table-friendly; avoid hidden business logic in markup strings.
6. Validate dashboard JS and any SQL migration.

## Business Domains

- Event finance: `events`, `hr_transactions`, event-specific permissions.
- Memberships and studio sessions: membership deliveries, sessions, weekly cost constants, service/concept options.
- Participations: counterparties and participation percentages for event settlement.
- Tasks/scrum: permission keys such as `scrum.view` and `scrum.edit`.
- User operations: users, contracts, downloads, scores, notifications.

## Guardrails

- Do not bypass RLS by moving sensitive ERP writes to browser-only logic.
- Do not change canonical option strings without a data migration and UI compatibility pass.
- Keep user-facing totals and statuses auditable from database rows.

## References

Read `references/erp-model.md` when changing finance, memberships, sessions, or operational tables.
