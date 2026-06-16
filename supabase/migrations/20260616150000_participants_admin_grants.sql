grant usage on schema public to authenticated;

grant select, insert, update, delete on public.participants to authenticated;

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

grant select, insert, update, delete on public.event_participations to authenticated;

alter table public.event_participations enable row level security;

drop policy if exists "event participations admin all" on public.event_participations;
create policy "event participations admin all"
  on public.event_participations
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "event participations authenticated select" on public.event_participations;
create policy "event participations authenticated select"
  on public.event_participations
  for select
  to authenticated
  using (true);
