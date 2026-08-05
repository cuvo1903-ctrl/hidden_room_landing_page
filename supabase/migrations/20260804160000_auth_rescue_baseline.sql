-- Hidden Room / MysAuth
-- Auth rescue baseline: reliable signup/profile sync and least-privilege users RLS.
-- Apply with: supabase db push
--
-- Browser clients use only the publishable key. Service-role access remains
-- restricted to Edge Functions and server-side agents.

begin;

alter table public.users
  add column if not exists has_auth boolean default false,
  add column if not exists temp_password text;

create or replace function public.normalize_phone_digits(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
$$;

create or replace function public.generate_public_user_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := lpad(floor(random() * 1000000)::int::text, 6, '0');
    exit when not exists (
      select 1 from public.users where user_id = candidate
    );
  end loop;
  return candidate;
end;
$$;

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = check_user_id
      and lower(coalesce(roles, '')) ~ '(^|[,[:space:]])admin([,[:space:]]|$)'
  );
$$;

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(roles), ''), 'client')
  from public.users
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.own_profile_security_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', user_id,
    'roles', roles,
    'has_auth', has_auth,
    'temp_password', temp_password,
    'old_id', old_id,
    'passline_tracking', passline_tracking,
    'occupations', occupations
  )
  from public.users
  where id = auth.uid()
  limit 1;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  incoming_phone text;
  incoming_name text;
  matched_profile_id uuid;
begin
  incoming_phone := public.normalize_phone_digits(
    coalesce(new.phone, new.raw_user_meta_data->>'whatsapp', '')
  );
  incoming_name := nullif(trim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');

  -- Replayed triggers and existing linked rows update in place.
  if exists (select 1 from public.users where id = new.id) then
    update public.users
    set email = new.email,
        display_name = coalesce(display_name, incoming_name),
        whatsapp = coalesce(whatsapp, incoming_phone),
        has_auth = true
    where id = new.id;
    return new;
  end if;

  -- Claim only one unlinked historical profile by phone. Never guess when
  -- the phone is duplicated.
  if incoming_phone is not null and length(incoming_phone) >= 10 then
    select u.id
    into matched_profile_id
    from public.users u
    where public.normalize_phone_digits(u.whatsapp) = incoming_phone
      and coalesce(u.has_auth, false) = false
      and not exists (
        select 1 from auth.users au where au.id = u.id
      )
    order by u.id
    limit 1;

    if (select count(*) from public.users u
        where public.normalize_phone_digits(u.whatsapp) = incoming_phone
          and coalesce(u.has_auth, false) = false
          and not exists (select 1 from auth.users au where au.id = u.id)) = 1
    then
      update public.users
      set id = new.id,
          email = new.email,
          display_name = coalesce(display_name, incoming_name),
          whatsapp = incoming_phone,
          has_auth = true,
          roles = coalesce(nullif(trim(roles), ''), 'client'),
          user_id = coalesce(nullif(trim(user_id), ''), public.generate_public_user_id()),
          temp_password = null
      where id = matched_profile_id;
      return new;
    end if;
  end if;

  insert into public.users (
    id, display_name, email, whatsapp, username, user_id, roles, has_auth, temp_password
  )
  values (
    new.id,
    incoming_name,
    new.email,
    incoming_phone,
    null,
    public.generate_public_user_id(),
    coalesce(nullif(trim(new.raw_user_meta_data->>'roles'), ''), 'client'),
    true,
    null
  )
  on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(public.users.display_name, excluded.display_name),
      whatsapp = coalesce(public.users.whatsapp, excluded.whatsapp),
      has_auth = true,
      user_id = coalesce(nullif(trim(public.users.user_id), ''), excluded.user_id),
      roles = coalesce(nullif(trim(public.users.roles), ''), excluded.roles);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_sync_public_users on auth.users;
create trigger on_auth_user_created_sync_public_users
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

create or replace function public.email_is_registered(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where lower(email) = lower(trim(p_email))
  );
$$;

revoke all on function public.email_is_registered(text) from public;
grant execute on function public.email_is_registered(text) to anon, authenticated;

alter table public.users enable row level security;

drop policy if exists "users_select_authenticated" on public.users;
drop policy if exists "users_select_own_or_admin" on public.users;
drop policy if exists "users_update_own_allowed" on public.users;
drop policy if exists "users_update_own_ig_username" on public.users;
drop policy if exists "users_admin_all" on public.users;

create policy "users_select_own_or_admin"
on public.users
for select
to authenticated
using (id = auth.uid() or public.is_admin());

create policy "users_update_own_profile"
on public.users
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and public.own_profile_security_snapshot() = jsonb_build_object(
    'user_id', user_id,
    'roles', roles,
    'has_auth', has_auth,
    'temp_password', temp_password,
    'old_id', old_id,
    'passline_tracking', passline_tracking,
    'occupations', occupations
  )
);

create policy "users_admin_all"
on public.users
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Remove direct client access to the temporary password column.
revoke all on table public.users from anon, authenticated;
grant select (
  id, user_id, display_name, email, whatsapp, avatar_url, username,
  roles, has_auth, ig_username, occupations, old_id, passline_tracking
) on table public.users to authenticated;
grant update on table public.users to authenticated;

drop view if exists public.users_safe;
create view public.users_safe
with (security_invoker = true)
as
select
  id, user_id, display_name, email, whatsapp, avatar_url, username,
  roles, has_auth, ig_username, occupations, old_id, passline_tracking
from public.users;

revoke all on public.users_safe from anon, authenticated;
grant select on public.users_safe to authenticated;

commit;
