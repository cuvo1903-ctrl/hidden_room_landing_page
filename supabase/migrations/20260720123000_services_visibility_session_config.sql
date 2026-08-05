-- Hidden Room / MysAuth
-- Service visibility and session defaults.

alter table public.services
  add column if not exists show_in_finance boolean not null default true,
  add column if not exists show_in_session boolean not null default false,
  add column if not exists session_cost numeric,
  add column if not exists session_minutes integer;

alter table public.services
  add constraint services_session_cost_nonnegative check (session_cost is null or session_cost >= 0) not valid;

alter table public.services
  add constraint services_session_minutes_positive check (session_minutes is null or session_minutes > 0) not valid;

update public.services
set
  show_in_finance = true,
  show_in_session = false,
  session_cost = null,
  session_minutes = null;

update public.services
set
  show_in_session = true,
  session_cost = 500,
  session_minutes = 120
where key = 'MEMBRESIA';

update public.services
set
  show_in_session = true,
  session_cost = 650,
  session_minutes = 60
where key = 'GRABACION';

insert into public.services (key, name, status, sort_order, show_in_finance, show_in_session, session_cost, session_minutes)
values
  ('SESION_BASICA', 'SESIÓN BÁSICA', 'active', 70, false, true, 1700, 90),
  ('SESION_PREMIUM', 'SESIÓN PREMIUM', 'active', 80, false, true, 3700, 150)
on conflict (key) do update
set
  name = excluded.name,
  status = 'active',
  sort_order = excluded.sort_order,
  show_in_finance = excluded.show_in_finance,
  show_in_session = excluded.show_in_session,
  session_cost = excluded.session_cost,
  session_minutes = excluded.session_minutes;
