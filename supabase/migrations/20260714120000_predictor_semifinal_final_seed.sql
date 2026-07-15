insert into public.predictor_matches (
  home_team,
  away_team,
  stage,
  kickoff_at,
  status,
  home_score,
  away_score
)
values
  ('Francia', 'Espana', 'Semifinal', '2026-07-14T14:00:00-05:00', 'final', 0, 2),
  ('Inglaterra', 'Argentina', 'Semifinal', '2026-07-15T14:00:00-05:00', 'open', null, null),
  ('Espana', 'Ganador Inglaterra/Argentina', 'Final', '2026-07-19T13:00:00-05:00', 'open', null, null)
on conflict (home_team, away_team, kickoff_at)
do update set
  stage = excluded.stage,
  status = excluded.status,
  home_score = excluded.home_score,
  away_score = excluded.away_score;