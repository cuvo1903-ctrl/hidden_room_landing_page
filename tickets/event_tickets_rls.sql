-- SQL de referencia para la boletera Hidden Room.
-- Las migraciones versionadas equivalentes viven en supabase/migrations.

alter table public.event_tickets
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists ticket_type text default 'COVER';

update public.event_tickets
set ticket_type = 'COVER'
where ticket_type is null
   or ticket_type not in ('COVER', 'ESTÁNDAR', 'VIP', '2x1', '3x2', '3x1', 'ACREDITACIÓN');

alter table public.event_tickets
  alter column ticket_type set default 'COVER',
  alter column ticket_type set not null;

alter table public.event_tickets
  drop constraint if exists event_tickets_ticket_type_check;

alter table public.event_tickets
  add constraint event_tickets_ticket_type_check
  check (ticket_type in ('COVER', 'ESTÁNDAR', 'VIP', '2x1', '3x2', '3x1', 'ACREDITACIÓN'));

alter table public.event_tickets enable row level security;

create unique index if not exists event_tickets_event_key_folio_uidx
  on public.event_tickets (event_key, folio);

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

create or replace function public.can_view_tickets(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or public.has_ticket_permission('tickets.view', check_user_id)
    or public.has_ticket_permission('tickets.edit', check_user_id)
    or public.has_ticket_permission('tickets.validate', check_user_id);
$$;

create or replace function public.can_edit_tickets(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or public.has_ticket_permission('tickets.edit', check_user_id);
$$;

create or replace function public.can_validate_tickets(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
    or public.has_ticket_permission('tickets.validate', check_user_id);
$$;

revoke all on function public.has_ticket_permission(text, uuid) from public;
revoke all on function public.can_view_tickets(uuid) from public;
revoke all on function public.can_edit_tickets(uuid) from public;
revoke all on function public.can_validate_tickets(uuid) from public;
grant execute on function public.has_ticket_permission(text, uuid) to authenticated;
grant execute on function public.can_view_tickets(uuid) to authenticated;
grant execute on function public.can_edit_tickets(uuid) to authenticated;
grant execute on function public.can_validate_tickets(uuid) to authenticated;

drop policy if exists "event tickets authorized select" on public.event_tickets;
create policy "event tickets authorized select"
on public.event_tickets for select to authenticated
using (public.can_view_tickets());

drop policy if exists "event tickets admin insert" on public.event_tickets;
create policy "event tickets admin insert"
on public.event_tickets for insert to authenticated
with check (public.is_admin());

drop policy if exists "event tickets authorized update" on public.event_tickets;
create policy "event tickets authorized update"
on public.event_tickets for update to authenticated
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
  set status = 'used',
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
grant select, insert, update on table public.event_tickets to authenticated;

create or replace function public.delete_ticket_batch(
  p_event_key text,
  p_start_number integer,
  p_end_number integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_event_key text := upper(trim(coalesce(p_event_key, '')));
  deleted_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'No tienes permiso para eliminar tickets'
      using errcode = '42501';
  end if;

  if normalized_event_key = ''
    or p_start_number is null
    or p_end_number is null
    or p_start_number < 1
    or p_end_number < 1
    or p_start_number > p_end_number then
    raise exception 'Rango de tickets invalido'
      using errcode = '22023';
  end if;

  with deleted as (
    delete from public.event_tickets
    where event_key = normalized_event_key
      and folio like normalized_event_key || '-%'
      and substring(folio from length(normalized_event_key) + 2) ~ '^[0-9]+$'
      and substring(folio from length(normalized_event_key) + 2)::integer between p_start_number and p_end_number
    returning 1
  )
  select count(*) into deleted_count from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.delete_ticket_batch(text, integer, integer) from public;
grant execute on function public.delete_ticket_batch(text, integer, integer) to authenticated;

