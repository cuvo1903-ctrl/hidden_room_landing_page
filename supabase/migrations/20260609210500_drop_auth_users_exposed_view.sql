-- Hidden Room / MysAuth
-- Remove diagnostic view that joins public.users with auth.users.
-- It exposed personal user fields through the API and triggered Supabase auth_users_exposed.

drop view if exists public.users_without_auth;
