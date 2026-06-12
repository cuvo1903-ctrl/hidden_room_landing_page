-- Move event finance participant references from counterparty UUIDs to operational user_id.

alter table public.hr_transactions
add column if not exists from_user_id text,
add column if not exists to_user_id text,
add column if not exists owner_user_id text;

create index if not exists hr_transactions_from_user_id_idx
  on public.hr_transactions (from_user_id);

create index if not exists hr_transactions_to_user_id_idx
  on public.hr_transactions (to_user_id);

create index if not exists hr_transactions_owner_user_id_idx
  on public.hr_transactions (owner_user_id);

create index if not exists event_participations_event_user_id_idx
  on public.event_participations (event_id, user_id);

delete from public.event_participations
where event_id is null
   or nullif(trim(user_id), '') is null;

alter table public.event_participations
alter column event_id set not null,
alter column user_id set not null;

alter table public.event_participations
drop constraint if exists event_participations_event_id_user_id_key;

alter table public.event_participations
add constraint event_participations_event_id_user_id_key unique (event_id, user_id);

drop index if exists public.hr_transactions_from_counterparty_id_idx;
drop index if exists public.hr_transactions_to_counterparty_id_idx;
drop index if exists public.hr_transactions_owner_counterparty_id_idx;

drop view if exists public.hr_event_transactions_clean;

alter table public.hr_transactions
drop column if exists from_counterparty_id,
drop column if exists to_counterparty_id,
drop column if exists owner_counterparty_id;

alter table public.event_participations
drop column if exists counterparty_id;

drop table if exists public.event_counterparties;

create or replace view public.hr_event_transactions_clean as
select
  created_at,
  concept,
  user_id,
  username,
  amount,
  date,
  notes,
  div,
  event_key,
  via,
  type,
  class,
  id,
  "M.A.I.",
  event_id,
  movement_type,
  hidden_room_share as mai_amount,
  from_user_id,
  to_user_id,
  owner_user_id,
  payment_method,
  movement_date
from public.hr_transactions
where amount is not null;

grant select on public.hr_event_transactions_clean to authenticated;
