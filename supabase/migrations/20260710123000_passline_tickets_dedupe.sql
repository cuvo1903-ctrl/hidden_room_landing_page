delete from public.passline_tickets
where nullif(btrim(ticket_id), '') is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by btrim(ticket_id)
      order by imported_at desc nulls last, id desc
    ) as rn
  from public.passline_tickets
)
delete from public.passline_tickets pt
using ranked r
where pt.id = r.id
  and r.rn > 1;

update public.passline_tickets
set ticket_id = btrim(ticket_id)
where ticket_id <> btrim(ticket_id);

create unique index if not exists passline_tickets_ticket_id_trimmed_uidx
  on public.passline_tickets (btrim(ticket_id));
