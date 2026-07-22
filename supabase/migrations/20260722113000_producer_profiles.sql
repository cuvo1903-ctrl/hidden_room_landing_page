create table if not exists public.producer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  slug text not null unique,
  display_name text not null,
  bio text,
  avatar_url text,
  cover_url text,
  social_links jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint producer_profiles_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

alter table public.store_products
  add column if not exists producer_profile_id uuid references public.producer_profiles(id) on delete set null;

create index if not exists producer_profiles_user_id_idx on public.producer_profiles(user_id);
create index if not exists producer_profiles_active_slug_idx on public.producer_profiles(slug) where is_active;
create index if not exists store_products_producer_profile_id_idx on public.store_products(producer_profile_id);

drop trigger if exists set_producer_profiles_updated_at on public.producer_profiles;
create trigger set_producer_profiles_updated_at
before update on public.producer_profiles
for each row execute function public.set_updated_at();

alter table public.producer_profiles enable row level security;

drop policy if exists "Public can read active producer profiles" on public.producer_profiles;
create policy "Public can read active producer profiles"
on public.producer_profiles for select
to anon, authenticated
using (is_active = true or public.is_admin());

drop policy if exists "Admins manage producer profiles" on public.producer_profiles;
create policy "Admins manage producer profiles"
on public.producer_profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

comment on table public.producer_profiles is 'Perfiles publicos de productores para catalogos Beat Store.';
comment on column public.store_products.producer_profile_id is 'Perfil publico del productor asociado al beat.';