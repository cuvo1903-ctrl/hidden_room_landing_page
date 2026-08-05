create extension if not exists pgcrypto;

create table if not exists public.media_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  content text not null default '',
  cover_image text,
  category text not null,
  tags text[] not null default '{}',
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  featured boolean not null default false,
  views integer not null default 0 check (views >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create unique index if not exists media_posts_slug_idx
  on public.media_posts (slug);
create index if not exists media_posts_category_idx
  on public.media_posts (category);
create index if not exists media_posts_status_idx
  on public.media_posts (status);
create index if not exists media_posts_published_at_idx
  on public.media_posts (published_at desc);
create index if not exists media_posts_public_feed_idx
  on public.media_posts (featured desc, published_at desc)
  where status = 'published';

create or replace function public.has_media_posts_permission(
  check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    check_user_id is not null
    and (
      public.is_admin()
      or exists (
        select 1
        from public.user_permissions up
        where up.user_id::text = check_user_id::text
          and up.permission_key = 'media.posts'
      )
    );
$$;

revoke all on function public.has_media_posts_permission(uuid) from public;
grant execute on function public.has_media_posts_permission(uuid) to anon, authenticated;

create or replace function public.set_media_post_timestamps()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();

  if new.status = 'published' and (
    tg_op = 'INSERT'
    or old.status is distinct from 'published'
    or new.published_at is null
  ) then
    new.published_at = coalesce(new.published_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists media_posts_timestamps on public.media_posts;
create trigger media_posts_timestamps
before insert or update on public.media_posts
for each row execute function public.set_media_post_timestamps();

alter table public.media_posts enable row level security;

drop policy if exists "media posts public published read" on public.media_posts;
create policy "media posts public published read"
on public.media_posts for select
to anon, authenticated
using (
  (
    status = 'published'
    and published_at is not null
    and published_at <= now()
  )
  or public.has_media_posts_permission()
);

drop policy if exists "media posts editors insert" on public.media_posts;
create policy "media posts editors insert"
on public.media_posts for insert
to authenticated
with check (
  public.has_media_posts_permission()
  and (author_id is null or author_id = auth.uid())
);

drop policy if exists "media posts editors update" on public.media_posts;
create policy "media posts editors update"
on public.media_posts for update
to authenticated
using (public.has_media_posts_permission())
with check (public.has_media_posts_permission());

drop policy if exists "media posts editors delete" on public.media_posts;
create policy "media posts editors delete"
on public.media_posts for delete
to authenticated
using (public.has_media_posts_permission());

create or replace function public.increment_media_post_views(post_slug text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_views integer;
begin
  update public.media_posts
  set views = views + 1
  where slug = post_slug
    and status = 'published'
    and published_at is not null
    and published_at <= now()
  returning views into updated_views;

  return coalesce(updated_views, 0);
end;
$$;

revoke all on function public.increment_media_post_views(text) from public;
grant execute on function public.increment_media_post_views(text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-covers',
  'media-covers',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media covers public read" on storage.objects;
create policy "media covers public read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'media-covers');

drop policy if exists "media covers editors insert" on storage.objects;
create policy "media covers editors insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'media-covers'
  and public.has_media_posts_permission()
);

drop policy if exists "media covers editors update" on storage.objects;
create policy "media covers editors update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'media-covers'
  and public.has_media_posts_permission()
)
with check (
  bucket_id = 'media-covers'
  and public.has_media_posts_permission()
);

drop policy if exists "media covers editors delete" on storage.objects;
create policy "media covers editors delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'media-covers'
  and public.has_media_posts_permission()
);

comment on table public.media_posts is
  'Hidden Room Media articles. Mutation requires admin or user_permissions.permission_key = media.posts.';
