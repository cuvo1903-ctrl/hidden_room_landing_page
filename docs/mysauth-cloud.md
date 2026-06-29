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

## Aislamiento por usuario

El backend valida cada request con el access token de Supabase y consulta `public.users` para roles/perfil. El admin ve la raiz completa de Cloud; cualquier otro usuario queda forzado a su carpeta personal:

```text
/home/prodxdack/hiddenroom/users/{user_id}__{username_slug}/
```

Al iniciar sesion, el servidor crea automaticamente solo estas carpetas base si faltan:

- `uploads/`
- `downloads/`
- `private/`
- `beats/` solo si tiene permiso/modulo Beat Store o descarga Beat Store disponible.

La UI recibe `/api/session` y oculta controles de escritura cuando `canUpload` es falso.

## Permisos

- `admin`: puede listar, descargar, subir, crear carpetas, renombrar y eliminar en toda la raiz cloud.
- Usuario normal: puede listar y descargar dentro de su carpeta personal.
- Usuario normal con `user_permissions.permission_key = cloud.upload`: tambien puede subir, crear carpetas, renombrar y eliminar dentro de su carpeta personal.

El frontend solo oculta botones; la autorizacion real vive en `server.js`.

## Seguridad

- El navegador usa Supabase publishable key.
- La API exige `Authorization: Bearer <supabase access token>`.
- La service role solo vive en `.env` del servidor Debian.
- Todas las rutas se resuelven contra la raiz autorizada del usuario, no contra input libre.
- Se bloquean `..`, rutas absolutas y symlinks cuyo destino real salga de la raiz permitida.
- Los nombres de archivo/carpeta rechazan slash, backslash, nombres vacios, `.`/`..` y caracteres de control.
- El slug de usuario se normaliza sin acentos ni caracteres raros.

## Operaciones MVP

- Listar archivos y carpetas.
- Subir archivo.
- Descargar archivo con bearer token.
- Crear carpeta.
- Renombrar archivo/carpeta.
- Eliminar archivo/carpeta.

## Beat Store previews

La tienda estatica `store/beat_store/` compra productos desde `public.store_products` con `category = beats` y reproduce previews desde Cloud sin hardcodear archivos.

Endpoints publicos controlados en MysAuth Cloud:

- `GET /api/beat-store`: lista archivos de audio en `/home/prodxdack/hiddenroom/beats_store`.
- `GET /api/beat-store/stream?file=...`: streamea solo archivos de audio permitidos dentro de `beats_store`.

El endpoint publico solo expone formatos de audio (`mp3`, `wav`, `m4a`, `ogg`, `flac`, `aac`) y valida root containment/symlinks contra `beats_store`.

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
