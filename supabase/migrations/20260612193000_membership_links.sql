alter table public.sessions
  add column if not exists membership_id uuid references public.memberships(id) on delete set null;

alter table public.transactions
  add column if not exists membership_id uuid references public.memberships(id) on delete set null;

create index if not exists sessions_membership_id_idx
  on public.sessions (membership_id);

create index if not exists transactions_membership_id_idx
  on public.transactions (membership_id);
