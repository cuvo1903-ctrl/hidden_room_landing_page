# Configuración de la tienda Hidden Room

## 1. Aplicar la migración

La migración `20260618020000_store_commerce.sql` crea la tienda base y `20260718133000_store_payment_providers.sql` agrega la capa multiproveedor:

- `store_products`
- `store_orders`
- `store_order_items`
- `store_downloads`
- `orders`
- `payments`
- políticas RLS
- seed inicial
- las RPC transaccionales `fulfill_store_order` y `fulfill_store_order_provider`

Aplica las migraciones al proyecto vinculado:

```bash
supabase db push
```

## 2. Configurar secretos

```bash
supabase secrets set STRIPE_SECRET_KEY="sk_test_xxx"
supabase secrets set STRIPE_WEBHOOK_SECRET="whsec_xxx"
supabase secrets set SITE_URL="https://hiddenroom.mx"
supabase secrets set MP_ACCESS_TOKEN="APP_USR_xxx"
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` están disponibles automáticamente
en las Edge Functions del proyecto. Nunca copies la service role ni las claves
secretas de Stripe ni Mercado Pago al frontend.

La tienda espera una llave publica de Mercado Pago en `window.VITE_MP_PUBLIC_KEY` para montar Card Payment Brick. En produccion puede inyectarse como variable publica `VITE_MP_PUBLIC_KEY`; nunca uses `MP_ACCESS_TOKEN` en archivos del frontend.

## 3. Desplegar funciones

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy create-order
supabase functions deploy mercadopago-webhook
```

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

La funcion valida la notificacion consultando el recurso real en Mercado Pago con `MP_ACCESS_TOKEN`, busca `external_reference` y actualiza `orders`, `payments` y `store_orders`.

## 5. Productos digitales

`file_url` debe apuntar a un archivo protegido o a una ruta que después pueda
intercambiarse por una URL firmada. No uses archivos privados expuestos en un
bucket público. El webhook crea `store_downloads` solamente para compras
ligadas a usuarios autenticados.

## 6. Paneles

- Catálogo: `/store/`
- Mis compras: `/store/orders.html`
- Administración: `/store/admin.html`

El panel admin se oculta para usuarios normales, pero la protección real está
en las políticas RLS basadas en `public.is_admin()`.


