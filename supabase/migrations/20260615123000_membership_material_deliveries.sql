create table if not exists public.membership_material_deliveries (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid references public.memberships(id) on delete set null,
  user_id text not null,
  cycle_number integer not null check (cycle_number > 0),
  delivered_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists membership_material_deliveries_user_id_idx
  on public.membership_material_deliveries (user_id);

create index if not exists membership_material_deliveries_membership_id_idx
  on public.membership_material_deliveries (membership_id);

create unique index if not exists membership_material_deliveries_scope_cycle_idx
  on public.membership_material_deliveries (
    user_id,
    cycle_number,
    coalesce(membership_id::text, 'legacy')
  );

alter table public.membership_material_deliveries enable row level security;

drop policy if exists "membership material deliveries admin all" on public.membership_material_deliveries;
drop policy if exists "membership material deliveries own select" on public.membership_material_deliveries;

create policy "membership material deliveries admin all"
  on public.membership_material_deliveries
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "membership material deliveries own select"
  on public.membership_material_deliveries
  for select
  to authenticated
  using (
    user_id = (
      select u.user_id
      from public.users u
      where u.id = auth.uid()
    )
  );
