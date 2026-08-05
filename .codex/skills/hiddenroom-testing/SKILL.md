---
name: hiddenroom-testing
description: Hidden Room testing and validation skill for JavaScript syntax checks, static route smoke tests, responsive UI review, Supabase auth/RLS flows, Store checkout, Media CMS, Tickets generation/validation/print, Portal dashboard roles, Kairen, cloud agent flows, and regression checklists. Use when verifying changes or adding QA procedures.
---

# Hidden Room Testing

## Workflow

1. Run targeted syntax checks for changed JavaScript.
2. Serve the repo with a static local server for browser checks.
3. Smoke-test affected routes and shared chrome.
4. For Supabase-backed flows, test with the relevant role: guest, authenticated client, collaborator, or admin.
5. For security-sensitive flows, verify both allowed and denied paths.
6. Document untested remote or credential-dependent steps.

## Quick Commands

```powershell
node --check site.js
node --check portal/dashboard.js
node --check media/admin.js
node --check kairen/kairen.js
node --check store/store.js
node --check tickets/tickets.js
python -m http.server 4175 --bind 127.0.0.1
```

## Route Smoke List

- `/`
- `/media/`
- `/media/admin.html`
- `/kairen/`
- `/store/`
- `/tickets/`
- `/portal/`
- `/portal/dashboard.html`

## References

Read `references/testing-matrix.md` for module-specific manual QA.
