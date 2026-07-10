create table if not exists public.passline_tickets (
  id uuid primary key default gen_random_uuid(),
  event_key text,
  event_date timestamptz,
  purchase_id text,
  ticket_id text unique not null,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  ticket_type text,
  purchase_status text,
  ticket_status text,
  is_courtesy boolean,
  rrpp text,
  rrpp_email text,
  rrpp_name text,
  total numeric default 0,
  service_fee numeric default 0,
  discount_code text,
  discount_amount numeric default 0,
  validation_datetime timestamptz,
  activation_code text,
  raw_row jsonb not null default '{}'::jsonb,
  imported_by uuid references auth.users(id),
  imported_at timestamptz default now(),
  source_file text
);

create unique index if not exists passline_tickets_ticket_id_uidx
  on public.passline_tickets (ticket_id);

create index if not exists passline_tickets_event_key_idx
  on public.passline_tickets (event_key);

create index if not exists passline_tickets_event_date_idx
  on public.passline_tickets (event_date);

alter table public.passline_tickets enable row level security;

create or replace function public.can_import_passline_tickets(
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    coalesce(public.is_admin(), false)
    or exists (
      select 1
      from public.user_permissions up
      where up.user_id = check_user_id::text
        and up.permission_key in ('erp.finance.input', 'erp.ops.input')
    );
$$;

revoke all on function public.can_import_passline_tickets(uuid) from public;
grant execute on function public.can_import_passline_tickets(uuid) to authenticated;

drop policy if exists "passline tickets erp read" on public.passline_tickets;
create policy "passline tickets erp read"
on public.passline_tickets
for select
to authenticated
using (public.can_import_passline_tickets());

drop policy if exists "passline tickets erp insert" on public.passline_tickets;
create policy "passline tickets erp insert"
on public.passline_tickets
for insert
to authenticated
with check (
  public.can_import_passline_tickets()
  and imported_by = auth.uid()
);

drop policy if exists "passline tickets erp update" on public.passline_tickets;
create policy "passline tickets erp update"
on public.passline_tickets
for update
to authenticated
using (public.can_import_passline_tickets())
with check (
  public.can_import_passline_tickets()
  and imported_by = auth.uid()
);

grant select, insert, update on table public.passline_tickets to authenticated;

comment on table public.passline_tickets is
  'Passline ticket imports. Upserts use ticket_id and preserve the complete source CSV row in raw_row.';
