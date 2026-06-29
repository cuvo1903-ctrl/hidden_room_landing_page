---
name: hiddenroom-cloud-agent
description: "Hidden Room Cloud Agent skill for the cloud file manager architecture: dashboard cloud UI, cloud-list/upload/folder/delete Edge Functions, cloud_jobs queue, private cloud-staging bucket, and Debian Node.js filesystem agent. Use when changing cloud uploads, path handling, job processing, service installation, or cloud security boundaries."
---

# Hidden Room Cloud Agent

## Workflow

1. Keep the browser talking only to Supabase Auth, Storage staging, and cloud Edge Functions.
2. Keep filesystem access only in `mysauth-cloud-agent.js` running on Debian with service role.
3. Validate every path with normalization and root containment checks.
4. Use `cloud_jobs` as the boundary between Edge Functions and filesystem work.
5. Keep uploads staged in private `cloud-staging`; do not put file base64 in job payloads.
6. Update `docs/cloud-agent-installation.md` when env vars, service behavior, or deployment steps change.

## Components

- Dashboard UI: cloud helpers in `portal/dashboard.js`.
- Edge Functions: `cloud-list`, `cloud-upload`, `cloud-folder`, `cloud-delete`.
- Queue: `public.cloud_jobs`.
- Agent: `mysauth-cloud-agent.js` in repo docs/templates; live Debian install currently lives under `/home/prodxdack/mysauth-agents/cloud-agent/`.
- Service template: `mysauth-cloud-agent.service`.
- Docs: `docs/cloud-agent-installation.md` and `docs/mysauth-cloud.md`.
- MysAuth Cloud app: `cloud/server.js` plus static UI under `cloud/public/` for the public custom file manager.

## Safety Rules

- Never expose SSH or direct filesystem mutation from the frontend.
- Never put `SUPABASE_SERVICE_ROLE_KEY` in GitHub Pages.
- Reject paths that escape `CLOUD_HIDDENROOM_ROOT`.
- Reject file/folder names with slashes, `..`, empty names, or control characters.
- Delete staged files after successful upload processing.

## References

Read `references/cloud-flow.md` before modifying any cloud function or the agent.
Use `hiddenroom-debian-server` before inspecting or changing the live Debian host, Cloudflare Tunnel, Docker File Browser fallback, or systemd service.

