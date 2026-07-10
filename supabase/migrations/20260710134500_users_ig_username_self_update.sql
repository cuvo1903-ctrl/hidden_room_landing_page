-- Hidden Room / MysAuth
-- Allow authenticated users to maintain their own Instagram username.

grant update (ig_username) on table public.users to authenticated;

drop policy if exists "users_update_own_ig_username" on public.users;
create policy "users_update_own_ig_username"
on public.users
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());
