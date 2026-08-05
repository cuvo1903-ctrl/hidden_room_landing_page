-- Hidden Room / MysAuth
-- Link IG contest rows to operational users through public.users.user_id.

create or replace function public.hr_normalize_ig_username(p_value text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_value, ''))), '^https?://(www\.)?instagram\.com/', ''),
        '^@+',
        ''
      ),
      '[/?#].*$',
      ''
    ),
    ''
  );
$$;

create or replace function public.set_ig_contest_user_id_from_ig_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_user_id text;
begin
  new.ig_username := public.hr_normalize_ig_username(new.ig_username);

  if new.ig_username is null then
    raise exception 'ig_username is required';
  end if;

  select u.user_id
    into matched_user_id
  from public.users u
  where public.hr_normalize_ig_username(u.ig_username) = new.ig_username
    and nullif(btrim(u.user_id), '') is not null
  order by u.has_auth desc nulls last, u.id
  limit 1;

  new.user_id := matched_user_id;
  return new;
end;
$$;

drop trigger if exists set_ig_contest_user_id_from_ig_username_before on public.ig_contest;
create trigger set_ig_contest_user_id_from_ig_username_before
before insert or update of ig_username
on public.ig_contest
for each row
execute function public.set_ig_contest_user_id_from_ig_username();

update public.ig_contest ic
set
  ig_username = public.hr_normalize_ig_username(ic.ig_username),
  user_id = u.user_id
from public.users u
where public.hr_normalize_ig_username(ic.ig_username) = public.hr_normalize_ig_username(u.ig_username)
  and nullif(btrim(u.user_id), '') is not null;

drop policy if exists "ig_contest_select_own_by_ig_username" on public.ig_contest;
drop policy if exists "ig_contest_select_own_by_user_id" on public.ig_contest;
create policy "ig_contest_select_own_by_user_id"
on public.ig_contest
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and nullif(btrim(u.user_id), '') is not null
      and u.user_id = public.ig_contest.user_id
  )
);

comment on table public.ig_contest is
  'Temporary IG contest rewards linked to active users by user_id resolved from ig_username.';
