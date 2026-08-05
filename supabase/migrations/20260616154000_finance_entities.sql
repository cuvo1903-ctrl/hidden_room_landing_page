create table if not exists public.finance_entities (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null unique,
  name text not null,
  entity_type text not null default 'producer',
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

insert into public.finance_entities (entity_key, name, entity_type, notes)
values
  ('hidden_room', 'Hidden Room', 'internal', 'Entidad interna Hidden Room'),
  ('lechita_records', 'Lechita Records', 'producer', 'Productora preasignada'),
  ('productora_externa', 'Productora externa', 'producer', 'Productora preasignada genérica')
on conflict (entity_key) do update
set
  name = excluded.name,
  entity_type = excluded.entity_type;

alter table public.hr_transactions
  add column if not exists owner_entity_id uuid references public.finance_entities(id) on delete set null;

create index if not exists hr_transactions_owner_entity_id_idx
  on public.hr_transactions (owner_entity_id);

grant select, insert, update, delete on public.finance_entities to authenticated;
grant select, insert, update, delete on public.hr_transactions to authenticated;

alter table public.finance_entities enable row level security;

drop policy if exists "finance entities admin all" on public.finance_entities;
create policy "finance entities admin all"
  on public.finance_entities
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "finance entities authenticated select" on public.finance_entities;
create policy "finance entities authenticated select"
  on public.finance_entities
  for select
  to authenticated
  using (status = 'active' or public.is_admin());
