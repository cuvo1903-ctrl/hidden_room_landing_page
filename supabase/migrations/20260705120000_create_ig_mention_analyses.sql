create table if not exists public.ig_mention_analyses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  media_id text not null,
  media_permalink text,
  comments_count int,
  mentions_count int,
  unique_mentions_count int,
  ranking_total jsonb,
  ranking_unique_authors jsonb,
  created_by uuid null
);

alter table public.ig_mention_analyses enable row level security;

drop policy if exists "Admins can read instagram mention analyses" on public.ig_mention_analyses;
create policy "Admins can read instagram mention analyses"
on public.ig_mention_analyses
for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can insert instagram mention analyses" on public.ig_mention_analyses;
create policy "Admins can insert instagram mention analyses"
on public.ig_mention_analyses
for insert
to authenticated
with check (public.is_admin());

create index if not exists ig_mention_analyses_created_at_idx
  on public.ig_mention_analyses (created_at desc);

create index if not exists ig_mention_analyses_media_id_idx
  on public.ig_mention_analyses (media_id);
