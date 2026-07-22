alter table public.store_products
  add column if not exists beat_bpm_autodetected boolean not null default false,
  add column if not exists beat_key_autodetected boolean not null default false;

comment on column public.store_products.beat_bpm_autodetected is 'Indica si beat_bpm fue generado por autodeteccion.';
comment on column public.store_products.beat_key_autodetected is 'Indica si beat_key fue generado por autodeteccion.';

update public.store_products
set beat_bpm_autodetected = false
where beat_bpm is null and beat_bpm_autodetected is true;

update public.store_products
set beat_key_autodetected = false
where beat_key is null and beat_key_autodetected is true;