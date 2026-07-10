-- Hidden Room / deferred IG rewards and courtesy tickets.
-- When a user later registers their Instagram, pending IG contest rows are linked
-- and HRCDMX-17-21 courtesy tickets are materialized in event_tickets.

create or replace function public.sync_ig_contest_benefits_for_user(
  p_user_id text,
  p_ig_username text,
  p_display_name text default null,
  p_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_ig text;
begin
  normalized_ig := public.hr_normalize_ig_username(p_ig_username);

  if normalized_ig is null or nullif(btrim(coalesce(p_user_id, '')), '') is null then
    return;
  end if;

  update public.ig_contest ic
  set user_id = p_user_id
  where public.hr_normalize_ig_username(ic.ig_username) = normalized_ig
    and (ic.user_id is null or ic.user_id is distinct from p_user_id);

  insert into public.event_tickets (
    event_key,
    folio,
    qr_payload,
    status,
    price,
    created_by,
    notes,
    customer_name,
    customer_email,
    ticket_type,
    user_id
  )
  select distinct
    'HRCDMX-17-21',
    'HRCDMX-17-21-CORT-' || regexp_replace(upper(normalized_ig), '[^A-Z0-9]+', '_', 'g'),
    'https://hiddenroom.mx/tickets/validate.html?folio=HRCDMX-17-21-CORT-' || regexp_replace(upper(normalized_ig), '[^A-Z0-9]+', '_', 'g'),
    'valid',
    0,
    'ig-contest-auto-sync',
    'CORTESÍA HRCDMX-17-21 auto vinculada por ig_username @' || normalized_ig,
    coalesce(nullif(btrim(p_display_name), ''), normalized_ig),
    nullif(btrim(p_email), ''),
    'CORTESÍA',
    p_user_id
  from public.ig_contest ic
  where btrim(lower(ic.concepto)) = lower('CORTESÍA HRCDMX-17-21')
    and public.hr_normalize_ig_username(ic.ig_username) = normalized_ig
  on conflict (folio) do update
  set
    user_id = excluded.user_id,
    customer_name = coalesce(nullif(public.event_tickets.customer_name, ''), excluded.customer_name),
    customer_email = coalesce(nullif(public.event_tickets.customer_email, ''), excluded.customer_email),
    qr_payload = excluded.qr_payload,
    ticket_type = excluded.ticket_type,
    updated_at = now();
end;
$$;

create or replace function public.sync_ig_contest_benefits_from_users_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_ig_contest_benefits_for_user(
    new.user_id,
    new.ig_username,
    new.display_name,
    new.email
  );
  return new;
end;
$$;

drop trigger if exists sync_ig_contest_benefits_after_users_change on public.users;
create trigger sync_ig_contest_benefits_after_users_change
after insert or update of user_id, ig_username, display_name, email
on public.users
for each row
execute function public.sync_ig_contest_benefits_from_users_trigger();

create or replace function public.sync_ig_contest_benefits_from_ig_contest_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_user public.users%rowtype;
begin
  if btrim(lower(coalesce(new.concepto, ''))) <> lower('CORTESÍA HRCDMX-17-21') then
    return new;
  end if;

  if nullif(btrim(coalesce(new.user_id, '')), '') is null then
    return new;
  end if;

  select *
    into matched_user
  from public.users u
  where u.user_id = new.user_id
  order by u.has_auth desc nulls last, u.id
  limit 1;

  if matched_user.user_id is not null then
    perform public.sync_ig_contest_benefits_for_user(
      matched_user.user_id,
      coalesce(matched_user.ig_username, new.ig_username),
      matched_user.display_name,
      matched_user.email
    );
  end if;

  return new;
end;
$$;

drop trigger if exists sync_ig_contest_benefits_after_ig_contest_change on public.ig_contest;
create trigger sync_ig_contest_benefits_after_ig_contest_change
after insert or update of user_id, ig_username, concepto
on public.ig_contest
for each row
execute function public.sync_ig_contest_benefits_from_ig_contest_trigger();

-- Backfill existing pending rows for users that already have ig_username + user_id.
update public.ig_contest ic
set user_id = u.user_id
from public.users u
where public.hr_normalize_ig_username(ic.ig_username) = public.hr_normalize_ig_username(u.ig_username)
  and nullif(btrim(u.user_id), '') is not null
  and (ic.user_id is null or ic.user_id is distinct from u.user_id);

select public.sync_ig_contest_benefits_for_user(u.user_id, u.ig_username, u.display_name, u.email)
from public.users u
where public.hr_normalize_ig_username(u.ig_username) is not null
  and nullif(btrim(u.user_id), '') is not null;