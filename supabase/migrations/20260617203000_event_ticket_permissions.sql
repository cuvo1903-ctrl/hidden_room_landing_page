-- Fine-grained ticket permissions:
-- tickets.view, tickets.edit, tickets.validate.

create or replace function public.has_ticket_permission(
  permission_name text,
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
        and up.permission_key = permission_name
    );
$$;

revoke all on function public.has_ticket_permission(text, uuid) from public;
grant execute on function public.has_ticket_permission(text, uuid) to authenticated;

create or replace function public.can_view_tickets(
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
    or public.has_ticket_permission('tickets.view', check_user_id)
    or public.has_ticket_permission('tickets.edit', check_user_id)
    or public.has_ticket_permission('tickets.validate', check_user_id);
$$;

create or replace function public.can_edit_tickets(
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
    or public.has_ticket_permission('tickets.edit', check_user_id);
$$;

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
    or public.has_ticket_permission('tickets.validate', check_user_id);
$$;

revoke all on function public.can_view_tickets(uuid) from public;
revoke all on function public.can_edit_tickets(uuid) from public;
revoke all on function public.can_validate_tickets(uuid) from public;
grant execute on function public.can_view_tickets(uuid) to authenticated;
grant execute on function public.can_edit_tickets(uuid) to authenticated;
grant execute on function public.can_validate_tickets(uuid) to authenticated;

drop policy if exists "event tickets authorized select" on public.event_tickets;
create policy "event tickets authorized select"
on public.event_tickets
for select
to authenticated
using (public.can_view_tickets());

drop policy if exists "event tickets authorized update" on public.event_tickets;
create policy "event tickets authorized update"
on public.event_tickets
for update
to authenticated
using (public.can_edit_tickets())
with check (public.can_edit_tickets());

create or replace function public.mark_ticket_used(ticket_folio text)
returns setof public.event_tickets
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_validate_tickets(auth.uid()) then
    raise exception 'No tienes permiso para validar tickets'
      using errcode = '42501';
  end if;

  return query
  update public.event_tickets
  set
    status = 'used',
    used_at = now(),
    used_by = coalesce(auth.jwt() ->> 'email', auth.uid()::text),
    updated_at = now()
  where folio = upper(trim(ticket_folio))
    and status = 'valid'
  returning *;
end;
$$;

revoke all on function public.mark_ticket_used(text) from public;
grant execute on function public.mark_ticket_used(text) to authenticated;
