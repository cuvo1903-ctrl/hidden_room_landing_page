-- Admin-only RPC for deleting generated ticket ranges.
-- Batches are inferred from event_key + numeric folio range because event_tickets
-- does not currently store a batch_id.

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
