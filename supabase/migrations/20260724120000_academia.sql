create extension if not exists pgcrypto;

create or replace function public.has_academia_admin_permission(
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    check_user_id is not null
    and (
      public.is_admin()
      or exists (
        select 1
        from public.user_permissions up
        where up.user_id::text = check_user_id::text
          and up.permission_key = 'academia.admin'
      )
    );
$$;

revoke all on function public.has_academia_admin_permission(uuid) from public;
grant execute on function public.has_academia_admin_permission(uuid) to anon, authenticated;

create table if not exists public.academy_courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text,
  description text,
  category text not null default 'General',
  level text not null default 'intro'
    check (level in ('intro', 'intermedio', 'avanzado')),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  cover_image text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists public.academy_course_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  title text not null,
  summary text,
  position integer not null default 1 check (position > 0),
  status text not null default 'active'
    check (status in ('active', 'hidden', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_module_contents (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.academy_course_modules(id) on delete cascade,
  title text not null,
  content_type text not null default 'text'
    check (content_type in ('text', 'video', 'link', 'file')),
  body text,
  url text,
  position integer not null default 1 check (position > 0),
  status text not null default 'active'
    check (status in ('active', 'hidden', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academy_course_access (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'completed')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (course_id, user_id)
);

create index if not exists academy_courses_status_idx on public.academy_courses(status);
create index if not exists academy_courses_level_idx on public.academy_courses(level);
create index if not exists academy_modules_course_position_idx on public.academy_course_modules(course_id, position);
create index if not exists academy_contents_module_position_idx on public.academy_module_contents(module_id, position);
create index if not exists academy_access_user_idx on public.academy_course_access(user_id);
create index if not exists academy_access_course_idx on public.academy_course_access(course_id);

create or replace function public.set_academy_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  if tg_table_name = 'academy_courses' and new.status = 'published' and (
    tg_op = 'INSERT'
    or old.status is distinct from 'published'
    or new.published_at is null
  ) then
    new.published_at = coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists academy_courses_updated_at on public.academy_courses;
create trigger academy_courses_updated_at
before insert or update on public.academy_courses
for each row execute function public.set_academy_updated_at();

drop trigger if exists academy_modules_updated_at on public.academy_course_modules;
create trigger academy_modules_updated_at
before insert or update on public.academy_course_modules
for each row execute function public.set_academy_updated_at();

drop trigger if exists academy_contents_updated_at on public.academy_module_contents;
create trigger academy_contents_updated_at
before insert or update on public.academy_module_contents
for each row execute function public.set_academy_updated_at();

alter table public.academy_courses enable row level security;
alter table public.academy_course_modules enable row level security;
alter table public.academy_module_contents enable row level security;
alter table public.academy_course_access enable row level security;

drop policy if exists "academy courses readable" on public.academy_courses;
create policy "academy courses readable"
on public.academy_courses for select
to anon, authenticated
using (
  status = 'published'
  or public.has_academia_admin_permission()
  or exists (
    select 1
    from public.academy_course_access aca
    join public.users u on u.id = aca.user_id
    where aca.course_id = academy_courses.id
      and aca.status in ('active', 'completed')
      and (aca.expires_at is null or aca.expires_at > now())
      and u.id = auth.uid()
  )
);

drop policy if exists "academy courses admin insert" on public.academy_courses;
create policy "academy courses admin insert"
on public.academy_courses for insert
to authenticated
with check (public.has_academia_admin_permission() and (created_by is null or created_by = auth.uid()));

drop policy if exists "academy courses admin update" on public.academy_courses;
create policy "academy courses admin update"
on public.academy_courses for update
to authenticated
using (public.has_academia_admin_permission())
with check (public.has_academia_admin_permission());

drop policy if exists "academy courses admin delete" on public.academy_courses;
create policy "academy courses admin delete"
on public.academy_courses for delete
to authenticated
using (public.has_academia_admin_permission());

drop policy if exists "academy modules readable" on public.academy_course_modules;
create policy "academy modules readable"
on public.academy_course_modules for select
to anon, authenticated
using (
  public.has_academia_admin_permission()
  or exists (
    select 1
    from public.academy_courses c
    where c.id = academy_course_modules.course_id
      and c.status = 'published'
      and academy_course_modules.status = 'active'
  )
  or exists (
    select 1
    from public.academy_course_access aca
    join public.users u on u.id = aca.user_id
    where aca.course_id = academy_course_modules.course_id
      and aca.status in ('active', 'completed')
      and (aca.expires_at is null or aca.expires_at > now())
      and u.id = auth.uid()
  )
);

drop policy if exists "academy modules admin all" on public.academy_course_modules;
create policy "academy modules admin all"
on public.academy_course_modules for all
to authenticated
using (public.has_academia_admin_permission())
with check (public.has_academia_admin_permission());

drop policy if exists "academy contents readable" on public.academy_module_contents;
create policy "academy contents readable"
on public.academy_module_contents for select
to anon, authenticated
using (
  public.has_academia_admin_permission()
  or exists (
    select 1
    from public.academy_course_modules m
    join public.academy_courses c on c.id = m.course_id
    where m.id = academy_module_contents.module_id
      and m.status = 'active'
      and academy_module_contents.status = 'active'
      and c.status = 'published'
  )
  or exists (
    select 1
    from public.academy_course_modules m
    join public.academy_course_access aca on aca.course_id = m.course_id
    join public.users u on u.id = aca.user_id
    where m.id = academy_module_contents.module_id
      and aca.status in ('active', 'completed')
      and (aca.expires_at is null or aca.expires_at > now())
      and u.id = auth.uid()
  )
);

drop policy if exists "academy contents admin all" on public.academy_module_contents;
create policy "academy contents admin all"
on public.academy_module_contents for all
to authenticated
using (public.has_academia_admin_permission())
with check (public.has_academia_admin_permission() and (created_by is null or created_by = auth.uid()));

drop policy if exists "academy access own select" on public.academy_course_access;
create policy "academy access own select"
on public.academy_course_access for select
to authenticated
using (
  public.has_academia_admin_permission()
  or exists (
    select 1
    from public.users u
    where u.id = academy_course_access.user_id
      and u.id = auth.uid()
  )
);

drop policy if exists "academy access admin insert" on public.academy_course_access;
create policy "academy access admin insert"
on public.academy_course_access for insert
to authenticated
with check (public.has_academia_admin_permission() and (granted_by is null or granted_by = auth.uid()));

drop policy if exists "academy access admin update" on public.academy_course_access;
create policy "academy access admin update"
on public.academy_course_access for update
to authenticated
using (public.has_academia_admin_permission())
with check (public.has_academia_admin_permission());

drop policy if exists "academy access admin delete" on public.academy_course_access;
create policy "academy access admin delete"
on public.academy_course_access for delete
to authenticated
using (public.has_academia_admin_permission());

comment on table public.academy_courses is 'Hidden Room Academia courses. Admin mutations require admin role or user_permissions.permission_key = academia.admin.';
comment on table public.academy_course_modules is 'Ordered modules that belong to an Academia course.';
comment on table public.academy_module_contents is 'Course module content blocks for text, video, links, and files.';
comment on table public.academy_course_access is 'Per-user course access grants for private Academia courses.';
