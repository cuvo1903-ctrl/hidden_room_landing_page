create table if not exists public.academy_content_files (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.academy_module_contents(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  cloud_path text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (content_id)
);

create index if not exists academy_content_files_content_idx
  on public.academy_content_files(content_id);

alter table public.academy_content_files enable row level security;

drop policy if exists "academy content files readable" on public.academy_content_files;
create policy "academy content files readable"
on public.academy_content_files for select
to authenticated
using (
  public.has_academia_admin_permission()
  or exists (
    select 1
    from public.academy_module_contents c
    join public.academy_module_access ama on ama.module_id = c.module_id
    join public.users u on u.id = ama.user_id
    where c.id = academy_content_files.content_id
      and c.status = 'active'
      and ama.status in ('active', 'completed')
      and (ama.expires_at is null or ama.expires_at > now())
      and u.id = auth.uid()
  )
);

drop policy if exists "academy content files admin insert" on public.academy_content_files;
create policy "academy content files admin insert"
on public.academy_content_files for insert
to authenticated
with check (public.has_academia_admin_permission() and (uploaded_by is null or uploaded_by = auth.uid()));

drop policy if exists "academy content files admin update" on public.academy_content_files;
create policy "academy content files admin update"
on public.academy_content_files for update
to authenticated
using (public.has_academia_admin_permission())
with check (public.has_academia_admin_permission());

drop policy if exists "academy content files admin delete" on public.academy_content_files;
create policy "academy content files admin delete"
on public.academy_content_files for delete
to authenticated
using (public.has_academia_admin_permission());

comment on table public.academy_content_files is 'Cloud files attached to Academia module content. Files are course/module content, not per-user downloads.';