-- Hidden Room / MysAuth dashboard support
-- Run in the Supabase SQL editor with owner privileges.

alter table public.users
  add column if not exists temp_password text;

create unique index if not exists scores_user_game_type_unique
  on public.scores (user_id, game_id, type);

create or replace function public.prevent_lower_score_record()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'record' then
    if tg_op = 'UPDATE' and old.amount is not null and new.amount < old.amount then
      new.amount := old.amount;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_lower_score_record_before_update on public.scores;

create trigger prevent_lower_score_record_before_update
before update on public.scores
for each row
execute function public.prevent_lower_score_record();

-- Optional but recommended if you do not already have equivalent RLS policies.
alter table public.users enable row level security;
alter table public.scores enable row level security;

drop policy if exists "users_select_authenticated" on public.users;
create policy "users_select_authenticated"
on public.users
for select
to authenticated
using (true);

drop policy if exists "scores_select_own" on public.scores;
create policy "scores_select_own"
on public.scores
for select
to authenticated
using (
  user_id in (
    select u.user_id
    from public.users u
    where u.id = auth.uid()
  )
);

drop policy if exists "scores_insert_own_record" on public.scores;
create policy "scores_insert_own_record"
on public.scores
for insert
to authenticated
with check (
  type = 'record'
  and user_id in (
    select u.user_id
    from public.users u
    where u.id = auth.uid()
  )
);

drop policy if exists "scores_update_own_record" on public.scores;
create policy "scores_update_own_record"
on public.scores
for update
to authenticated
using (
  type = 'record'
  and user_id in (
    select u.user_id
    from public.users u
    where u.id = auth.uid()
  )
)
with check (
  type = 'record'
  and user_id in (
    select u.user_id
    from public.users u
    where u.id = auth.uid()
  )
);
