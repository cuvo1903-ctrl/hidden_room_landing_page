-- Hidden Room / MysAuth
-- Temporary Instagram contest rewards linked by public.users.ig_username.

create table if not exists public.ig_contest (
  id uuid primary key default gen_random_uuid(),
  concepto text not null,
  user_id text,
  ig_username text not null,
  created_at timestamptz not null default now()
);

create index if not exists ig_contest_ig_username_idx
  on public.ig_contest (lower(btrim(ig_username)));

create index if not exists ig_contest_user_id_idx
  on public.ig_contest (user_id);

alter table public.ig_contest enable row level security;

drop policy if exists "ig_contest_admin_all" on public.ig_contest;
create policy "ig_contest_admin_all"
on public.ig_contest
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "ig_contest_select_own_by_ig_username" on public.ig_contest;
create policy "ig_contest_select_own_by_ig_username"
on public.ig_contest
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and nullif(btrim(u.ig_username), '') is not null
      and lower(btrim(u.ig_username)) = lower(btrim(public.ig_contest.ig_username))
  )
);

grant select on table public.ig_contest to authenticated;
grant insert, update, delete on table public.ig_contest to authenticated;

comment on table public.ig_contest is
  'Temporary IG contest rewards linked to active users by ig_username.';
