insert into public.predictor_matches (
  home_team,
  away_team,
  stage,
  kickoff_at,
  status
)
values
  ('Francia', 'Marruecos', 'Cuartos', '2026-07-09T14:00:00-06:00', 'open'),
  ('Espana', 'Belgica', 'Cuartos', '2026-07-10T13:00:00-06:00', 'open'),
  ('Noruega', 'Inglaterra', 'Cuartos', '2026-07-11T15:00:00-06:00', 'open'),
  ('Argentina', 'Suiza', 'Cuartos', '2026-07-11T19:00:00-06:00', 'open')
on conflict (home_team, away_team, kickoff_at)
do update set
  stage = excluded.stage,
  status = excluded.status;
