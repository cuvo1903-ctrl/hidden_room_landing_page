---
name: hiddenroom-documentation
description: Hidden Room documentation skill for repo docs, setup guides, deployment notes, operational runbooks, changelog pages, Supabase/Stripe/cloud instructions, design-system status, and module maintenance notes. Use when writing or updating docs/*.md, README.md, changelog.html, CNAME-related notes, or release/ops documentation.
---

# Hidden Room Documentation

## Workflow

1. Document the actual repo behavior, not aspirational architecture.
2. Link concrete files, routes, secrets, and commands.
3. Separate public-safe docs from private secrets.
4. Keep steps executable in PowerShell where the repo is maintained on Windows.
5. Update docs next to the feature area: store, cloud agent, design system, Supabase, or changelog.
6. When documenting risks, include validation steps and known limitations.

## Existing Docs

- `README.md`: store/Supabase/Stripe summary.
- `docs/store-setup.md`: store migration, secrets, functions, webhook, panels.
- `docs/cloud-agent-installation.md`: Debian agent install and env vars.
- `docs/design-system-status.md`: migration status, risks, quick checks.
- `docs/index.html`: docs landing page.
- `changelog.html`: public changelog route.

## Style

- Prefer concise Spanish when writing user-facing project docs.
- Use exact commands and paths.
- Do not include secret values.
- Include affected routes for manual QA.

## References

Read `references/doc-index.md` before adding a new doc or updating operational instructions.
