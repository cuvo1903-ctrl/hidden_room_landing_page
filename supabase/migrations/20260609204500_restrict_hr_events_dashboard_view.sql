-- Hidden Room / MysAuth
-- Restrict the events dashboard view itself to admin or event-authorized users.

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
left join public.hr_event_finance_summary s on s.event_key = e.event_key
where
  public.is_admin()
  or exists (
    select 1
    from public.event_user_permissions eup
    join public.users u on u.user_id = eup.user_id
    where u.id = auth.uid()
      and eup.can_view = true
      and eup.event_id = e.id
  );
