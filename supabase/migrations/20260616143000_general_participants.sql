create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  role text,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

insert into public.participants (user_id, role, notes)
select distinct on (ep.user_id)
  ep.user_id,
  ep.role,
  ep.notes
from public.event_participations ep
where nullif(trim(ep.user_id), '') is not null
on conflict (user_id) do update
set
  role = coalesce(public.participants.role, excluded.role),
  notes = coalesce(public.participants.notes, excluded.notes);

create index if not exists participants_user_id_idx
  on public.participants (user_id);

alter table public.participants enable row level security;

drop policy if exists "participants admin all" on public.participants;
create policy "participants admin all"
  on public.participants
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "participants authenticated select" on public.participants;
create policy "participants authenticated select"
  on public.participants
  for select
  to authenticated
  using (true);
