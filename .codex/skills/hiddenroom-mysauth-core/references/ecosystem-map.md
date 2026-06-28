# Ecosystem Map

## Brand and Public Site

- Root route `/` is the Hidden Room public site.
- Main files: `index.html`, `site.js`, `styles.css`.
- Public messaging in repo includes "La Casa del Under" and Hidden Room as part of Grupo Mysauth.
- Assets live under `assets/img`, `assets/sprites`, and `assets/sounds`.
- `CNAME` maps the static site to `hiddenroom.mx`.

## Frontend Modules

- `/media/`: public media and posts.
  - Files: `media/index.html`, `media/media.js`, `media/post.html`, `media/post.js`, `media/config.js`.
  - Admin/CMS: `media/admin.html`, `media/admin.js`, `media/admin.css`.
- `/store/`: product catalog, cart, checkout, orders, admin.
  - Files: `store/store.js`, `store/admin.js`, `store/*.html`.
  - Stripe checkout uses Edge Function `create-checkout-session`.
- `/tickets/`: event ticket generation, validation, viewing, printing.
  - Files: `tickets/tickets.js`, `tickets/validate.js`, `tickets/view.js`.
- `/kairen/`: Kairen AI UI.
  - Files: `kairen/kairen.js`, `kairen/index.html`.
  - Edge Function: `supabase/functions/kairen-gemini`.
- `/portal/`: auth, recovery, and authenticated dashboard.
  - Files: `portal/login.js`, `portal/recovery.js`, `portal/dashboard.js`, `portal/dashboard.html`.
- `/minijuegos/`: games with local assets.
  - Examples: `flappy_ñero`, `gol_gana`.

## Dashboard, ERP, and CRM-Like Areas

The dashboard is a vanilla SPA in `portal/dashboard.js`. It includes or references:

- Supabase session bootstrap.
- Role-composable navigation.
- Client/profile areas.
- Notifications.
- Scores and local game sync.
- ERP/event finance.
- Memberships and studio sessions.
- Tasks/scrum-style operations.
- Admin tables.
- Cloud file manager.

The repo does not contain enough explicit business context to fully define CRM policy. Ask the user before defining customer lifecycle, segmentation, lead stages, sales process, or support policy.

## Supabase

Primary folders:

- `supabase/migrations/`
- `supabase/functions/`
- `supabase/config.toml`
- `supabase/database.types.ts`
- `database.types.ts`
- `supabase/db-columns.txt`
- `supabase/db-policies.txt`
- `supabase/db-functions.txt`
- `supabase/db-rls.txt`

Known domains:

- Auth/profile sync: `users`, auth triggers, admin user functions.
- Store: `store_products`, `store_orders`, `store_order_items`, `store_downloads`, RPC fulfillment.
- Media: `media_posts`, cover storage.
- Tickets: `event_tickets`, events.
- ERP: `events`, `hr_transactions`, `event_user_permissions`, counterparties, participations, tasks, sessions, contracts, downloads, scores.
- Cloud: `cloud_jobs`, `cloud-staging`.

## Security and Permissions

- Browser uses Supabase anon/publishable key only.
- Service role belongs only in Edge Functions or Debian agent.
- RLS is the real authorization boundary.
- Admin checks use helpers such as `is_admin()` and role/permission tables.
- Event finance is scoped by `event_user_permissions`.
- Media admin can use admin role or `media.posts` permission.
- Cloud manager requires admin role and never exposes direct SSH/filesystem access.

## Infrastructure Known From Repo

- GitHub Pages-compatible static hosting is implied by static architecture and `CNAME`.
- Supabase project URL appears in source as `https://rpcunbkstadgngqrjafp.supabase.co`.
- Public site URL appears as `https://hiddenroom.mx`.
- Cloud public URL example: `https://cloud.hiddenroom.mx/files`.
- Debian/Ubuntu agent root example: `/home/prodxdack/hiddenroom`.
- Agent install example path: `/opt/mysauth/mysauth-cloud-agent.js`.

Cloudflare is mentioned by the user as part of the desired context, but this repo does not document Cloudflare zone, DNS, cache rules, tunnel, WAF, workers, or deployment process. Ask before assuming.

## Existing Skills

The project has area Skills under `.codex/skills`. Use them for implementation-specific guidance after this core Skill orients the task.
