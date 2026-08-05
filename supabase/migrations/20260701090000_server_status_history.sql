create table if not exists public.server_status_history (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  hostname text,
  cpu_percent numeric,
  ram_percent numeric,
  disk_percent numeric,
  temperature_celsius numeric,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists server_status_history_created_at_idx
  on public.server_status_history (created_at desc);

alter table public.server_status_history enable row level security;

drop policy if exists "server status admin read" on public.server_status_history;
create policy "server status admin read"
on public.server_status_history for select
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and 'admin' = any(string_to_array(coalesce(u.roles, ''), ','))
  )
);
