update public.predictor_matches
set
  home_team = trim(concat(nullif(trim(coalesce(home_flag, '')), ''), ' ', home_team)),
  away_team = trim(concat(nullif(trim(coalesce(away_flag, '')), ''), ' ', away_team))
where
  nullif(trim(coalesce(home_flag, '')), '') is not null
  or nullif(trim(coalesce(away_flag, '')), '') is not null;

alter table public.predictor_matches
  drop column if exists home_flag,
  drop column if exists away_flag;
