create extension if not exists pgcrypto;

alter table public.store_products
  add column if not exists producer_user_id uuid references auth.users(id) on delete set null;

create index if not exists store_products_producer_user_id_idx
  on public.store_products (producer_user_id)
  where category = 'beats';

create or replace function public.can_manage_beat_product(p_beat_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.store_products products
    where products.id = p_beat_id
      and products.category = 'beats'
      and (public.is_admin() or products.producer_user_id = auth.uid())
  );
$$;

create table if not exists public.beat_licenses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) > 0),
  min_price numeric(10, 2) not null check (min_price >= 0),
  max_price numeric(10, 2) not null check (max_price >= min_price),
  description text not null check (length(btrim(description)) > 0),
  terms text,
  stream_limit bigint check (stream_limit is null or stream_limit >= 0),
  unlimited_streams boolean not null default false,
  format text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beat_licenses_stream_limit_required
    check (unlimited_streams = true or stream_limit is not null)
);

create table if not exists public.beat_license_assignments (
  id uuid primary key default gen_random_uuid(),
  beat_id uuid not null references public.store_products(id) on delete cascade,
  license_id uuid not null references public.beat_licenses(id) on delete restrict,
  price numeric(10, 2) not null check (price >= 0),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (beat_id, license_id)
);

create index if not exists beat_licenses_active_idx
  on public.beat_licenses (is_active, created_at desc);
create index if not exists beat_license_assignments_beat_id_idx
  on public.beat_license_assignments (beat_id, is_enabled);
create index if not exists beat_license_assignments_license_id_idx
  on public.beat_license_assignments (license_id);

create or replace function public.set_beat_license_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists beat_licenses_updated_at on public.beat_licenses;
create trigger beat_licenses_updated_at
before update on public.beat_licenses
for each row execute function public.set_beat_license_updated_at();

drop trigger if exists beat_license_assignments_updated_at on public.beat_license_assignments;
create trigger beat_license_assignments_updated_at
before update on public.beat_license_assignments
for each row execute function public.set_beat_license_updated_at();

create or replace function public.validate_beat_license_assignment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  license_row public.beat_licenses%rowtype;
  beat_category text;
begin
  select * into license_row from public.beat_licenses where id = new.license_id;
  if not found then
    raise exception 'License not found';
  end if;

  select category into beat_category from public.store_products where id = new.beat_id;
  if beat_category is distinct from 'beats' then
    raise exception 'License assignments are only available for beat products';
  end if;

  if new.price < license_row.min_price or new.price > license_row.max_price then
    raise exception 'License price is outside allowed range';
  end if;

  return new;
end;
$$;

drop trigger if exists beat_license_assignments_validate on public.beat_license_assignments;
create trigger beat_license_assignments_validate
before insert or update on public.beat_license_assignments
for each row execute function public.validate_beat_license_assignment();

alter table public.beat_licenses enable row level security;
alter table public.beat_license_assignments enable row level security;

drop policy if exists "beat licenses public active read" on public.beat_licenses;
create policy "beat licenses public active read"
on public.beat_licenses for select
to anon, authenticated
using (is_active = true or public.is_admin());

drop policy if exists "beat licenses admin insert" on public.beat_licenses;
create policy "beat licenses admin insert"
on public.beat_licenses for insert
to authenticated
with check (public.is_admin());

drop policy if exists "beat licenses admin update" on public.beat_licenses;
create policy "beat licenses admin update"
on public.beat_licenses for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "beat licenses admin delete" on public.beat_licenses;
create policy "beat licenses admin delete"
on public.beat_licenses for delete
to authenticated
using (public.is_admin());

drop policy if exists "beat assignments public enabled read" on public.beat_license_assignments;
create policy "beat assignments public enabled read"
on public.beat_license_assignments for select
to anon, authenticated
using (
  is_enabled = true
  and exists (
    select 1
    from public.store_products products
    join public.beat_licenses licenses on licenses.id = beat_license_assignments.license_id
    where products.id = beat_license_assignments.beat_id
      and products.category = 'beats'
      and products.is_active = true
      and licenses.is_active = true
  )
);

drop policy if exists "beat assignments manager read" on public.beat_license_assignments;
create policy "beat assignments manager read"
on public.beat_license_assignments for select
to authenticated
using (public.can_manage_beat_product(beat_id));
drop policy if exists "beat assignments admin or producer insert" on public.beat_license_assignments;
create policy "beat assignments admin or producer insert"
on public.beat_license_assignments for insert
to authenticated
with check (public.can_manage_beat_product(beat_id));

drop policy if exists "beat assignments admin or producer update" on public.beat_license_assignments;
create policy "beat assignments admin or producer update"
on public.beat_license_assignments for update
to authenticated
using (public.can_manage_beat_product(beat_id))
with check (public.can_manage_beat_product(beat_id));

drop policy if exists "beat assignments admin or producer delete" on public.beat_license_assignments;
create policy "beat assignments admin or producer delete"
on public.beat_license_assignments for delete
to authenticated
using (public.can_manage_beat_product(beat_id));

create or replace function public.delete_beat_license_if_unused(p_license_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  if exists (select 1 from public.beat_license_assignments where license_id = p_license_id) then
    raise exception 'License is assigned to one or more beats';
  end if;

  delete from public.beat_licenses where id = p_license_id;
  return found;
end;
$$;

revoke all on function public.can_manage_beat_product(uuid) from public;
grant execute on function public.can_manage_beat_product(uuid) to anon, authenticated;
revoke all on function public.delete_beat_license_if_unused(uuid) from public;
grant execute on function public.delete_beat_license_if_unused(uuid) to authenticated;

insert into public.beat_licenses (name, min_price, max_price, description, terms, stream_limit, unlimited_streams, format, is_active)
values
  ('Basica MP3', 400, 800, 'Licencia inicial para publicar con credito al productor.', 'Uso no exclusivo. No incluye stems.', 100000, false, 'MP3', true),
  ('Premium WAV', 800, 1600, 'Mayor calidad para lanzamiento en plataformas digitales.', 'Uso no exclusivo. Credito obligatorio.', 500000, false, 'MP3 + WAV', true),
  ('Ilimitada', 1800, 5000, 'Licencia amplia preparada para proyectos comerciales.', 'Uso no exclusivo. Contrato formal proximamente.', null, true, 'MP3 + WAV + Stems', true)
on conflict (name) do nothing;


