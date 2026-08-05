# Supabase Map

## Current Feature Areas

- Auth/profile sync: `users`, `users_safe`, auth triggers, `email_is_registered`, admin user functions.
- Events and ERP: `events`, `hr_transactions`, `event_user_permissions`, `event_counterparties`, `event_participations`.
- Store and Stripe: `store_products`, `store_orders`, `store_order_items`, `store_downloads`, RPC `fulfill_store_order`.
- Media CMS: `media_posts`, `media-covers` storage.
- Tickets: `event_tickets`, ticket type migration, validation flows.
- Cloud: `cloud_jobs`, private `cloud-staging` bucket, cloud Edge Functions.
- Scores/memberships/downloads/contracts/sessions/tasks: dashboard operational data.

## Important Functions

- `get_my_role()`: legacy role text helper.
- `is_admin()`: boolean admin helper.
- `my_user_id()`: maps auth user to public user id.
- `handle_new_auth_user()`: auth trigger.
- `sync_public_user_email_from_auth()`: auth email sync trigger.
- `set_updated_at()`: timestamp trigger.

## Function Secrets

- Store: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`.
- Cloud/Kairen functions also depend on Supabase function env values and provider secrets as configured outside source.
- Never place `SUPABASE_SERVICE_ROLE_KEY` in browser files or GitHub Pages.

## CLI Checks

Useful commands:

```powershell
supabase db push
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy cloud-list
supabase functions logs <function-name>
```

Use linked-project commands carefully because they touch remote state.
