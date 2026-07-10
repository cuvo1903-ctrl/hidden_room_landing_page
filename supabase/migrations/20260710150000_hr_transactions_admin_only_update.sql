-- Hidden Room / MysAuth
-- Keep event finance input delegated, but restrict edits to admins only.

drop policy if exists "event finance update assigned" on public.hr_transactions;

create policy "event finance update assigned"
on public.hr_transactions
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
