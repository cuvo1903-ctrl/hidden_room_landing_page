-- Hidden Room / MysAuth
-- Public signup -> auth.users -> public.users synchronization.
-- Run in Supabase SQL editor as database owner.

alter table public.users
  add column if not exists temp_password text;

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = check_user_id
      and lower(coalesce(u.roles, '')) like '%admin%'
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    display_name,
    email,
    whatsapp,
    username,
    user_id,
    roles,
    temp_password
  )
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data->>'display_name', ''), ''),
    new.email,
    nullif(coalesce(new.phone, new.raw_user_meta_data->>'whatsapp', ''), ''),
    null,
    null,
    null,
    null
  )
  on conflict (id) do update
  set
    display_name = coalesce(public.users.display_name, excluded.display_name),
    email = excluded.email,
    whatsapp = coalesce(public.users.whatsapp, excluded.whatsapp);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_sync_public_users on auth.users;

create trigger on_auth_user_created_sync_public_users
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

alter table public.users enable row level security;

drop policy if exists "users_select_own_or_admin" on public.users;
create policy "users_select_own_or_admin"
on public.users
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "users_update_own_allowed" on public.users;
create policy "users_update_own_allowed"
on public.users
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and roles is not distinct from (select roles from public.users where id = auth.uid())
  and temp_password is not distinct from (select temp_password from public.users where id = auth.uid())
);

drop policy if exists "users_admin_all" on public.users;
create policy "users_admin_all"
on public.users
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Recommended safe read surface for normal clients: no temp_password column.
create or replace view public.users_safe as
select
  id,
  user_id,
  display_name,
  email,
  whatsapp,
  avatar_url,
  username,
  roles
from public.users;
