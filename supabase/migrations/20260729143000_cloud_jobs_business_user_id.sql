-- Keep cloud job audit aligned with Hidden Room operational user IDs.
-- created_by remains auth.users.id; business_user_id stores public.users.user_id.

alter table public.cloud_jobs
  add column if not exists business_user_id text;

create index if not exists cloud_jobs_business_user_id_idx
  on public.cloud_jobs (business_user_id);

update public.cloud_jobs cj
set business_user_id = u.user_id
from public.users u
where cj.business_user_id is null
  and cj.created_by = u.id;