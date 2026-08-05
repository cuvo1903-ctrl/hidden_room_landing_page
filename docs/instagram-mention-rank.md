# Instagram Mention Rank

Herramienta admin en `Portal > ERP > Instagram Mention Rank`.

## Archivos

- Frontend: `portal/dashboard.html`, `portal/dashboard.js`, `portal/dashboard.css`.
- Edge Functions: `supabase/functions/ig-list-media`, `supabase/functions/ig-analyze-comments`.
- Tabla: `supabase/migrations/20260705120000_create_ig_mention_analyses.sql`.

## Secretos

Para pruebas iniciales puedes pegar `access_token` en la herramienta. El token no se guarda en `localStorage` ni en Supabase.

Para moverlo fuera del frontend, configura el secreto:

```powershell
supabase secrets set IG_ACCESS_TOKEN="TU_TOKEN_DE_INSTAGRAM"
```

Con ese secreto, las funciones aceptan requests sin `access_token` en el body.

## Deploy

Estos comandos afectan el proyecto Supabase vinculado:

```powershell
supabase db push
supabase functions deploy ig-list-media
supabase functions deploy ig-analyze-comments
```

## Pruebas con curl

Usa un JWT de una sesion admin de Supabase en `SUPABASE_USER_JWT`.

```powershell
$env:SUPABASE_URL="https://rpcunbkstadgngqrjafp.supabase.co"
$env:SUPABASE_USER_JWT="JWT_ADMIN"
$env:IG_ACCESS_TOKEN="TOKEN_INSTAGRAM"

curl.exe -X POST "$env:SUPABASE_URL/functions/v1/ig-list-media" `
  -H "Authorization: Bearer $env:SUPABASE_USER_JWT" `
  -H "Content-Type: application/json" `
  -d "{`"access_token`":`"$env:IG_ACCESS_TOKEN`",`"limit`":25}"
```

```powershell
curl.exe -X POST "$env:SUPABASE_URL/functions/v1/ig-analyze-comments" `
  -H "Authorization: Bearer $env:SUPABASE_USER_JWT" `
  -H "Content-Type: application/json" `
  -d "{`"access_token`":`"$env:IG_ACCESS_TOKEN`",`"media_id`":`"MEDIA_ID`",`"media_permalink`":`"https://www.instagram.com/p/.../`"}"
```

## Validacion local

```powershell
node --check portal/dashboard.js
deno check supabase/functions/ig-list-media/index.ts
deno check supabase/functions/ig-analyze-comments/index.ts
```
