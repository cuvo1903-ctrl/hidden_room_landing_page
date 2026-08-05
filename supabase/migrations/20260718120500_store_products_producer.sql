alter table public.store_products
  add column if not exists producer text;

comment on column public.store_products.producer is 'Nombre publico del productor para Beats Store.';
