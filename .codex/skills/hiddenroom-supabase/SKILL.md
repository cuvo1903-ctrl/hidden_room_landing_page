---
name: hiddenroom-supabase
description: Hidden Room Supabase backend skill for migrations, generated database types, Edge Functions, RLS policies, auth/profile sync, storage buckets, Stripe integration, cloud_jobs, and database documentation. Use when editing supabase/migrations, supabase/functions, database.types.ts, or Supabase-backed frontend queries.
---

# Hidden Room Supabase

## Workflow

1. Inspect existing migrations before adding a new timestamped migration.
2. Keep browser code using anon/publishable keys only; use service role only in Edge Functions or the Debian agent.
3. Keep RLS as the real authorization boundary.
4. Update or regenerate `supabase/database.types.ts` and root `database.types.ts` after schema changes when possible.
5. Deploy Edge Functions only after local review and syntax checks.
6. Document required secrets in docs, not in source code.

## Backend Layout

- Migrations: `supabase/migrations/*.sql`.
- Edge Functions: `supabase/functions/*/index.ts`.
- Config: `supabase/config.toml`.
- Schema/type snapshots: `supabase/db-*.txt`, `supabase/database.types.ts`, root `database.types.ts`.
- Operational docs: `docs/store-setup.md`, `docs/cloud-agent-installation.md`.

## Edge Function Conventions

- Use `Deno.serve`.
- Return JSON through a small `json()` helper with CORS headers.
- Handle `OPTIONS` explicitly.
- Validate method, auth token, body shape, quantities, paths, and IDs before database writes.
- Use Supabase service role only after authenticating/authorizing the caller.

## References

Read `references/supabase-map.md` when changing schema, RLS, storage, or functions.
