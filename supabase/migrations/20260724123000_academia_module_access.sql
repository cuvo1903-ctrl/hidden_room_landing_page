create table if not exists public.academy_module_access (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.academy_course_modules(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'completed')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (module_id, user_id)
);

create index if not exists academy_module_access_user_idx
  on public.academy_module_access(user_id);
create index if not exists academy_module_access_module_idx
  on public.academy_module_access(module_id);

alter table public.academy_module_access enable row level security;

drop policy if exists "academy module access own select" on public.academy_module_access;
create policy "academy module access own select"
on public.academy_module_access for select
to authenticated
using (
  public.has_academia_admin_permission()
  or exists (
    select 1
    from public.users u
    where u.id = academy_module_access.user_id
      and u.id = auth.uid()
  )
);

drop policy if exists "academy module access admin insert" on public.academy_module_access;
create policy "academy module access admin insert"
on public.academy_module_access for insert
to authenticated
with check (public.has_academia_admin_permission() and (granted_by is null or granted_by = auth.uid()));

drop policy if exists "academy module access admin update" on public.academy_module_access;
create policy "academy module access admin update"
on public.academy_module_access for update
to authenticated
using (public.has_academia_admin_permission())
with check (public.has_academia_admin_permission());

drop policy if exists "academy module access admin delete" on public.academy_module_access;
create policy "academy module access admin delete"
on public.academy_module_access for delete
to authenticated
using (public.has_academia_admin_permission());

drop policy if exists "academy contents readable" on public.academy_module_contents;
create policy "academy contents readable"
on public.academy_module_contents for select
to anon, authenticated
using (
  public.has_academia_admin_permission()
  or exists (
    select 1
    from public.academy_module_access ama
    join public.users u on u.id = ama.user_id
    where ama.module_id = academy_module_contents.module_id
      and ama.status in ('active', 'completed')
      and (ama.expires_at is null or ama.expires_at > now())
      and u.id = auth.uid()
  )
);

comment on table public.academy_module_access is 'Per-user Academia module releases. Course access opens the course page; module access releases module content.';
