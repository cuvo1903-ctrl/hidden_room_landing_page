-- Supabase migration: cloud jobs queue for Debian cloud agent

create table if not exists public.cloud_jobs (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('list', 'upload', 'delete', 'folder')),
  path text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  result jsonb,
  error text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists cloud_jobs_status_idx on public.cloud_jobs (status);
create index if not exists cloud_jobs_created_by_idx on public.cloud_jobs (created_by);
create index if not exists cloud_jobs_action_idx on public.cloud_jobs (action);
