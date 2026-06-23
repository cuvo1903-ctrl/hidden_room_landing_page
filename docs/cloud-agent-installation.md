# Instalación del agente Debian para Cloud Hidden Room

Este agente procesa los jobs en `cloud_jobs` y ejecuta las operaciones sobre el filesystem de Debian en `/home/prodxdack/hiddenroom`.

## Requisitos

- Debian / Ubuntu con Node.js 20+ instalado.
- Servicio Supabase con la tabla `cloud_jobs` creada.
- Variable `SUPABASE_SERVICE_ROLE_KEY` solo en el servidor Debian.
- No hay exposición SSH directa desde el frontend.

## Variables de entorno necesarias

- `SUPABASE_URL` — URL de Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` — service role key de Supabase.
- `CLOUD_HIDDENROOM_ROOT` — carpeta raíz en Debian, por ejemplo `/home/prodxdack/hiddenroom`.
- `CLOUD_HIDDENROOM_URL` — url pública base de archivos, por ejemplo `https://cloud.hiddenroom.mx/files`.
- `CLOUD_JOBS_POLL_INTERVAL_MS` — opcional, intervalo de polling en ms (por defecto `2000`).

## Pasos de instalación

1. Copia `mysauth-cloud-agent.js` al servidor Debian, por ejemplo en `/opt/mysauth/mysauth-cloud-agent.js`.
2. Da permiso de ejecución:

```bash
sudo chmod +x /opt/mysauth/mysauth-cloud-agent.js
```

3. Crea el servicio systemd:

```bash
sudo tee /etc/systemd/system/mysauth-cloud-agent.service > /dev/null <<'EOF'
[Unit]
Description=MysAuth Cloud Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mysauth
ExecStart=/usr/bin/node /opt/mysauth/mysauth-cloud-agent.js
Restart=always
RestartSec=5
Environment=SUPABASE_URL=https://your-project.supabase.co
Environment=SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
Environment=CLOUD_HIDDENROOM_ROOT=/home/prodxdack/hiddenroom
Environment=CLOUD_HIDDENROOM_URL=https://cloud.hiddenroom.mx/files
Environment=CLOUD_JOBS_POLL_INTERVAL_MS=2000

[Install]
WantedBy=multi-user.target
EOF
```

4. Recarga systemd y arranca el agente:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mysauth-cloud-agent.service
```

5. Revisa el log:

```bash
sudo journalctl -u mysauth-cloud-agent.service -f
```

## Comportamiento

- El agente consulta `cloud_jobs` con estado `pending`.
- Marca cada job como `processing` antes de ejecutarlo.
- Actualiza `status` a `done` o `error` y escribe `result` / `error`.
- Nunca expone SSH ni abre puertos desde el navegador.

## Qué evitar

- No instales `SERVICE_ROLE_KEY` en GitHub Pages.
- No toques el filesystem desde las Edge Functions.
- El frontend debe seguir usando las funciones `cloud-list`, `cloud-upload`, `cloud-folder` y `cloud-delete`.

## Staging de uploads

Aplica `supabase/migrations/20260622120000_cloud_staging.sql` para crear el bucket privado `cloud-staging` y sus politicas RLS.

Agrega al servicio:

```ini
Environment=CLOUD_STAGING_BUCKET=cloud-staging
```

El frontend sube con la sesion autenticada a `{auth.uid()}/...`. El agente descarga con `SUPABASE_SERVICE_ROLE_KEY`, guarda el archivo dentro de `CLOUD_HIDDENROOM_ROOT` y elimina el objeto temporal. Nunca pongas la service role en GitHub Pages ni guardes base64 en `cloud_jobs.payload`.