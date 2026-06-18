-- RLS for the Hidden Room ticketing beta.
-- Frontend access always uses the authenticated user's JWT.

alter table public.event_tickets enable row level security;

create unique index if not exists event_tickets_event_key_folio_uidx
  on public.event_tickets (event_key, folio);

-- SECURITY DEFINER avoids depending on user_permissions' own RLS policies.
create or replace function public.can_validate_tickets(
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.user_permissions up
      where up.user_id = check_user_id::text
        and up.permission_key in ('tickets.validate', 'tickets.scan')
    );
$$;

revoke all on function public.can_validate_tickets(uuid) from public;
grant execute on function public.can_validate_tickets(uuid) to authenticated;

drop policy if exists "event tickets authorized select" on public.event_tickets;
create policy "event tickets authorized select"
on public.event_tickets
for select
to authenticated
using (public.can_validate_tickets());

drop policy if exists "event tickets admin insert" on public.event_tickets;
create policy "event tickets admin insert"
on public.event_tickets
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "event tickets authorized update" on public.event_tickets;
create policy "event tickets authorized update"
on public.event_tickets
for update
to authenticated
using (public.can_validate_tickets())
with check (public.can_validate_tickets());

grant select, insert, update on table public.event_tickets to authenticated;
