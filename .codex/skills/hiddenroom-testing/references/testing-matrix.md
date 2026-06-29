# Testing Matrix

## Frontend Syntax

Run `node --check` for every changed `.js` file. Edge Function TypeScript may need Supabase/Deno tooling; at minimum inspect syntax and imports.

## Responsive Visual QA

Check about:

- 390px mobile.
- 768px tablet.
- 1440px desktop.

Look for overflow, overlapping nav, broken drawers, clipped buttons, unreadable tables, and ticket print regressions.

## Auth Roles

- Guest: home, media public, store catalog/cart, login/register.
- Authenticated client: dashboard client views, store orders, scores/downloads scoped to self.
- Collaborator/partner: allowed ERP or scrum views only.
- Admin: media CMS, store admin, tickets admin, dashboard admin tables, cloud file manager.

## Module Flows

- Store: catalog filter/search, product detail, cart quantity, checkout function, success page, orders page.
- Media: public list, post detail, admin auth gate, create/edit draft, cover upload.
- Tickets: event list, generation, folio ranges, QR validation, print/download.
- Portal: login/register/recovery, section navigation, notifications, profile, membership and ERP tables.
- Cloud: list, upload via staging, create folder, delete file/folder, pending job handling, and remote service health when approved.
- Debian Cloud routing: if testing production, use `hiddenroom-debian-server` to verify `cloudflared`, Docker `filebrowser`, `mysauth-cloud-agent`, ports, and route probes without exposing secrets.
- MysAuth Cloud app: `node --check cloud/server.js`, `node --check cloud/public/cloud.js`, `/health` returns 200, `/api/files` returns 401 without token, File Browser fallback returns 200 on `127.0.0.1:8081`.
- Kairen: UI loads and Edge Function error states are handled.

## Remote Dependencies

Stripe, Supabase linked DB, and authenticated role checks may require real credentials and data. State clearly when those could not be exercised.

