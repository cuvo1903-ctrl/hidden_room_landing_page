alter table public.store_products
  add column if not exists beat_cover_path text,
  add column if not exists beat_thumb_path text;
