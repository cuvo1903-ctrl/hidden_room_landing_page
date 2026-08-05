alter table public.store_products
  add column if not exists beat_genre text,
  add column if not exists beat_bpm integer,
  add column if not exists beat_key text,
  add column if not exists beat_duration_seconds integer;

comment on column public.store_products.beat_genre is 'Genero musical publico para productos de Beat Store.';
comment on column public.store_products.beat_bpm is 'BPM del beat para catalogo y busqueda.';
comment on column public.store_products.beat_key is 'Tonalidad del beat, por ejemplo Cm o F# minor.';
comment on column public.store_products.beat_duration_seconds is 'Duracion del preview o beat en segundos.';

alter table public.store_products
  add constraint store_products_beat_bpm_range
  check (beat_bpm is null or (beat_bpm >= 1 and beat_bpm <= 300)) not valid,
  add constraint store_products_beat_duration_positive
  check (beat_duration_seconds is null or beat_duration_seconds > 0) not valid;