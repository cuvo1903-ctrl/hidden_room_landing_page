# Kien Gana

Minijuego de predicciones de partidos conectado al proyecto Supabase de Hidden Room.

## Archivos

- `index.html`: interfaz principal con chrome global de `site.js`.
- `styles.css`: adaptador local sobre `../../styles.css`.
- `app.js`: sesion, predicciones, ranking y panel admin.
- `supabase/migrations/20260704153000_predictor_kien_gana.sql`: tablas, RLS, RPC de puntuacion y seed inicial.

## Como funciona

- El usuario inicia sesion con MysAuth/Supabase.
- Ve partidos abiertos y guarda ganador + marcador.
- Al llegar la hora del partido, la prediccion queda bloqueada por RLS.
- Un admin crea partidos y finaliza resultados desde el tab Admin.
- `finalize_predictor_match` calcula puntos y coins.
- `predictor_leaderboard` alimenta el ranking global.

## Puntuacion

- Ganador correcto: +3 puntos, +10 coins.
- Marcador exacto: +5 puntos, +20 coins.
- Bonus ganador + marcador: +2 puntos.

## Admin

El panel Admin aparece para usuarios cuyo `public.users.roles` incluya `admin`. Las mutaciones tambien se protegen en Supabase con `public.is_admin()`.
