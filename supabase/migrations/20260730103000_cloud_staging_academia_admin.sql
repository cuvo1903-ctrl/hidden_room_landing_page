drop policy if exists "cloud staging admins insert own" on storage.objects;
create policy "cloud staging admins insert own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'cloud-staging'
  and (public.is_admin() or public.has_academia_admin_permission())
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "cloud staging admins delete own" on storage.objects;
create policy "cloud staging admins delete own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'cloud-staging'
  and (public.is_admin() or public.has_academia_admin_permission())
  and (storage.foldername(name))[1] = auth.uid()::text
);