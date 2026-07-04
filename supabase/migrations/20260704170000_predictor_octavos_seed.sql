insert into public.predictor_matches (
  home_team,
  away_team,
  home_flag,
  away_flag,
  stage,
  kickoff_at,
  status
)
values
  ('Canada', 'Marruecos', '🇨🇦', '🇲🇦', 'Octavos', '2026-07-04T11:00:00-06:00', 'locked'),
  ('Paraguay', 'Francia', '🇵🇾', '🇫🇷', 'Octavos', '2026-07-04T15:00:00-06:00', 'open'),
  ('Brasil', 'Noruega', '🇧🇷', '🇳🇴', 'Octavos', '2026-07-05T14:00:00-06:00', 'open'),
  ('Mexico', 'Inglaterra', '🇲🇽', '🏴', 'Octavos', '2026-07-05T18:00:00-06:00', 'open'),
  ('Portugal', 'Espana', '🇵🇹', '🇪🇸', 'Octavos', '2026-07-06T13:00:00-06:00', 'open'),
  ('Estados Unidos', 'Belgica', '🇺🇸', '🇧🇪', 'Octavos', '2026-07-06T18:00:00-06:00', 'open'),
  ('Argentina', 'Egipto', '🇦🇷', '🇪🇬', 'Octavos', '2026-07-07T10:00:00-06:00', 'open'),
  ('Suiza', 'Colombia', '🇨🇭', '🇨🇴', 'Octavos', '2026-07-07T14:00:00-06:00', 'open')
on conflict (home_team, away_team, kickoff_at)
do update set
  home_flag = excluded.home_flag,
  away_flag = excluded.away_flag,
  stage = excluded.stage,
  status = excluded.status;
