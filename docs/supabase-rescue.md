# Hidden Room — Supabase Rescue

This runbook covers the first rescue package: Auth, registration, recovery, profile sync, and the \`public.users\` RLS boundary.

## What changed

- Browser pages share one Supabase client configuration in \`portal/supabase-config.js\`.
- Registration no longer attempts an immediate password login when email confirmation is enabled.
- New Auth users are synchronized into \`public.users\` by a database trigger.
- A signup can safely claim one unlinked historical profile by WhatsApp; duplicated phones are never guessed.
- \`public.users\` exposes only the authenticated user's profile (or an administrator view).
- \`temp_password\` is excluded from the normal client read surface.
- \`get_my_role()\` and \`is_admin()\` are available as stable authorization helpers.

## Apply the database change

From the repository root, link the intended Supabase project and review the migration before applying it:

\`\`\`powershell
supabase link --project-ref rpcunbkstadgngqrjafp
supabase db push
\`\`\`

Do not put \`SUPABASE_SERVICE_ROLE_KEY\` in this repository or in browser code. Store it only as a Supabase secret for server-side functions.

## Auth dashboard checklist

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: \`https://hiddenroom.mx\`
- Redirect URL: \`https://hiddenroom.mx/portal/dashboard.html\`
- Redirect URL: \`https://hiddenroom.mx/portal/recovery.html\`

For email confirmation, keep the signup confirmation setting aligned with the desired onboarding. The browser now handles both confirmed and confirmation-required signups.

## Smoke test

1. Register with a new email, a valid password, name, and WhatsApp.
2. Confirm the email if confirmation is enabled.
3. Verify one row exists in \`public.users\` with the same Auth UUID.
4. Sign in and confirm \`/portal/dashboard.html\` loads.
5. Request recovery and finish the reset at \`/portal/recovery.html\`.
6. As an ordinary user, verify another user's profile and \`temp_password\` are not readable.
7. As an admin, verify the administrative profile views still work.

## Rollback

If the migration needs to be reverted, restore the previous policies and trigger from Git history after checking the live schema. Do not delete \`auth.users\` or \`public.users\` rows as a rollback shortcut.
