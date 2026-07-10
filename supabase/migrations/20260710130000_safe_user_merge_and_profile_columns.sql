-- Hidden Room / MysAuth
-- Add operational profile metadata and make user merge preserve auth.users/public.users rows.

alter table public.users
  add column if not exists occupations text[] not null default array['Comunidad']::text[],
  add column if not exists ig_username text;

comment on column public.users.occupations is
  'Operational reference only. Not an auth role. Users can have multiple occupations.';

comment on column public.users.ig_username is
  'Instagram username for operational reference.';

alter table public.passline_tickets
  add column if not exists user_id text;

create index if not exists passline_tickets_user_id_idx
  on public.passline_tickets (user_id);

comment on column public.passline_tickets.user_id is
  'Optional Hidden Room operational user_id used to link imported ticket transactions to real users.';

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
  historical_profile public.users%rowtype;
  auth_profile public.users%rowtype;
  historical_user_id text;
  target_user_id text;
  rows_moved integer := 0;
  moved_counts jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'Forbidden';
  end if;

  select *
  into historical_profile
  from public.users
  where user_id = nullif(trim(p_keep_user_id), '')
  limit 1;

  if historical_profile.id is null then
    raise exception 'Historical profile was not found';
  end if;

  select *
  into auth_profile
  from public.users
  where lower(email) = lower(nullif(trim(p_duplicate_email), ''))
  order by has_auth desc nulls last
  limit 1;

  if auth_profile.id is null then
    raise exception 'Auth/login profile was not found';
  end if;

  if auth_profile.user_id is null or btrim(auth_profile.user_id) = '' then
    raise exception 'Auth/login profile does not have an operational user_id';
  end if;

  historical_user_id := historical_profile.user_id;
  target_user_id := auth_profile.user_id;

  if historical_user_id = target_user_id then
    return jsonb_build_object(
      'success', true,
      'noop', true,
      'historical_user_id', historical_user_id,
      'target_user_id', target_user_id,
      'email', auth_profile.email,
      'message', 'Profiles already point to the same operational user_id'
    );
  end if;

  if to_regclass('public.transactions') is not null then
    update public.transactions set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{transactions}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.sessions') is not null then
    update public.sessions set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{sessions}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.downloads') is not null then
    update public.downloads set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{downloads}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.contracts') is not null then
    update public.contracts set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{contracts}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.rewards') is not null then
    update public.rewards set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{rewards}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.memberships') is not null then
    update public.memberships set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{memberships}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.membership_material_deliveries') is not null then
    update public.membership_material_deliveries set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{membership_material_deliveries}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.hr_transactions') is not null then
    update public.hr_transactions set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{hr_transactions_user_id}', to_jsonb(rows_moved), true);

    update public.hr_transactions set from_user_id = target_user_id where from_user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{hr_transactions_from_user_id}', to_jsonb(rows_moved), true);

    update public.hr_transactions set to_user_id = target_user_id where to_user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{hr_transactions_to_user_id}', to_jsonb(rows_moved), true);

    update public.hr_transactions set owner_user_id = target_user_id where owner_user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{hr_transactions_owner_user_id}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.scores') is not null then
    update public.scores s
    set user_id = target_user_id
    where s.user_id = historical_user_id
      and not exists (
        select 1
        from public.scores existing
        where existing.user_id = target_user_id
          and existing.game_id is not distinct from s.game_id
          and existing.type is not distinct from s.type
      );
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{scores}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.event_participations') is not null then
    update public.event_participations ep
    set user_id = target_user_id
    where ep.user_id = historical_user_id
      and not exists (
        select 1
        from public.event_participations existing
        where existing.user_id = target_user_id
          and existing.event_id is not distinct from ep.event_id
      );
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{event_participations}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.participants') is not null then
    update public.participants p
    set user_id = target_user_id
    where p.user_id = historical_user_id
      and not exists (
        select 1
        from public.participants existing
        where existing.user_id = target_user_id
      );
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{participants}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.notifications') is not null then
    update public.notifications set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{notifications}', to_jsonb(rows_moved), true);
  end if;

  if to_regclass('public.passline_tickets') is not null then
    update public.passline_tickets set user_id = target_user_id where user_id = historical_user_id;
    get diagnostics rows_moved = row_count;
    moved_counts := jsonb_set(moved_counts, '{passline_tickets}', to_jsonb(rows_moved), true);
  end if;

  return jsonb_build_object(
    'success', true,
    'historical_user_id', historical_user_id,
    'target_user_id', target_user_id,
    'email', auth_profile.email,
    'public_users_preserved', true,
    'auth_users_preserved', true,
    'moved_counts', moved_counts
  );
end;
$$;

revoke all on function public.admin_merge_public_user_profiles(text, text) from public;
grant execute on function public.admin_merge_public_user_profiles(text, text) to authenticated;
