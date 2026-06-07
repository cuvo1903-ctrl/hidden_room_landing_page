-- Hidden Room / MysAuth
-- Safely link new Auth signups to pre-created public.users profiles.
--
-- Automatic linking is intentionally conservative:
-- - only by a valid, unique WhatsApp value
-- - only if the existing public.users row is not already linked to auth.users
-- - keeps the historical public.users.user_id, username, roles, and history

create or replace function public.normalize_phone_digits(p_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
$$;

create or replace function public.is_claimable_phone(p_phone text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    public.normalize_phone_digits(p_phone) is not null
    and length(public.normalize_phone_digits(p_phone)) >= 10
    and public.normalize_phone_digits(p_phone) !~ '^(0+|1+|2+|3+|4+|5+|6+|7+|8+|9+)$';
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  incoming_whatsapp text;
  matched_profile_id uuid;
begin
  incoming_whatsapp := public.normalize_phone_digits(
    coalesce(new.phone, new.raw_user_meta_data->>'whatsapp', '')
  );

  if public.is_claimable_phone(incoming_whatsapp) then
    with matches as (
      select u.id
      from public.users u
      left join auth.users au on au.id = u.id
      where public.normalize_phone_digits(u.whatsapp) = incoming_whatsapp
        and au.id is null
    )
    select m.id
    into matched_profile_id
    from matches m
    where (select count(*) from matches) = 1
    limit 1;
  end if;

  if matched_profile_id is not null then
    update public.users
    set
      id = new.id,
      display_name = coalesce(
        nullif(display_name, ''),
        nullif(coalesce(new.raw_user_meta_data->>'display_name', ''), '')
      ),
      email = new.email,
      whatsapp = incoming_whatsapp,
      roles = coalesce(nullif(roles, ''), coalesce(nullif(new.raw_user_meta_data->>'roles', ''), 'client')),
      user_id = coalesce(nullif(user_id, ''), public.generate_public_user_id()),
      has_auth = true,
      temp_password = null
    where id = matched_profile_id;

    return new;
  end if;

  insert into public.users (
    id,
    display_name,
    email,
    whatsapp,
    username,
    user_id,
    roles,
    has_auth,
    temp_password
  )
  values (
    new.id,
    nullif(coalesce(new.raw_user_meta_data->>'display_name', ''), ''),
    new.email,
    incoming_whatsapp,
    null,
    public.generate_public_user_id(),
    coalesce(nullif(new.raw_user_meta_data->>'roles', ''), 'client'),
    true,
    null
  )
  on conflict (id) do update
  set
    display_name = coalesce(public.users.display_name, excluded.display_name),
    email = excluded.email,
    whatsapp = coalesce(public.users.whatsapp, excluded.whatsapp),
    roles = coalesce(public.users.roles, excluded.roles),
    user_id = coalesce(nullif(public.users.user_id, ''), excluded.user_id),
    has_auth = true;

  return new;
end;
$$;

create or replace function public.admin_merge_public_user_profiles(
  p_keep_user_id text,
  p_duplicate_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  keep_profile public.users%rowtype;
  duplicate_profile public.users%rowtype;
  old_auth_id uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'Forbidden';
  end if;

  select *
  into keep_profile
  from public.users
  where user_id = p_keep_user_id
  limit 1;

  if keep_profile.id is null then
    raise exception 'Profile to keep was not found';
  end if;

  select *
  into duplicate_profile
  from public.users
  where lower(email) = lower(trim(p_duplicate_email))
  limit 1;

  if duplicate_profile.id is null then
    raise exception 'Duplicate profile was not found';
  end if;

  if keep_profile.id = duplicate_profile.id then
    raise exception 'Profiles are already the same row';
  end if;

  old_auth_id := keep_profile.id;

  update public.scores
  set user_id = keep_profile.user_id,
      username = coalesce(username, keep_profile.username, keep_profile.display_name)
  where user_id = duplicate_profile.user_id;

  update public.rewards
  set user_id = keep_profile.user_id,
      username = coalesce(username, keep_profile.username, keep_profile.display_name)
  where user_id = duplicate_profile.user_id;

  update public.transactions
  set user_id = keep_profile.user_id,
      username = coalesce(username, keep_profile.username, keep_profile.display_name)
  where user_id = duplicate_profile.user_id;

  update public.sessions
  set user_id = keep_profile.user_id,
      username = coalesce(username, keep_profile.username, keep_profile.display_name)
  where user_id = duplicate_profile.user_id;

  update public.downloads
  set user_id = keep_profile.user_id,
      username = coalesce(username, keep_profile.username, keep_profile.display_name)
  where user_id = duplicate_profile.user_id;

  update public.contracts
  set user_id = keep_profile.user_id,
      username = coalesce(username, keep_profile.username, keep_profile.display_name)
  where user_id = duplicate_profile.user_id;

  update public.user_permissions
  set user_id = duplicate_profile.id::text
  where user_id = keep_profile.id::text;

  delete from public.users
  where id = duplicate_profile.id;

  update public.users
  set
    id = duplicate_profile.id,
    email = duplicate_profile.email,
    whatsapp = coalesce(nullif(keep_profile.whatsapp, ''), duplicate_profile.whatsapp),
    display_name = coalesce(nullif(keep_profile.display_name, ''), duplicate_profile.display_name),
    username = keep_profile.username,
    roles = coalesce(nullif(keep_profile.roles, ''), duplicate_profile.roles, 'client'),
    user_id = keep_profile.user_id,
    has_auth = true,
    old_id = old_auth_id,
    temp_password = null
  where id = keep_profile.id;

  return jsonb_build_object(
    'success', true,
    'kept_user_id', keep_profile.user_id,
    'new_auth_id', duplicate_profile.id,
    'old_auth_id', old_auth_id,
    'email', duplicate_profile.email
  );
end;
$$;

revoke all on function public.admin_merge_public_user_profiles(text, text) from public;
grant execute on function public.admin_merge_public_user_profiles(text, text) to authenticated;
