# Hidden Room Beta

## Tienda con Supabase y Stripe

La tienda ubicada en `/store/` llama únicamente a la Edge Function
`create-checkout-session`. La clave secreta de Stripe nunca debe incluirse en
HTML ni JavaScript del navegador.

Configura los secretos del proyecto:

```bash
supabase secrets set STRIPE_SECRET_KEY="sk_test_xxx"
supabase secrets set SITE_URL="https://hiddenroom.mx"
```

Despliega la función:

```bash
supabase functions deploy create-checkout-session
```

Los productos y precios se leen de `public.store_products`; la Edge Function
vuelve a consultarlos con service role antes de crear la sesión de Stripe.

La configuración completa, webhook, migración y paneles está documentada en
[`docs/store-setup.md`](docs/store-setup.md).
