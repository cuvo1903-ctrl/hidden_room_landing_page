# Membership Rules

## Data Sources

Primary contract source:

- `public.memberships`
- Fields expected: `id`, `user_id`, `username`, `status`, `start_date`, `end_date`, `weekly_price`, `sessions_per_week`, `notes`.
- Status values: `active`, `paused`, `cancelled`, `expired`; dashboard displays uppercase.

Usage evidence:

- `public.sessions`
- Membership sessions use `type = "MEMBRESÍA"` and/or `concept = "MEMBRESÍA"`.
- If `membership_id` exists, match by it.
- If `membership_id` is null, fallback by `user_id + MEMBRESÍA`.

Payments:

- `public.transactions`
- Membership payments use `service = "MEMBRESÍA"`.
- If `membership_id` exists, match by it; otherwise fallback by `user_id + MEMBRESÍA`.

## Week Generation

- Generate weeks from `membership.start_date`.
- Normalize each week to Monday-Sunday with `getWeekStartMonday` and `getWeekEndSunday`.
- End at `membership.end_date` when present; otherwise current date, unless future sessions extend display.
- Each week creates one obligation for `weekly_price` or default `MEMBERSHIP_WEEKLY_COST = 500`.
- Sessions do not create extra debt. Multiple sessions in the same week remain usage detail.

Legacy fallback:

- If there is no `public.memberships` row, derive legacy memberships from membership sessions.
- Legacy weeks still use calendar Monday-Sunday grouping.
- Show "Membresía histórica sin registro en public.memberships." for legacy context.

## Financial Status

Weekly states:

- `ADELANTADO`: paid before the week start.
- `CORRIENTE`: paid by the Sunday deadline of that week.
- `ATRASADO`: paid after the Sunday deadline, or past week still unpaid.
- `PENDIENTE`: current/future week not fully paid yet.

Balance display:

- Use `saldo_tipo = 'adeudo'` for overdue unpaid weeks.
- Use `saldo_tipo = 'pendiente'` for current-week pending payment.
- Current dashboard summary separates `SALDO VENCIDO` and `SALDO PENDIENTE`.
- Credits must represent current real credit, not repeated cumulative historical credit.

## Material Delivery

Current model:

- A "month worked" equals one membership cycle of 4 weeks.
- Cycle examples: Mes 1 = Semanas 1-4, Mes 2 = Semanas 5-8, Mes 3 = Semanas 9-12.
- Base delivery is the Sunday at the end of the next 4-week cycle.
- Example: Mes 1 worked weeks 1-4, base delivery is end of week 8.

Delays:

- Count paid-late weeks (`estado = 'ATRASADO'` with `fecha_de_saldo`) inside each cycle.
- Each paid-late week adds 1 week of delay.
- Delay accumulates forward from the cycle where the lateness occurs.
- Do not retroactively shift cycles whose applicable date was before that lateness.
- Open overdue weeks block the current cycle and later cycles, not earlier cycles.
- `PENDIENTE` alone should not be treated as overdue debt.

Delivery statuses:

- `BLOQUEADA POR ADEUDO`: there is overdue debt for this cycle or a prior cycle.
- `BLOQUEADA POR MEMBRESÍA INACTIVA`: membership status is not active.
- `DIFERIDA POR ATRASO`: no overdue debt, but accumulated delay means estimated delivery has not arrived.
- `PROGRAMADA`: active/current and base or estimated delivery date is in the future.
- `DISPONIBLE`: active/current and delivery date has arrived.
- `ENTREGADA`: admin entered manual `delivered_at`.

Manual delivery records:

- Store real delivery dates and notes in `public.membership_material_deliveries`.
- `delivered_at` is the real date material was delivered, not the scheduled date.
- Admin can edit delivery date and notes from ERP > BB.DD. > Membresia.
- Client sees the same dashboard read-only.

## Downloads Linked To Membership Deliveries

Downloads can be immediate or tied to a membership delivery.

`public.downloads` fields:

- `release_mode`: `immediate` or `membership_delivery`.
- `membership_id`
- `membership_delivery_id`
- `membership_cycle_number`

Rules:

- Immediate downloads appear in Cliente > Descargas as soon as created.
- Membership downloads appear only after the matching material delivery exists with `delivered_at`.
- ERP > Operaciones > Descarga asks whether the download corresponds to membership.
- If yes, select membership and cycle from menus; set user from the membership.
- Trigger `link_downloads_to_membership_delivery` links delivery records to downloads.

## UI Expectations

Client membership table columns:

- Semana
- Fecha de sesión
- Estado
- Saldo
- Fecha de saldo
- Entrega programada
- Fecha de entrega
- Notas

Rules:

- Show dates to users as `DD/MM/AAAA`.
- If no session exists, show "Sin sesión registrada".
- "Pendiente por pagar" is visually muted/gray.
- Debt rows/data use danger styling; credit/current data use success styling where appropriate.
- Keep row heights compact.
- ERP > BB.DD. > Membresia should not show a table until admin selects a user.
- Admin view should mirror client data but include search and editable delivery cells.