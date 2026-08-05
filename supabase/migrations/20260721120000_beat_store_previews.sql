alter table public.store_products
  add column if not exists beat_original_path text,
  add column if not exists beat_preview_path text,
  add column if not exists beat_preview_status text not null default 'pending',
  add column if not exists beat_preview_error text;

comment on column public.store_products.beat_original_path is 'Ruta privada/administrada del audio original de Beat Store conservado para compras o descargas.';
comment on column public.store_products.beat_preview_path is 'Ruta del MP3 optimizado que usa exclusivamente el reproductor de Beat Store.';
comment on column public.store_products.beat_preview_status is 'Estado de generacion del preview MP3: pending, processing, ready o error.';
comment on column public.store_products.beat_preview_error is 'Mensaje controlado para diagnosticar fallas de generacion de preview sin exponer detalles internos.';

alter table public.store_products
  add constraint store_products_beat_preview_status_check
  check (beat_preview_status in ('pending', 'processing', 'ready', 'error')) not valid;

create index if not exists store_products_beat_preview_status_idx
  on public.store_products (beat_preview_status)
  where category = 'beats';

update public.store_products
set beat_preview_status = 'pending'
where category = 'beats'
  and beat_preview_status is null;