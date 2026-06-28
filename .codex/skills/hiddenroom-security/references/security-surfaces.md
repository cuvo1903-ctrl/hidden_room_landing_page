# Security Surfaces

## Browser

- Published Supabase anon key is allowed; service role is not.
- Escape generated markup with module helpers.
- Use local allow-lists for return URLs.
- Do not trust hidden admin links or disabled buttons as authorization.

## Edge Functions

- Handle CORS preflight.
- Reject unsupported methods.
- Parse JSON in try/catch.
- Authenticate bearer tokens when endpoint mutates or reads private data.
- Use service role only after caller auth/authorization.
- Return controlled error messages.

## Stripe

- `create-checkout-session` re-reads products with service role and validates stock, active status, quantities, and currency.
- `stripe-webhook` must verify `STRIPE_WEBHOOK_SECRET` before calling fulfillment RPCs.

## Cloud

- Edge Functions enqueue only.
- Agent validates root containment with `path.resolve` and `path.relative`.
- Child names cannot include slashes, `..`, empty strings, or control characters.
- Staging storage paths cannot be absolute or contain `.` / `..` segments.

## Database

- Admin helpers: `is_admin()`, `get_my_role()`.
- Client records usually map `auth.uid()` to public `users.user_id`.
- Event finance permissions are scoped by `event_user_permissions`.
