drop policy if exists "predictor matches admin insert" on public.predictor_matches;
create policy "predictor matches admin insert"
on public.predictor_matches
for insert
to authenticated
with check (public.predictor_can_manage_matches());

drop policy if exists "predictor matches admin update" on public.predictor_matches;
create policy "predictor matches admin update"
on public.predictor_matches
for update
to authenticated
using (public.predictor_can_manage_matches())
with check (public.predictor_can_manage_matches());

drop policy if exists "predictor matches admin delete" on public.predictor_matches;
create policy "predictor matches admin delete"
on public.predictor_matches
for delete
to authenticated
using (public.predictor_can_manage_matches());

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
  if not public.predictor_can_manage_matches() then
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

grant execute on function public.finalize_predictor_match(uuid, int, int) to authenticated;
