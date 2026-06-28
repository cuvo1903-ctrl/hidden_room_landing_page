# Skill Impact Matrix

Use this matrix to choose the smallest correct set of Skills to update.

## Frontend and Routes

Changed files:

- `index.html`, `site.js`, root page assets.
- `media/*.html`, `media/*.js`.
- `store/*.html`, `store/*.js`.
- `tickets/*.html`, `tickets/*.js`.
- `kairen/*.html`, `kairen/*.js`.
- `minijuegos/**`.

Update:

- `hiddenroom-frontend`
- `hiddenroom-testing`
- `hiddenroom-performance` when loading/runtime behavior changes.
- `hiddenroom-documentation` when routes or setup steps change.

## Design System

Changed files:

- `styles.css`
- `portal/dashboard.css`
- module CSS bridges.
- design tokens, `hr-*` primitives, layout conventions.

Update:

- `hiddenroom-design-system`
- `hiddenroom-frontend` if markup conventions changed.
- `hiddenroom-testing` if visual QA routes or breakpoints changed.

## Dashboard and ERP

Changed files:

- `portal/dashboard.js`
- `portal/dashboard.html`
- `portal/dashboard.css`
- ERP migrations, finance tables, membership/session/task logic.

Update:

- `hiddenroom-dashboard`
- `hiddenroom-erp`
- `hiddenroom-supabase` for schema/RLS changes.
- `hiddenroom-security` for role/permission changes.
- `hiddenroom-testing` for role QA changes.

## Supabase and Edge Functions

Changed files:

- `supabase/migrations/**`
- `supabase/functions/**`
- `supabase/config.toml`
- generated type files.
- `supabase/db-*.txt` snapshots.

Update:

- `hiddenroom-supabase`
- `hiddenroom-security`
- `hiddenroom-testing`
- `hiddenroom-documentation` if deploy/secrets/setup steps changed.
- `hiddenroom-erp`, `hiddenroom-cloud-agent`, or module Skills when the affected domain is specific.

## Cloud Agent

Changed files:

- `mysauth-cloud-agent.js`
- `mysauth-cloud-agent.service`
- `supabase/functions/cloud-*`
- cloud migrations, staging bucket policies.
- `docs/cloud-agent-installation.md`.

Update:

- `hiddenroom-cloud-agent`
- `hiddenroom-security`
- `hiddenroom-supabase`
- `hiddenroom-documentation`
- `hiddenroom-testing`

## Store, Stripe, Media, Tickets, Kairen

Update module Skills based on the layer touched:

- Store/Stripe: `hiddenroom-frontend`, `hiddenroom-supabase`, `hiddenroom-security`, `hiddenroom-testing`, `hiddenroom-documentation`.
- Media CMS: `hiddenroom-frontend`, `hiddenroom-dashboard` only if portal integration changes, `hiddenroom-security`, `hiddenroom-testing`.
- Tickets: `hiddenroom-frontend`, `hiddenroom-supabase`, `hiddenroom-security`, `hiddenroom-testing`.
- Kairen: `hiddenroom-frontend`, `hiddenroom-supabase`, `hiddenroom-security`, `hiddenroom-testing`.

## Validation and Metadata

Always update `agents/openai.yaml` when:

- The Skill name changes.
- The scope or trigger wording materially changes.
- The default prompt no longer describes the Skill.

Always run `quick_validate.py` after edits.
