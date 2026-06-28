# Skill Routing

Use this file after core orientation to pick the implementation Skill.

## Route By Task

- Architecture overview or cross-system reasoning: stay with `hiddenroom-mysauth-core`.
- Updating the Skills themselves: `hiddenroom-skill-maintenance`.
- HTML, static JS, navigation, module routes: `hiddenroom-frontend`.
- Visual tokens, `styles.css`, `hr-*`, responsive UI: `hiddenroom-design-system`.
- Portal dashboard, section router, admin views: `hiddenroom-dashboard`.
- Database, RLS, migrations, Edge Functions: `hiddenroom-supabase`.
- Event finance, memberships, sessions, operational tables: `hiddenroom-erp`.
- Cloud file manager, Debian agent, `cloud_jobs`: `hiddenroom-cloud-agent`.
- Auth, secrets, RLS, XSS, Stripe, path traversal: `hiddenroom-security`.
- Setup docs, runbooks, changelog: `hiddenroom-documentation`.
- Asset weight, query cost, runtime performance: `hiddenroom-performance`.
- Syntax checks, route smoke tests, role QA, manual validation: `hiddenroom-testing`.

## Multi-Skill Tasks

For broad architecture changes:

1. Start with `hiddenroom-mysauth-core`.
2. Use `hiddenroom-skill-maintenance` to update stale Skills.
3. Use the area Skill for implementation.
4. Use `hiddenroom-testing` for verification.

For security-sensitive implementation:

1. Start with the area Skill.
2. Also use `hiddenroom-security`.
3. Verify with `hiddenroom-testing`.
