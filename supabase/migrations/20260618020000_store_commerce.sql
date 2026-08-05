create extension if not exists pgcrypto;

create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  category text not null check (category in ('merch', 'beats', 'digital', 'eventos')),
  price numeric(10, 2) not null check (price >= 0),
  currency text not null default 'MXN',
  image_url text,
  file_url text,
  stock integer check (stock is null or stock >= 0),
  is_digital boolean not null default false,
  is_active boolean not null default true,
  featured boolean not null default false,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  customer_name text,
  customer_email text,
  customer_phone text,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  subtotal numeric(10, 2) not null default 0 check (subtotal >= 0),
  total numeric(10, 2) not null default 0 check (total >= 0),
  currency text not null default 'MXN',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.store_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders(id) on delete cascade,
  product_id uuid references public.store_products(id) on delete set null,
  product_name text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  total numeric(10, 2) not null check (total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.store_downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.store_orders(id) on delete cascade,
  product_id uuid references public.store_products(id) on delete set null,
  file_url text,
  available boolean not null default true,
  download_count integer not null default 0 check (download_count >= 0),
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);

create index if not exists store_products_active_idx
  on public.store_products (is_active, featured, created_at desc);
create index if not exists store_orders_user_id_idx
  on public.store_orders (user_id, created_at desc);
create index if not exists store_order_items_order_id_idx
  on public.store_order_items (order_id);
create index if not exists store_downloads_user_id_idx
  on public.store_downloads (user_id, created_at desc);

create or replace function public.set_store_product_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_products_updated_at on public.store_products;
create trigger store_products_updated_at
before update on public.store_products
for each row execute function public.set_store_product_updated_at();

alter table public.store_products enable row level security;
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;
alter table public.store_downloads enable row level security;

drop policy if exists "store products public read active" on public.store_products;
create policy "store products public read active"
on public.store_products for select
to anon, authenticated
using (is_active = true or public.is_admin());

drop policy if exists "store products admin insert" on public.store_products;
create policy "store products admin insert"
on public.store_products for insert
to authenticated
with check (public.is_admin());

drop policy if exists "store products admin update" on public.store_products;
create policy "store products admin update"
on public.store_products for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "store products admin delete" on public.store_products;
create policy "store products admin delete"
on public.store_products for delete
to authenticated
using (public.is_admin());

drop policy if exists "store orders read own" on public.store_orders;
create policy "store orders read own"
on public.store_orders for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "store order items read own" on public.store_order_items;
create policy "store order items read own"
on public.store_order_items for select
to authenticated
using (
  exists (
    select 1
    from public.store_orders orders
    where orders.id = store_order_items.order_id
      and orders.user_id = auth.uid()
  )
);

drop policy if exists "store downloads read own" on public.store_downloads;
create policy "store downloads read own"
on public.store_downloads for select
to authenticated
using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies are created for orders, items or downloads.
-- Browser clients therefore cannot create orders or mark them as paid.

create or replace function public.fulfill_store_order(
  p_order_id uuid,
  p_stripe_session_id text,
  p_stripe_payment_intent text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.store_orders%rowtype;
begin
  select *
  into target_order
  from public.store_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Store order not found';
  end if;

  if target_order.status = 'paid' then
    return false;
  end if;

  update public.store_orders
  set
    status = 'paid',
    stripe_session_id = p_stripe_session_id,
    stripe_payment_intent = p_stripe_payment_intent,
    paid_at = now()
  where id = p_order_id;

  if target_order.user_id is not null then
    insert into public.store_downloads (
      user_id,
      order_id,
      product_id,
      file_url
    )
    select
      target_order.user_id,
      target_order.id,
      products.id,
      products.file_url
    from public.store_order_items items
    join public.store_products products on products.id = items.product_id
    where items.order_id = target_order.id
      and products.is_digital = true
      and products.file_url is not null
    on conflict (order_id, product_id) do nothing;
  end if;

  update public.store_products products
  set stock = greatest(0, products.stock - purchased.quantity)
  from (
    select product_id, sum(quantity)::integer as quantity
    from public.store_order_items
    where order_id = target_order.id
    group by product_id
  ) purchased
  where products.id = purchased.product_id
    and products.is_digital = false
    and products.stock is not null;

  return true;
end;
$$;

revoke all on function public.fulfill_store_order(uuid, text, text) from public;
revoke all on function public.fulfill_store_order(uuid, text, text) from anon;
revoke all on function public.fulfill_store_order(uuid, text, text) from authenticated;
grant execute on function public.fulfill_store_order(uuid, text, text) to service_role;

insert into public.store_products (
  slug,
  name,
  description,
  category,
  price,
  image_url,
  file_url,
  stock,
  is_digital,
  featured,
  is_active
)
values
  ('playera-hidden-room', 'Playera Hidden Room', 'Playera oficial de la casa del under.', 'merch', 549.00, null, null, 40, false, true, true),
  ('gorra-hidden-room', 'Gorra Hidden Room', 'Gorra ajustable con bordado Hidden Room.', 'merch', 449.00, null, null, 30, false, true, true),
  ('beat-reggaeton', 'Beat Reggaeton', 'Licencia digital no exclusiva para beat de reggaetón.', 'beats', 1200.00, null, null, null, true, true, true),
  ('beat-trap', 'Beat Trap', 'Licencia digital no exclusiva para beat de trap.', 'beats', 1200.00, null, null, null, true, false, true),
  ('sample-pack-vol-1', 'Sample Pack Vol.1', 'Colección de samples originales Hidden Room.', 'digital', 399.00, null, null, null, true, true, true),
  ('preset-pack-vol-1', 'Preset Pack Vol.1', 'Presets listos para producción vocal y musical.', 'digital', 299.00, null, null, null, true, false, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  price = excluded.price,
  image_url = excluded.image_url,
  file_url = excluded.file_url,
  stock = excluded.stock,
  is_digital = excluded.is_digital,
  featured = excluded.featured,
  is_active = excluded.is_active;
