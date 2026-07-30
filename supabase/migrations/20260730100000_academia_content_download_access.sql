create table if not exists public.academy_content_download_access (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.academy_module_contents(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked', 'completed')),
  expires_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  unique (content_id, user_id)
);

create index if not exists academy_content_download_access_user_idx
  on public.academy_content_download_access(user_id);

create index if not exists academy_content_download_access_content_idx
  on public.academy_content_download_access(content_id);

alter table public.academy_content_download_access enable row level security;

drop policy if exists "academy content download access own select" on public.academy_content_download_access;
create policy "academy content download access own select"
on public.academy_content_download_access for select
to authenticated
using (
  public.has_academia_admin_permission()
  or (
    status in ('active', 'completed')
    and (expires_at is null or expires_at > now())
    and exists (
      select 1
      from public.users u
      where u.id = academy_content_download_access.user_id
        and u.id = auth.uid()
    )
  )
);

drop policy if exists "academy content download access admin insert" on public.academy_content_download_access;
create policy "academy content download access admin insert"
on public.academy_content_download_access for insert
to authenticated
with check (public.has_academia_admin_permission());

drop policy if exists "academy content download access admin update" on public.academy_content_download_access;
create policy "academy content download access admin update"
on public.academy_content_download_access for update
to authenticated
using (public.has_academia_admin_permission())
with check (public.has_academia_admin_permission());

drop policy if exists "academy content download access admin delete" on public.academy_content_download_access;
create policy "academy content download access admin delete"
on public.academy_content_download_access for delete
to authenticated
using (public.has_academia_admin_permission());

comment on table public.academy_content_download_access is 'Per-user download permission for general Academia content files. Course/module access allows viewing; this table separately enables downloading.';