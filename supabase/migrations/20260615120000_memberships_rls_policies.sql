alter table public.memberships enable row level security;

drop policy if exists "memberships admin all" on public.memberships;
drop policy if exists "memberships own select" on public.memberships;

create policy "memberships admin all"
  on public.memberships
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "memberships own select"
  on public.memberships
  for select
  to authenticated
  using (
    user_id = (
      select u.user_id
      from public.users u
      where u.id = auth.uid()
    )
  );
