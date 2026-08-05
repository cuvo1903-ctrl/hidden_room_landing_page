---
name: hiddenroom-workstation
description: "Hidden Room MysAuth local workstation setup and readiness checks for Windows/PowerShell development. Use when Codex needs to verify, install, configure, or update local tools such as Git safe.directory, Node/npm.cmd, Python, Docker Desktop, WSL 2, Supabase CLI, Playwright, Tailscale client presence, PATH issues, PowerShell execution-policy symptoms, or repo-local development prerequisites."
---

# Hidden Room Workstation

## Purpose

Use this Skill for the developer machine, not the production Debian server. Keep server SSH, live services, Cloudflare Tunnel, and production Tailscale operations in `hiddenroom-debian-server`.

## Workflow

1. Start with local facts:
   - `git status --short`
   - `node --version`
   - `npm.cmd --version`
   - `python --version`
   - `docker --version`
   - `wsl --status` and `wsl -l -v` when Docker/Supabase local fails.
   - `npx.cmd supabase --version`
   - `npx.cmd playwright --version`
   - `tailscale version` only to verify the local client.
2. Read `references/local-tooling.md` before installing or changing workstation tools.
3. Prefer repo-local dependencies over global installs when the tool belongs to this repo.
4. Use `npm.cmd` in PowerShell when `npm.ps1` is blocked by execution policy.
5. Do not weaken PowerShell execution policy unless the user explicitly approves the security tradeoff.
6. Keep Docker diagnosis split into two layers:
   - CLI visibility: `docker` must be in PATH.
   - Engine readiness: Docker Desktop must be running and `docker ps` must answer.
7. Treat Tailscale client setup as local workstation setup only. Use `hiddenroom-debian-server` before connecting to or changing the Debian host.
8. If a missing tool, new install step, PATH fix, Windows feature, or recurring setup issue is discovered, update this Skill and `references/local-tooling.md` in the same turn.

## Expected Baseline

- Windows PowerShell can run commands in the repo path.
- Git trusts the repo path as a safe directory.
- Node and `npm.cmd` work.
- Python is available for skill validation and simple local tooling.
- Supabase CLI is available from the repo through `npx.cmd supabase`.
- Playwright is available from the repo through `npx.cmd playwright`.
- Docker Desktop is installed for local Supabase, with WSL 2 available and the daemon running when needed.
- Tailscale client may be installed for private access, but production server procedures stay separate.

## Validation

After workstation changes, run the narrowest useful checks:

```powershell
node --check site.js
npm.cmd audit
npx.cmd supabase --version
npx.cmd playwright --version
python 'C:\Users\gamer\.codex\skills\.system\skill-creator\scripts\quick_validate.py' .codex\skills\hiddenroom-workstation
```

For Docker/Supabase local readiness:

```powershell
docker --version
docker ps
npx.cmd supabase status
```

Document any step that still requires an interactive Windows UI action, reboot, admin PowerShell, Docker Desktop login, Tailscale login, or production credential.

## References

Read `references/local-tooling.md` for the current workstation checklist, install decisions, and update triggers.
