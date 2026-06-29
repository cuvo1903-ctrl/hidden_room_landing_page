# MysAuth Cloud

MysAuth Cloud reemplaza visualmente a File Browser en `cloud.hiddenroom.mx` y mantiene File Browser vivo como fallback interno.

## Arquitectura actual

```text
Cloudflare Tunnel -> http://localhost:8080 -> /home/prodxdack/mysauth-cloud/server.js
```

La app Node sirve la interfaz propia y una API local sobre la raiz fija de archivos:

```text
/home/prodxdack/hiddenroom
```

File Browser queda como respaldo interno:

```text
http://127.0.0.1:8081
```

## App Debian

Ruta:

```text
/home/prodxdack/mysauth-cloud
```

Archivos principales:

- `server.js`: servidor Node sin dependencias externas.
- `public/index.html`: shell de la interfaz.
- `public/cloud.js`: login Supabase y acciones de archivos.
- `public/cloud.css`: estilo responsive.
- `.env`: variables privadas, no versionar.
- `run.sh`: loop de arranque con lock.

Persistencia sin sudo:

```bash
@reboot /home/prodxdack/mysauth-cloud/run.sh >/dev/null 2>&1
```

## Seguridad

- El navegador usa Supabase publishable key.
- La API exige `Authorization: Bearer <supabase access token>`.
- El servidor verifica el usuario en Supabase y exige rol `admin` en `public.users.roles`.
- La service role solo vive en `.env` del servidor Debian.
- Todas las rutas se resuelven contra `CLOUD_HIDDENROOM_ROOT` y se bloquea escape por `..`.
- Los nombres de archivo/carpeta rechazan slash, backslash, nombres vacios, `.`/`..` y caracteres de control.

## Operaciones MVP

- Listar archivos y carpetas.
- Subir archivo.
- Descargar archivo con bearer token.
- Crear carpeta.
- Renombrar archivo/carpeta.
- Eliminar archivo/carpeta.

## Validacion rapida

```bash
curl http://127.0.0.1:8080/health
curl -I https://cloud.hiddenroom.mx/
curl http://127.0.0.1:8080/api/files?path=/
curl -I http://127.0.0.1:8081/
systemctl status mysauth-cloud-agent --no-pager
systemctl status cloudflared --no-pager
```

`/api/files` debe responder `401` sin token.

## Fallback

Para volver temporalmente a File Browser publico sin tocar Cloudflare, mover File Browser de nuevo a `8080` o cambiar el proceso que escucha en `8080`. Mantener sus volumenes:

- `/home/prodxdack/filebrowser:/config`
- volumen Docker de File Browser en `/database`
- `/home/prodxdack/hiddenroom:/srv`