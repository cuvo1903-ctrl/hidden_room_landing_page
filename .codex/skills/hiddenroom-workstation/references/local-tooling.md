# Local Tooling Checklist

Use this file as the living checklist for the MysAuth workstation. Update it when a new local prerequisite is discovered or a setup command changes.

## Current Tool Decisions

- Node: required for the static server, scripts, Playwright, Supabase CLI package, and npm dependencies.
- npm: prefer `npm.cmd` in PowerShell to avoid `npm.ps1` execution-policy failures.
- Python: required for Skill validation scripts, quick local servers, and small maintenance utilities. Install `PyYAML` with `python -m pip install PyYAML` for `quick_validate.py`.
- Supabase CLI: install as a repo dev dependency and call with `npx.cmd supabase`.
- Playwright: install through npm and keep patched against audit advisories.
- Docker Desktop: required for `supabase start`; verify both CLI PATH and daemon readiness.
- WSL 2: required by Docker Desktop on Windows for the Linux backend.
- Git: mark this repo as `safe.directory` if ownership detection blocks status/diff.
- Tailscale: useful as a local client for private infrastructure access; server usage belongs in `hiddenroom-debian-server`.

## Known Commands

```powershell
git status --short
git config --global --add safe.directory 'D:/Archivos/MysAuth/Mysauth OS/WEB/hiddenroom_beta'

node --version
npm.cmd --version
npm.cmd install
npm.cmd audit

python --version
python -m pip show PyYAML

npx.cmd supabase --version
npx.cmd supabase start
npx.cmd supabase status

npx.cmd playwright --version

docker --version
docker context ls
docker context use desktop-linux
docker ps

wsl --status
wsl -l -v

tailscale version
```

## Docker Troubleshooting

- If `docker` is not recognized, verify `C:\Program Files\Docker\Docker\resources\bin` exists and is in user PATH.
- If `docker --version` works but `docker ps` fails, open Docker Desktop and wait for the engine to run.
- If Docker says virtualization is not detected, check Windows features and WSL 2 from an elevated PowerShell; do not assume BIOS is disabled until `systeminfo` confirms it.
- If commands hang, check Docker Desktop UI for login, license, WSL update, reboot, or backend prompts.
- If 
px.cmd supabase status reports a missing supabase_db_hiddenroom_beta container, the local stack has not been created successfully yet; rerun 
px.cmd supabase start after Docker is stable.

## Windows Feature Commands

Run these only from elevated PowerShell and only when Docker/WSL setup requires them:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All
Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform -All
bcdedit /set hypervisorlaunchtype auto
wsl --update
wsl --set-default-version 2
```

Reboot after Windows feature changes.

## Update Triggers

Update `hiddenroom-workstation` when:

- A new required local tool is discovered.
- A PATH, PowerShell, WSL, Docker, Python, Node, Supabase, Git, Playwright, or Tailscale setup issue repeats.
- The repo adds scripts that require new local dependencies.
- The supported Windows setup path changes.
- A local prerequisite moves from optional to required.
