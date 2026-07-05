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
- On the live Debian host, File Browser is a local fallback bound to `127.0.0.1:8081`; keep it hidden from the public Cloudflare Tunnel unless the user explicitly approves exposing it.
- The active public route is Cloudflare Tunnel `cloud.hiddenroom.mx` to the MysAuth Cloud app on `localhost:8080`.
- Netdata must stay private on Tailscale/localhost (`100.106.132.42:19999`, `127.0.0.1:19999`, `[::1]:19999`), not `0.0.0.0`.
- Tailscale recovery automation may restart `tailscaled`, but must not store auth keys or run `tailscale up` automatically.
- When changing production cloud routing or services, use `hiddenroom-debian-server` and keep service-role secrets out of browser code and command output.

## Database

- Admin helpers: `is_admin()`, `get_my_role()`.
- Client records usually map `auth.uid()` to public `users.user_id`.
- Event finance permissions are scoped by `event_user_permissions`.
