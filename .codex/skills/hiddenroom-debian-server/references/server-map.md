# Debian Server Map

Last verified by SSH diagnostic session: 2026-07-04 CST production checks.

## Access

- Hostname: `mysauth`.
- Tailscale SSH target: `prodxdack@100.106.132.42`.
- Usual shell home: `/home/prodxdack`.
- Public cloud domain: `cloud.hiddenroom.mx`.
- Key-based SSH from the Windows workstation was restored on 2026-07-04 CST.

Use read-only diagnostics first. Redact secrets from any output before reporting.

## Remote Access Resilience

Observed on 2026-07-04 CST:

- `ssh.service`: enabled and active.
- `tailscaled.service`: enabled and active.
- `cloudflared.service`: enabled and active.
- Tailscale IPv4: `100.106.132.42`.
- Tailscale IPv6: `fd7a:115c:a1e0::8b01:84b3`.

Watchdog files:

- Script: `/usr/local/sbin/tailscale-watchdog.sh`, owner `root:root`, mode `755`.
- Service: `/etc/systemd/system/tailscale-watchdog.service`.
- Timer: `/etc/systemd/system/tailscale-watchdog.timer`.
- Timer cadence: `OnBootSec=1min`, `OnUnitActiveSec=1min`, `AccuracySec=10s`, `Persistent=true`.

Watchdog behavior:

- Runs every minute as root through systemd.
- Checks `systemctl is-active tailscaled`, `tailscale status --json`, and `tailscale ip -4`.
- Treats `NoState`, `NeedsLogin`, `Stopped`, `stopped`, `failed`, `Failed`, unavailable backend state, inactive service, or no IPv4 as unhealthy.
- Restarts `tailscaled` only.
- Does not store auth keys, tokens, or credentials.
- Does not run `tailscale up` automatically.
- Logs clear OK/WARN/ACTION lines to `journalctl -u tailscale-watchdog.service`.
- If Tailscale still needs login after restart, logs that manual `sudo tailscale up` may be required.

Anti-sleep configuration:

- `sleep.target`, `suspend.target`, `hibernate.target`, and `hybrid-sleep.target` are masked.
- Logind override: `/etc/systemd/logind.conf.d/99-mysauth-no-sleep.conf`.
- Override sets lid switches to `ignore`, `IdleAction=ignore`, `IdleActionSec=0`, and `KillUserProcesses=no`.

Safe verification:

```bash
systemctl status ssh --no-pager
systemctl status tailscaled --no-pager
systemctl status cloudflared --no-pager
systemctl status tailscale-watchdog.timer --no-pager
sudo journalctl -u tailscale-watchdog.service -n 50 --no-pager
tailscale status
tailscale ip
systemctl status sleep.target suspend.target hibernate.target hybrid-sleep.target --no-pager
```

## Active Cloud Routing

The active public path is Cloudflare Tunnel, not Nginx:

```text
Cloudflare -> cloudflared tunnel hiddenroom-cloud -> http://localhost:8080 -> MysAuth Cloud Node app
```

Observed config:

- Service: `cloudflared.service`, active/running.
- Config: `/etc/cloudflared/config.yml`.
- Tunnel UUID: `406771ae-f4c6-4083-91f3-c47736cab3d2`.
- Tunnel name: `hiddenroom-cloud`.
- Ingress: `cloud.hiddenroom.mx` -> `http://localhost:8080`.
- Current listener on `8080`: `/home/prodxdack/mysauth-cloud/server.js`.

No active `nginx.service` was found during diagnostics, and no Nginx site was found controlling `cloud.hiddenroom.mx`. The public route was switched to MysAuth Cloud without editing cloudflared because the tunnel already targets `localhost:8080`. The public route was switched to MysAuth Cloud without editing cloudflared because the tunnel already targets `localhost:8080`.

## File Browser Fallback

File Browser is running in Docker:

- Container name: `filebrowser`.
- Image: `filebrowser/filebrowser`.
- Version label: `2.63.15`.
- Fallback host port: `127.0.0.1:8081`.
- Container port: `80`.
- Process shape: `containerd-shim` -> `tini` -> `filebrowser --config=/config/settings.json`.

Mounts:

- Host `/home/prodxdack/filebrowser` -> container `/config`.
- Docker volume `/var/lib/docker/volumes/3ec126e28c06e90fd98b381ae61e31b0bcb355014dc183d846e1cfe913b2565c/_data` -> container `/database`.
- Host `/home/prodxdack/hiddenroom` -> container `/srv`.

File Browser settings:

- Config file on host: `/home/prodxdack/filebrowser/settings.json`.
- Root in container: `/srv`.
- Root on host: `/home/prodxdack/hiddenroom`.
- Database in container: `/database/filebrowser.db`.

Treat File Browser as a temporary fallback. It is currently hidden from the public tunnel and remains reachable locally at `http://127.0.0.1:8081`.

## Monitoring

Netdata is installed as a native systemd service:

- Service: `netdata.service`, enabled and active.
- Local config: `/etc/netdata/netdata.conf`.
- Access: `http://100.106.132.42:19999` over Tailscale and `http://127.0.0.1:19999` locally.
- Listener policy: restricted to `100.106.132.42:19999`, `127.0.0.1:19999`, and `[::1]:19999`.
- Do not bind Netdata to `0.0.0.0` unless the user explicitly approves a protected public access design.
- Backup from hardening change: `/etc/netdata/netdata.conf.codex-backup-20260704231831`.
- Last observed warning: `net_drops.eno1 inbound_packets_dropped_ratio`, about `3.69%`; no critical Netdata alarms were observed.

Safe checks:

```bash
systemctl status netdata --no-pager
ss -tulpn | grep ':19999'
curl -sS --max-time 5 http://127.0.0.1:19999/api/v1/info
```


## MysAuth Cloud App

Observed path:

- App directory: `/home/prodxdack/mysauth-cloud/`.
- Main file: `/home/prodxdack/mysauth-cloud/server.js`.
- Static UI: `/home/prodxdack/mysauth-cloud/public/`.
- Runtime env: `/home/prodxdack/mysauth-cloud/.env`.
- Public port: `8080`.
- Persistence without sudo: user crontab `@reboot /home/prodxdack/mysauth-cloud/run.sh >/dev/null 2>&1`.

Implementation shape:

- Node.js HTTP server with no external package dependency.
- Browser login uses Supabase publishable key.
- API verifies Supabase bearer token and requires `admin` in `public.users.roles`.
- Filesystem root is fixed to `/home/prodxdack/hiddenroom`.
- MVP operations: list, upload, download, create folder, rename, delete.

## MysAuth Cloud Agent

Observed path:

- Agent directory: `/home/prodxdack/mysauth-agents/cloud-agent/`.
- Main file: `/home/prodxdack/mysauth-agents/cloud-agent/agent.js`.
- Package file: `/home/prodxdack/mysauth-agents/cloud-agent/package.json`.
- Service: `/etc/systemd/system/mysauth-cloud-agent.service`.
- Service command: `WorkingDirectory=/home/prodxdack/mysauth-agents/cloud-agent`, `ExecStart=/usr/bin/npm start`.

Implementation shape:

- Node.js worker, not Express.
- Uses `cloud_jobs` and Supabase REST/storage.
- Uses `@supabase/supabase-js`, `dotenv`, and `ws` dependencies.
- Validates filesystem paths with `path.resolve`, `path.relative`, and child-name checks.

Known live issue:

- `mysauth-cloud-agent.service` was fixed and observed active/running after loading `.env` from the agent directory and accepting `CLOUD_ROOT` as a legacy alias.

Before future restarts, keep `.env` in `/home/prodxdack/mysauth-agents/cloud-agent/` and confirm the fixed root is `/home/prodxdack/hiddenroom`.

## Recommended Target Architecture

Preferred secure Cloud flow:

```text
Portal/Dashboard MysAuth
  -> Supabase Auth + Edge Functions
  -> cloud_jobs queue
  -> mysauth-cloud-agent on Debian
  -> /home/prodxdack/hiddenroom
```

For a public custom MysAuth Cloud UI/backend, choose one entry path before implementation:

- `Cloudflare Tunnel -> MysAuth Cloud Node/Express backend/UI`, with File Browser bound internally as fallback.
- `Cloudflare Tunnel -> Nginx -> MysAuth Cloud backend/UI`, if local reverse-proxy routing is desired.

Do not assume Nginx exists or is active; install/configure it only after approval.

## Diagnostic Commands

Safe read-only checks:

```bash
whoami
hostname
pwd
systemctl status cloudflared --no-pager
systemctl status mysauth-cloud-agent --no-pager
systemctl status netdata --no-pager
systemctl status tailscale-watchdog.timer --no-pager
ss -tulpn
docker ps
docker inspect filebrowser
journalctl -u tailscale-watchdog.service -n 50 --no-pager
journalctl -u mysauth-cloud-agent -n 80 --no-pager
tailscale status
tailscale ip
cat /home/prodxdack/filebrowser/settings.json
```

When reading `.env` or Cloudflare credentials, print key names only or replace values with `[REDACTED]`.
