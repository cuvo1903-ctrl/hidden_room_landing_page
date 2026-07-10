-- Hidden Room / emergency Mention Rank courtesy import support.

alter table public.event_tickets
  add column if not exists user_id text;

create index if not exists event_tickets_user_id_idx
  on public.event_tickets (user_id);

alter table public.event_tickets
  drop constraint if exists event_tickets_ticket_type_check;

alter table public.event_tickets
  add constraint event_tickets_ticket_type_check
  check (ticket_type in ('COVER', 'ESTÁNDAR', 'VIP', '2x1', '3x2', '3x1', 'ACREDITACIÓN', 'CORTESÍA'));

drop policy if exists "event tickets own select" on public.event_tickets;
create policy "event tickets own select"
on public.event_tickets
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and nullif(btrim(u.user_id), '') is not null
      and u.user_id = public.event_tickets.user_id
  )
);

comment on column public.event_tickets.user_id is
  'Operational public.users.user_id used to show owned tickets in the client dashboard.';