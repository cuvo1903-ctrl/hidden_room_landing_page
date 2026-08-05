-- Optional customer information used by the ticketing beta.
alter table public.event_tickets
  add column if not exists customer_name text,
  add column if not exists customer_email text;

