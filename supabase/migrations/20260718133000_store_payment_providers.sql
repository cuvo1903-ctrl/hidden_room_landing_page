create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  store_order_id uuid unique references public.store_orders(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'cancelled', 'rejected', 'refunded')),
  reference text unique not null,
  provider text not null default 'manual'
    check (provider in ('manual', 'stripe', 'mercadopago', 'paypal')),
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  currency text not null default 'MXN',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  store_order_id uuid references public.store_orders(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('stripe', 'mercadopago', 'paypal')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'in_process', 'authorized', 'cancelled', 'rejected', 'refunded', 'charged_back')),
  reference text,
  payment_id text,
  provider_order_id text,
  amount numeric(10, 2) not null default 0 check (amount >= 0),
  currency text not null default 'MXN',
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (provider, payment_id),
  unique (provider, provider_order_id)
);

alter table public.store_orders
  add column if not exists provider text not null default 'stripe'
    check (provider in ('stripe', 'mercadopago', 'paypal')),
  add column if not exists provider_order_id text,
  add column if not exists provider_payment_id text,
  add column if not exists external_reference text unique;

create index if not exists orders_user_id_idx on public.orders (user_id, created_at desc);
create index if not exists orders_reference_idx on public.orders (reference);
create index if not exists payments_order_id_idx on public.payments (order_id);
create index if not exists payments_store_order_id_idx on public.payments (store_order_id);
create index if not exists payments_provider_payment_id_idx on public.payments (provider, payment_id);

create or replace function public.set_payment_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at
before update on public.orders
for each row execute function public.set_payment_updated_at();

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at
before update on public.payments
for each row execute function public.set_payment_updated_at();

alter table public.orders enable row level security;
alter table public.payments enable row level security;

drop policy if exists "orders read own" on public.orders;
create policy "orders read own"
on public.orders for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "payments read own" on public.payments;
create policy "payments read own"
on public.payments for select
to authenticated
using (user_id = auth.uid());

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
    provider = coalesce(nullif(provider, ''), 'stripe'),
    provider_order_id = coalesce(provider_order_id, p_stripe_session_id),
    provider_payment_id = coalesce(provider_payment_id, p_stripe_payment_intent),
    paid_at = now()
  where id = p_order_id;

  if target_order.external_reference is not null then
    update public.orders
    set
      status = 'paid',
      provider = coalesce(provider, 'stripe'),
      paid_at = now()
    where store_order_id = target_order.id;

    insert into public.payments (
      order_id,
      store_order_id,
      user_id,
      provider,
      status,
      reference,
      payment_id,
      provider_order_id,
      amount,
      currency,
      approved_at
    )
    select
      orders.id,
      target_order.id,
      target_order.user_id,
      'stripe',
      'paid',
      target_order.external_reference,
      p_stripe_payment_intent,
      p_stripe_session_id,
      target_order.total,
      target_order.currency,
      now()
    from public.orders
    where orders.store_order_id = target_order.id
    on conflict (provider, payment_id) do update set
      status = excluded.status,
      provider_order_id = excluded.provider_order_id,
      approved_at = coalesce(public.payments.approved_at, excluded.approved_at);
  end if;

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

create or replace function public.fulfill_store_order_provider(
  p_order_id uuid,
  p_provider text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_status text,
  p_raw_response jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.store_orders%rowtype;
  generic_order_id uuid;
  normalized_status text := lower(coalesce(p_status, 'pending'));
  paid_status boolean := normalized_status in ('approved', 'paid', 'authorized');
begin
  select *
  into target_order
  from public.store_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Store order not found';
  end if;

  select id
  into generic_order_id
  from public.orders
  where store_order_id = target_order.id;

  update public.store_orders
  set
    status = case
      when paid_status then 'paid'
      when normalized_status in ('cancelled', 'rejected', 'refunded') then normalized_status
      else status
    end,
    provider = p_provider,
    provider_order_id = coalesce(p_provider_order_id, provider_order_id),
    provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
    paid_at = case when paid_status then coalesce(paid_at, now()) else paid_at end
  where id = target_order.id;

  if generic_order_id is not null then
    update public.orders
    set
      status = case
        when paid_status then 'paid'
        when normalized_status in ('cancelled', 'rejected', 'refunded') then normalized_status
        else status
      end,
      provider = p_provider,
      paid_at = case when paid_status then coalesce(paid_at, now()) else paid_at end
    where id = generic_order_id;

    insert into public.payments (
      order_id,
      store_order_id,
      user_id,
      provider,
      status,
      reference,
      payment_id,
      provider_order_id,
      amount,
      currency,
      raw_response,
      approved_at
    )
    values (
      generic_order_id,
      target_order.id,
      target_order.user_id,
      p_provider,
      normalized_status,
      target_order.external_reference,
      p_provider_payment_id,
      p_provider_order_id,
      target_order.total,
      target_order.currency,
      coalesce(p_raw_response, '{}'::jsonb),
      case when paid_status then now() else null end
    )
    on conflict (provider, payment_id) do update set
      status = excluded.status,
      provider_order_id = coalesce(excluded.provider_order_id, public.payments.provider_order_id),
      raw_response = excluded.raw_response,
      approved_at = coalesce(public.payments.approved_at, excluded.approved_at);
  end if;

  if paid_status and target_order.status <> 'paid' then
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
  end if;

  return paid_status;
end;
$$;

revoke all on function public.fulfill_store_order_provider(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.fulfill_store_order_provider(uuid, text, text, text, text, jsonb) from anon;
revoke all on function public.fulfill_store_order_provider(uuid, text, text, text, text, jsonb) from authenticated;
grant execute on function public.fulfill_store_order_provider(uuid, text, text, text, text, jsonb) to service_role;
