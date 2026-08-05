# Dashboard Sections

## Primary Files

- `portal/dashboard.html`: static shell.
- `portal/dashboard.js`: controller and render logic.
- `portal/dashboard.css`: dashboard bridge styles.
- `site.js`: global nav account menu and notification affordances used in dashboard chrome.

## Important Constants

- `ACTIVE_SECTION_STORAGE_KEY = "hr_dashboard_active_section"`.
- `ADMIN_TABLE_STORAGE_KEY = "hr_dashboard_admin_table"`.
- `DASHBOARD_PREFS_STORAGE_KEY = "hr_dashboard_prefs"`.
- `MEMBERSHIP_CANONICAL = "MEMBRESIA"` in normalized docs; source uses accented user copy.
- Finance options include `INGRESO`, `EGRESO`, `sin apartado`, `apartado`, `saldado`.
- Cloud functions use `CLOUD_FUNCTION_BASE = SUPABASE_URL + "/functions/v1"`.

## Cloud UI Flow

Dashboard cloud UI uses authenticated Supabase session headers, uploads large files to the private `cloud-staging` bucket, and asks Edge Functions to enqueue jobs. Never send service role keys or raw filesystem paths to the browser.

## Change Pattern

For a new dashboard feature:

1. Add state shape.
2. Add loader/query helper.
3. Add renderer.
4. Add event binding by stable IDs or `data-action`.
5. Add navigation gating.
6. Add toast/error handling.
7. Run syntax check.
