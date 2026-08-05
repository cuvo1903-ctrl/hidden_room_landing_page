create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  message text not null,
  type text not null default 'info',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications admin all" on public.notifications;
create policy "notifications admin all"
  on public.notifications
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "notifications own select" on public.notifications;
create policy "notifications own select"
  on public.notifications
  for select
  to authenticated
  using (
    user_id = auth.uid()::text
    or exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.user_id = notifications.user_id
    )
  );

drop policy if exists "notifications own update_read" on public.notifications;
create policy "notifications own update_read"
  on public.notifications
  for update
  to authenticated
  using (
    user_id = auth.uid()::text
    or exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.user_id = notifications.user_id
    )
  )
  with check (
    user_id = auth.uid()::text
    or exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.user_id = notifications.user_id
    )
  );
