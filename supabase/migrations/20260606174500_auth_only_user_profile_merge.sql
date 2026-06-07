-- Hidden Room / MysAuth
-- Refine admin user merge:
-- Keep all operational history from the historical public.users.user_id.
-- Take only Auth identity/email from the duplicate profile.

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

  -- Keep historical permissions, but attach them to the new Auth UUID.
  update public.user_permissions
  set user_id = duplicate_profile.id::text
  where user_id = keep_profile.id::text;

  -- Remove duplicated public profile only. We intentionally do not move
  -- transactions/sessions/scores/etc. from duplicate_profile.user_id because
  -- the historical p_keep_user_id is the source of truth.
  delete from public.users
  where id = duplicate_profile.id;

  update public.users
  set
    id = duplicate_profile.id,
    email = duplicate_profile.email,
    whatsapp = coalesce(nullif(keep_profile.whatsapp, ''), duplicate_profile.whatsapp),
    display_name = keep_profile.display_name,
    username = keep_profile.username,
    roles = coalesce(nullif(keep_profile.roles, ''), 'client'),
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
    'email', duplicate_profile.email,
    'ignored_duplicate_user_id', duplicate_profile.user_id
  );
end;
$$;

revoke all on function public.admin_merge_public_user_profiles(text, text) from public;
grant execute on function public.admin_merge_public_user_profiles(text, text) to authenticated;
