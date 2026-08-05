alter table public.event_tickets
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
