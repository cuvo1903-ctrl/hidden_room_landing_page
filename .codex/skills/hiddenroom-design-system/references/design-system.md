# Design System Reference

## Primary Files

- `styles.css`: global tokens, reset, chrome, buttons, sections, cards, tables, responsive rules, minigame extensions.
- `portal/dashboard.css`: dashboard bridge and `db-*` compatibility.
- `media/admin.css`, `media/media.css`, `store/store.css`, `tickets/tickets.css`, `kairen/kairen.css`: module-specific adapters.
- `docs/design-system-status.md`: current migration status and known risks.

## Token Families

- Brand colors: `--red`, `--magenta`, `--teal`, `--green`, `--maroon`.
- Semantic aliases: `--hr-accent`, `--hr-success`, `--hr-danger`, `--hr-warning`, `--hr-info`.
- Typography: `--font-display`, `--font-mono`, `--hr-text-*`, `--hr-line-*`.
- Spacing: `--space-*`, `--hr-space-*`, `--hr-section-space`, `--hr-page-gutter`.
- Layering: `--hr-z-nav`, `--hr-z-overlay`, `--hr-z-drawer`, `--hr-z-popover`, `--hr-z-toast`.

## Cautions

- Do not remove `db-*` aliases casually; dynamic dashboard markup still uses them.
- Do not assume authenticated dashboard visuals are correct without real-role checks.
- Preserve ticket print styles after card/table changes.
- Keep minigames isolated unless the task is explicitly to migrate them.

## Quick Checks

Check `/`, `/media/`, `/media/admin.html`, `/kairen/`, `/store/`, `/tickets/`, `/portal/`, and `/portal/dashboard.html` after broad CSS changes.
