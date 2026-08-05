-- Kairen grants access to administrators automatically. Other users require
-- an explicit row in public.user_permissions with permission_key = 'Kairen AI'.
comment on table public.user_permissions is
  'Fine-grained application permissions. Kairen access requires admin role or permission_key = ''Kairen AI''.';
