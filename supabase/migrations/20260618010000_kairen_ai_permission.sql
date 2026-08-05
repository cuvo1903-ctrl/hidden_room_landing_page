-- Kairen uses the exact permission key below in public.user_permissions.
-- Permissions are assigned from ERP > Permisos; no user receives it by default.
comment on table public.user_permissions is
  'Fine-grained application permissions. Kairen access requires permission_key = ''Kairen AI''.';
