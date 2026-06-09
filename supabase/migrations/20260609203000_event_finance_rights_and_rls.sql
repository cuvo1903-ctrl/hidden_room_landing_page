-- Hidden Room / MysAuth
-- Event finance rights, counterparty ownership, and event-scoped RLS.

alter table public.hr_transactions
add column if not exists owner_counterparty_id uuid references public.event_counterparties(id);

alter table public.event_user_permissions
add column if not exists can_view_scrum boolean not null default false;

create index if not exists hr_transactions_event_id_idx
  on public.hr_transactions (event_id);

create index if not exists hr_transactions_from_counterparty_id_idx
  on public.hr_transactions (from_counterparty_id);

create index if not exists hr_transactions_to_counterparty_id_idx
  on public.hr_transactions (to_counterparty_id);

create index if not exists hr_transactions_owner_counterparty_id_idx
  on public.hr_transactions (owner_counterparty_id);

create or replace view public.hr_event_finance_summary
with (security_invoker = true)
as
select
  coalesce(e.event_key, ht.event_key) as event_key,
  coalesce(sum(ht.amount) filter (where ht.movement_type = 'income'), 0) as ingresos,
  abs(coalesce(sum(ht.amount) filter (where ht.movement_type = 'expense'), 0)) as egresos,
  coalesce(sum(ht.amount) filter (where ht.movement_type = 'investment_in'), 0) as inversion_ingresada,
  abs(coalesce(sum(ht.amount) filter (where ht.movement_type = 'investment_return'), 0)) as utilidad_devuelta,
  coalesce(sum(ht.amount) filter (where ht.movement_type = 'counterparty_transfer'), 0) as entregas_a_favor,
  coalesce(sum(ht."M.A.I."), sum(ht.hidden_room_share), 0) as mai,
  coalesce(sum(ht.hidden_room_share), 0) as hidden_room_share_total,
  coalesce(sum(ht.amount), 0) + coalesce(sum(ht.hidden_room_share), 0) as balance_evento,
  coalesce(sum(abs(ht.amount)) filter (
    where ht.movement_type = 'expense' or coalesce(ht.amount, 0) < 0
  ), 0) as rights_total_cost,
  coalesce(sum(abs(coalesce(ht.hidden_room_share, 0))) filter (
    where ht.movement_type = 'expense' or coalesce(ht.amount, 0) < 0
  ), 0) as rights_hidden_room_acquired,
  greatest(
    coalesce(sum(abs(ht.amount)) filter (
      where ht.movement_type = 'expense' or coalesce(ht.amount, 0) < 0
    ), 0)
    -
    coalesce(sum(abs(coalesce(ht.hidden_room_share, 0))) filter (
      where ht.movement_type = 'expense' or coalesce(ht.amount, 0) < 0
    ), 0),
    0
  ) as rights_counterparty_acquired
from public.hr_transactions ht
left join public.events e on e.id = ht.event_id or e.event_key = ht.event_key
group by coalesce(e.event_key, ht.event_key);

create or replace view public.hr_events_dashboard
with (security_invoker = true)
as
select
  e.id,
  e.event_key,
  e.name,
  e.event_date,
  e.status,
  coalesce(s.ingresos, 0) as ingresos,
  coalesce(s.egresos, 0) as egresos,
  coalesce(s.inversion_ingresada, 0) as inversion_ingresada,
  coalesce(s.utilidad_devuelta, 0) as utilidad_devuelta,
  coalesce(s.entregas_a_favor, 0) as entregas_a_favor,
  coalesce(s.mai, 0) as mai,
  coalesce(s.hidden_room_share_total, 0) as hidden_room_share_total,
  coalesce(s.balance_evento, 0) as balance_evento,
  coalesce(s.rights_total_cost, 0) as rights_total_cost,
  coalesce(s.rights_hidden_room_acquired, 0) as rights_hidden_room_acquired,
  coalesce(s.rights_counterparty_acquired, 0) as rights_counterparty_acquired
from public.events e
left join public.hr_event_finance_summary s on s.event_key = e.event_key;

create or replace view public.hr_events_user_access
with (security_invoker = true)
as
select
  eup.user_id,
  e.id as event_id,
  e.event_key,
  e.name,
  e.event_date,
  e.status,
  eup.can_view,
  eup.can_add_finance,
  eup.can_edit_finance,
  eup.can_edit_scrum,
  eup.can_view_scrum
from public.event_user_permissions eup
join public.events e on e.id = eup.event_id
where eup.can_view = true;

alter table public.event_user_permissions enable row level security;
alter table public.hr_transactions enable row level security;

drop policy if exists "Authenticated can read hr_transactions" on public.hr_transactions;

drop policy if exists "event finance select assigned" on public.hr_transactions;
create policy "event finance select assigned"
on public.hr_transactions
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_user_permissions eup
    join public.users u on u.user_id = eup.user_id
    where u.id = auth.uid()
      and eup.can_view = true
      and (
        eup.event_id = hr_transactions.event_id
        or exists (
          select 1
          from public.events e
          where e.id = eup.event_id
            and e.event_key = hr_transactions.event_key
        )
      )
  )
);

drop policy if exists "event finance insert assigned" on public.hr_transactions;
create policy "event finance insert assigned"
on public.hr_transactions
for insert
to authenticated
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_user_permissions eup
    join public.users u on u.user_id = eup.user_id
    where u.id = auth.uid()
      and eup.can_add_finance = true
      and (
        eup.event_id = hr_transactions.event_id
        or exists (
          select 1
          from public.events e
          where e.id = eup.event_id
            and e.event_key = hr_transactions.event_key
        )
      )
  )
);

drop policy if exists "event finance update assigned" on public.hr_transactions;
create policy "event finance update assigned"
on public.hr_transactions
for update
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.event_user_permissions eup
    join public.users u on u.user_id = eup.user_id
    where u.id = auth.uid()
      and eup.can_edit_finance = true
      and (
        eup.event_id = hr_transactions.event_id
        or exists (
          select 1
          from public.events e
          where e.id = eup.event_id
            and e.event_key = hr_transactions.event_key
        )
      )
  )
)
with check (
  public.is_admin()
  or exists (
    select 1
    from public.event_user_permissions eup
    join public.users u on u.user_id = eup.user_id
    where u.id = auth.uid()
      and eup.can_edit_finance = true
      and (
        eup.event_id = hr_transactions.event_id
        or exists (
          select 1
          from public.events e
          where e.id = eup.event_id
            and e.event_key = hr_transactions.event_key
        )
      )
  )
);

grant select on public.hr_event_finance_summary to authenticated;
grant select on public.hr_events_dashboard to authenticated;
grant select on public.hr_events_user_access to authenticated;
