---
name: hiddenroom-mysauth-core
description: Core context Skill for understanding the full Hidden Room and MysAuth project before planning or changing anything. Use when Codex needs project-wide context about philosophy, business goals, operating strategy, architecture, modules, roadmap, stack, conventions, permissions, Supabase, Debian server, Cloudflare, GitHub Pages, AI agents, Kairen, ERP, CRM, Cloud, Media, Store, or Tickets. This Skill does not implement code; it orients Codex and requires asking the user before assuming business operations not documented in the repo.
---

# Hidden Room MysAuth Core

## Purpose

Use this Skill to understand the whole project before using a specialized Skill or editing files. Do not use it to implement code directly. After orientation, route implementation work to the relevant area Skill.

## Ground Rules

1. Treat repository files and explicit user statements as the only source of truth.
2. Do not invent business operations, roadmap, philosophy, CRM rules, Cloudflare configuration, production server details, or agent responsibilities that are not documented.
3. Ask the user when operational context is missing or ambiguous.
4. Keep secrets out of source and responses.
5. Use specialized Skills for implementation:
   - `hiddenroom-frontend`
   - `hiddenroom-design-system`
   - `hiddenroom-dashboard`
   - `hiddenroom-supabase`
   - `hiddenroom-erp`
   - `hiddenroom-cloud-agent`
   - `hiddenroom-debian-server`
   - `hiddenroom-security`
   - `hiddenroom-documentation`
   - `hiddenroom-performance`
   - `hiddenroom-testing`
   - `hiddenroom-workstation`
   - `hiddenroom-skill-maintenance`

## Known Project Identity

- Project repo: Hidden Room Beta.
- Public domain in repo: `hiddenroom.mx`.
- Brand statement visible in the site: "La Casa del Under".
- Brand affiliation visible in the home page: "Una Marca de Grupo Mysauth".
- Current product shape: a static website plus authenticated portal, Supabase backend, Edge Functions, Stripe store, media CMS, tickets, games, Kairen AI, ERP/dashboard, and cloud file manager.
- Hidden Room is the cultural and commercial brand; MysAuth is the technological and business holding company that builds the infrastructure to operate, automate, scale, and later commercialize the ecosystem.
- The strategic pattern is: build for Hidden Room first, validate in real operation, then offer the same technology to other brands, companies, communities, and creators.

## Known Architecture

- Hosting shape: static site compatible with GitHub Pages.
- Frontend stack: HTML, CSS, vanilla JavaScript, ES modules from CDN.
- Global files: `index.html`, `site.js`, `styles.css`.
- Backend: Supabase Auth, Postgres, RLS, Storage, Edge Functions.
- Payments: Stripe through Supabase Edge Functions.
- Cloud files: browser -> Supabase Storage staging / Edge Functions -> `cloud_jobs` -> Debian Node.js agent -> filesystem.
- Debian production topology: Cloudflare Tunnel currently routes `cloud.hiddenroom.mx` to Docker File Browser on the Debian host; use `hiddenroom-debian-server` for live paths, services, and tunnel details.
- Debian agent file in repo docs/templates: `mysauth-cloud-agent.js`; live install path discovered as `/home/prodxdack/mysauth-agents/cloud-agent/agent.js`.
- Service template: `mysauth-cloud-agent.service`.

## References

Read these based on the question:

- `references/philosophy-strategy.md`: philosophy, mission, business direction, current priorities, roadmap, Kairen direction, and documented production-infrastructure roles.
- `references/ecosystem-map.md`: complete repo module map and known infrastructure.
- `references/operational-context.md`: remaining business/ops items that must be asked instead of inferred.
- `references/skill-routing.md`: which specialized Skill to invoke after core orientation.


