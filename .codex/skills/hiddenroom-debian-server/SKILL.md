---
name: hiddenroom-debian-server
description: "Hidden Room Debian production server skill for MysAuth infrastructure diagnostics and safe operations over SSH. Use when Codex needs to inspect or change the Debian host, Tailscale SSH access, Cloudflare Tunnel/cloudflared, Docker File Browser fallback, service units, ports, logs, agents, cloud.hiddenroom.mx routing, or production filesystem paths."
---

# Hidden Room Debian Server

## Workflow

1. Read `references/server-map.md` before remote diagnostics or server changes.
2. Treat production as read-only unless the user explicitly approves changes.
3. Use SSH as `prodxdack@100.106.132.42` over Tailscale.
4. Request escalated tool permissions for SSH, network probes, service inspection, Docker inspection, or any command that needs remote access.
5. Redact secrets from `.env`, service files, Cloudflare credentials, Supabase keys, tokens, and database URLs.
6. Prefer diagnostic commands first: `whoami`, `hostname`, `systemctl status`, `ss -tulpn`, `docker ps`, `docker inspect`, `journalctl -u`, `tailscale status`, `tailscale ip`, and config reads.
7. Do not expose direct filesystem mutation from browser code; route Cloud file operations through the documented Cloud Agent pattern unless the user approves a different backend.

## Production Rules

- File Browser is a temporary visual fallback, not the target MysAuth Cloud UI.
- Keep File Browser alive until the user approves hiding or replacing it.
- Keep service role keys only in Edge Functions or the Debian agent.
- Validate all file paths with root containment before any filesystem operation.
- When changing public routing, account for Cloudflare Tunnel first; do not assume Nginx is in the active path.
- Keep remote access resilient: `ssh`, `tailscaled`, `cloudflared`, and `tailscale-watchdog.timer` should stay enabled and running.
- The Tailscale watchdog may restart `tailscaled`, but must not run `tailscale up` with an auth key or store Tailscale credentials.
- Netdata is for private diagnostics only and should remain bound to Tailscale/localhost, not `0.0.0.0`.

## References

Read `references/server-map.md` for the current discovered host topology, services, paths, ports, and known issues.
