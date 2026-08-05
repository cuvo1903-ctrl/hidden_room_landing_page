# Configuracion de la tienda Hidden Room

## 1. Aplicar la migracion

La migracion `20260618020000_store_commerce.sql` crea la tienda base y `20260718133000_store_payment_providers.sql` agrega la capa multiproveedor:

- `store_products`
- `store_orders`
- `store_order_items`
- `store_downloads`
- `orders`
- `payments`
- politicas RLS
- seed inicial
- las RPC transaccionales `fulfill_store_order` y `fulfill_store_order_provider`

Aplica las migraciones al proyecto vinculado:

```powershell
supabase db push
```

## 2. Configurar secretos

```powershell
supabase secrets set STRIPE_SECRET_KEY="sk_test_xxx"
supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_xxx"
supabase secrets set MP_ACCESS_TOKEN="APP_USR_xxx"
supabase secrets set MP_WEBHOOK_SECRET="tu_clave_secreta_webhook"
supabase secrets set SITE_URL="https://hiddenroom.mx"
```

Comprueba que existan sin imprimir sus valores:

```powershell
supabase secrets list
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` estan disponibles automaticamente en las Edge Functions del proyecto. Nunca copies la service role ni las claves secretas de Stripe o Mercado Pago al frontend.

La tienda espera una llave publica de Mercado Pago en `window.VITE_MP_PUBLIC_KEY` para montar Card Payment Brick. En produccion puede inyectarse como variable publica `VITE_MP_PUBLIC_KEY`; nunca uses `MP_ACCESS_TOKEN` ni `MP_WEBHOOK_SECRET` en archivos del frontend.

## 3. Desplegar funciones

```powershell
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy create-order
supabase functions deploy mercadopago-webhook --no-verify-jwt
```

`supabase/config.toml` tambien mantiene `verify_jwt = false` para `mercadopago-webhook`, porque Mercado Pago no envia JWT de Supabase. La funcion valida internamente `x-signature` usando `MP_WEBHOOK_SECRET` antes de consultar el pago.

## 4. Configurar webhooks

### Stripe

Crea un endpoint para:

```text
https://rpcunbkstadgngqrjafp.supabase.co/functions/v1/stripe-webhook
```

Suscribe el evento:

```text
checkout.session.completed
```

Copia el signing secret generado por Stripe a `STRIPE_WEBHOOK_SECRET`.

### Mercado Pago

Crea un endpoint para:

```text
https://rpcunbkstadgngqrjafp.supabase.co/functions/v1/mercadopago-webhook
```

Activa por lo menos las notificaciones de:

```text
Pagos
```

La funcion valida `x-signature` con el secreto del webhook, obtiene el `payment_id`/`data.id`, consulta el recurso real en Mercado Pago con `MP_ACCESS_TOKEN`, busca `external_reference`, compara monto y moneda contra `store_orders`, y actualiza `orders`, `payments` y `store_orders` mediante `fulfill_store_order_provider`.

No confies solo en el cuerpo recibido por el webhook: el cuerpo sirve para ubicar la notificacion, pero la fuente de verdad del estado es la consulta directa a Mercado Pago.

## 5. Productos digitales

`file_url` debe apuntar a un archivo protegido o a una ruta que despues pueda intercambiarse por una URL firmada. No uses archivos privados expuestos en un bucket publico. El webhook crea `store_downloads` solamente para compras ligadas a usuarios autenticados.

## 6. Paneles

- Catalogo: `/store/`
- Mis compras: `/store/orders.html`
- Administracion: `/store/admin.html`

El panel admin se oculta para usuarios normales, pero la proteccion real esta en las politicas RLS basadas en `public.is_admin()`.
## 7. Autodeteccion BPM y tonalidad con Essentia

El panel de Beat Store usa `/functions/v1/analyze-beat-audio` para que admins puedan autodetectar BPM y tonalidad desde el archivo seleccionado. La Edge Function valida la sesion Supabase, confirma rol `admin` y reenvia el audio al servicio privado de Debian.

Secretos requeridos en Supabase:

```powershell
supabase secrets set BEAT_ANALYZER_URL="https://cloud.hiddenroom.mx/api/beat-store/analyze-audio"
supabase secrets set BEAT_ANALYZER_SECRET="genera_un_secreto_largo"
supabase functions deploy analyze-beat-audio
```

En Debian, instala Essentia y levanta el servicio privado del repo:

```bash
sudo apt update
sudo apt install -y python3-pip ffmpeg
python3 -m pip install --user essentia numpy
```

Ejemplo de variables para el servicio Debian, sin guardar valores reales en Git:

```bash
export BEAT_ANALYZER_HOST="127.0.0.1"
export BEAT_ANALYZER_PORT="8092"
export BEAT_ANALYZER_SECRET="el_mismo_secreto_de_supabase"
python3 tools/beat-audio-analyzer/server.py
```

En produccion corre con systemd escuchando solo en localhost. La Edge Function llama a `https://cloud.hiddenroom.mx/api/beat-store/analyze-audio`, y MysAuth Cloud reenvia internamente a `127.0.0.1:8092` usando `BEAT_ANALYZER_SECRET`. No expongas el puerto `8092` directo a internet.
