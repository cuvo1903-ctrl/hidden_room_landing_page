-- Hidden Room / MysAuth
-- Shared operational services for ERP transaction creation.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  status text not null default 'active',
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.services (key, name, sort_order)
values
  ('MEMBRESIA', 'MEMBRESÍA', 10),
  ('GRABACION', 'GRABACIÓN', 20),
  ('PRODUCCION_BASICA', 'PRODUCCIÓN BÁSICA', 30),
  ('PRODUCCION_PREMIUM', 'PRODUCCIÓN PREMIUM', 40),
  ('DISTRIBUCION', 'DISTRIBUCIÓN', 50),
  ('PERSONALIZADO', 'PERSONALIZADO', 60)
on conflict (key) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  status = 'active';

grant select, insert, update, delete on public.services to authenticated;

alter table public.services enable row level security;

drop policy if exists "services admin all" on public.services;
create policy "services admin all"
on public.services
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "services active select" on public.services;
create policy "services active select"
on public.services
for select
to authenticated
using (status = 'active' or public.is_admin());
