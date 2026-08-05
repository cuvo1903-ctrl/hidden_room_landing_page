create extension if not exists pgcrypto;

create table if not exists public.predictor_matches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  home_team text not null,
  away_team text not null,
  home_flag text default '',
  away_flag text default '',
  stage text default 'Mundial',
  kickoff_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'locked', 'final', 'cancelled')),
  home_score int,
  away_score int,
  actual_winner text check (actual_winner in ('home', 'away', 'draw')),
  finalized_at timestamptz
);

create table if not exists public.predictor_predictions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  match_id uuid not null references public.predictor_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  predicted_winner text not null check (predicted_winner in ('home', 'away', 'draw')),
  home_score int not null check (home_score >= 0 and home_score <= 50),
  away_score int not null check (away_score >= 0 and away_score <= 50),
  points_awarded int not null default 0,
  coins_awarded int not null default 0,
  exact_score_hit boolean not null default false,
  winner_hit boolean not null default false,
  scored_at timestamptz,
  unique(match_id, user_id)
);

create index if not exists predictor_matches_kickoff_idx
  on public.predictor_matches (kickoff_at, status);

create unique index if not exists predictor_matches_fixture_key
  on public.predictor_matches (home_team, away_team, kickoff_at);

create index if not exists predictor_predictions_user_idx
  on public.predictor_predictions (user_id, created_at desc);

create index if not exists predictor_predictions_match_idx
  on public.predictor_predictions (match_id);

create or replace function public.touch_predictor_prediction_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_predictor_prediction_updated_at on public.predictor_predictions;
create trigger trg_touch_predictor_prediction_updated_at
before update on public.predictor_predictions
for each row execute function public.touch_predictor_prediction_updated_at();

create or replace function public.predictor_match_is_open(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.predictor_matches m
    where m.id = p_match_id
      and m.status = 'open'
      and m.kickoff_at > now()
  );
$$;

alter table public.predictor_matches enable row level security;
alter table public.predictor_predictions enable row level security;

drop policy if exists "predictor matches read authenticated" on public.predictor_matches;
create policy "predictor matches read authenticated"
on public.predictor_matches
for select
to authenticated
using (true);

drop policy if exists "predictor matches admin insert" on public.predictor_matches;
create policy "predictor matches admin insert"
on public.predictor_matches
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "predictor matches admin update" on public.predictor_matches;
create policy "predictor matches admin update"
on public.predictor_matches
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "predictor matches admin delete" on public.predictor_matches;
create policy "predictor matches admin delete"
on public.predictor_matches
for delete
to authenticated
using (public.is_admin());

drop policy if exists "predictor predictions own and revealed read" on public.predictor_predictions;
create policy "predictor predictions own and revealed read"
on public.predictor_predictions
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.predictor_matches m
    where m.id = predictor_predictions.match_id
      and (m.status in ('locked', 'final') or m.kickoff_at <= now())
  )
);

drop policy if exists "predictor predictions own open insert" on public.predictor_predictions;
create policy "predictor predictions own open insert"
on public.predictor_predictions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.predictor_match_is_open(match_id)
);

drop policy if exists "predictor predictions own open update" on public.predictor_predictions;
create policy "predictor predictions own open update"
on public.predictor_predictions
for update
to authenticated
using (
  user_id = auth.uid()
  and public.predictor_match_is_open(match_id)
)
with check (
  user_id = auth.uid()
  and public.predictor_match_is_open(match_id)
);

create or replace function public.finalize_predictor_match(
  p_match_id uuid,
  p_home_score int,
  p_away_score int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winner text;
begin
  if not public.is_admin() then
    raise exception 'Solo admin puede finalizar partidos';
  end if;

  if p_home_score < 0 or p_away_score < 0 then
    raise exception 'Marcador invalido';
  end if;

  v_winner := case
    when p_home_score > p_away_score then 'home'
    when p_away_score > p_home_score then 'away'
    else 'draw'
  end;

  update public.predictor_matches
  set status = 'final',
      home_score = p_home_score,
      away_score = p_away_score,
      actual_winner = v_winner,
      finalized_at = now()
  where id = p_match_id;

  update public.predictor_predictions p
  set winner_hit = (p.predicted_winner = v_winner),
      exact_score_hit = (p.home_score = p_home_score and p.away_score = p_away_score),
      points_awarded =
        case when p.predicted_winner = v_winner then 3 else 0 end +
        case when p.home_score = p_home_score and p.away_score = p_away_score then 5 else 0 end +
        case when p.predicted_winner = v_winner and p.home_score = p_home_score and p.away_score = p_away_score then 2 else 0 end,
      coins_awarded =
        case when p.predicted_winner = v_winner then 10 else 0 end +
        case when p.home_score = p_home_score and p.away_score = p_away_score then 20 else 0 end,
      scored_at = now()
  where p.match_id = p_match_id;
end;
$$;

create or replace view public.predictor_leaderboard as
select
  p.user_id,
  coalesce(u.display_name, u.username, u.email, left(p.user_id::text, 8)) as username,
  sum(p.points_awarded)::int as total_points,
  sum(p.coins_awarded)::int as total_coins,
  count(*)::int as predictions_count,
  count(*) filter (where p.winner_hit)::int as winner_hits,
  count(*) filter (where p.exact_score_hit)::int as exact_hits
from public.predictor_predictions p
left join public.users u on u.id = p.user_id
group by p.user_id, u.display_name, u.username, u.email
order by total_points desc, exact_hits desc, winner_hits desc, predictions_count desc;

grant select, insert, update, delete on public.predictor_matches to authenticated;
grant select, insert, update on public.predictor_predictions to authenticated;
grant select on public.predictor_leaderboard to authenticated;
grant execute on function public.predictor_match_is_open(uuid) to authenticated;
grant execute on function public.finalize_predictor_match(uuid, int, int) to authenticated;

insert into public.predictor_matches (home_team, away_team, home_flag, away_flag, stage, kickoff_at)
values
  ('Mexico', 'Inglaterra', 'MX', 'ENG', 'Octavos', '2026-07-05 18:00:00-06'),
  ('Brasil', 'Noruega', 'BR', 'NO', 'Octavos', '2026-07-05 14:00:00-06'),
  ('Portugal', 'Espana', 'PT', 'ES', 'Octavos', '2026-07-06 13:00:00-06')
on conflict (home_team, away_team, kickoff_at) do nothing;
