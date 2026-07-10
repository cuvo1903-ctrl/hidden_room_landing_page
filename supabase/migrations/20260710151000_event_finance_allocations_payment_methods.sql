-- Hidden Room / MysAuth
-- Event finance allocations and shared payment methods.

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  status text not null default 'active',
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.payment_methods (key, name, sort_order)
values
  ('NU', 'NU', 10),
  ('NU_CRED', 'NU CRED', 20),
  ('EFECTIVO', 'EFECTIVO', 30)
on conflict (key) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  status = 'active';

create table if not exists public.hr_transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.hr_transactions(id) on delete cascade,
  entity_id uuid not null references public.finance_entities(id),
  amount numeric,
  percentage numeric,
  created_at timestamptz not null default now(),
  constraint hr_transaction_allocations_amount_nonnegative check (amount is null or amount >= 0),
  constraint hr_transaction_allocations_percentage_range check (percentage is null or (percentage >= 0 and percentage <= 100)),
  constraint hr_transaction_allocations_has_value check (amount is not null or percentage is not null)
);

create index if not exists hr_transaction_allocations_transaction_id_idx
  on public.hr_transaction_allocations (transaction_id);

create index if not exists hr_transaction_allocations_entity_id_idx
  on public.hr_transaction_allocations (entity_id);

grant select on public.payment_methods to authenticated;
grant select, insert, update, delete on public.hr_transaction_allocations to authenticated;

alter table public.payment_methods enable row level security;
alter table public.hr_transaction_allocations enable row level security;

drop policy if exists "payment methods admin all" on public.payment_methods;
create policy "payment methods admin all"
on public.payment_methods
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "payment methods active select" on public.payment_methods;
create policy "payment methods active select"
on public.payment_methods
for select
to authenticated
using (status = 'active' or public.is_admin());

drop policy if exists "transaction allocations admin all" on public.hr_transaction_allocations;
create policy "transaction allocations admin all"
on public.hr_transaction_allocations
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "transaction allocations event select" on public.hr_transaction_allocations;
create policy "transaction allocations event select"
on public.hr_transaction_allocations
for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.hr_transactions ht
    join public.event_user_permissions eup on (
      eup.event_id = ht.event_id
      or exists (
        select 1
        from public.events e
        where e.id = eup.event_id
          and e.event_key = ht.event_key
      )
    )
    join public.users u on u.user_id = eup.user_id
    where ht.id = hr_transaction_allocations.transaction_id
      and u.id = auth.uid()
      and eup.can_view = true
  )
);

create or replace function public.save_hr_transaction_with_allocations(
  p_transaction jsonb,
  p_allocations jsonb default '[]'::jsonb,
  p_transaction_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_is_admin boolean := coalesce(public.is_admin(), false);
  v_event_id uuid := nullif(p_transaction->>'event_id', '')::uuid;
  v_event_key text := nullif(trim(p_transaction->>'event_key'), '');
  v_amount numeric := coalesce(nullif(p_transaction->>'amount', '')::numeric, 0);
  v_abs_amount numeric := abs(coalesce(nullif(p_transaction->>'amount', '')::numeric, 0));
  v_hidden_room_share numeric := coalesce(nullif(p_transaction->>'hidden_room_share', '')::numeric, 0);
  v_alloc_count integer := 0;
  v_has_amount boolean := false;
  v_has_percentage boolean := false;
  v_amount_sum numeric := 0;
  v_percentage_sum numeric := 0;
  v_owner_entity_id uuid := nullif(p_transaction->>'owner_entity_id', '')::uuid;
  v_saved_id uuid;
  allocation jsonb;
  v_entity_id uuid;
  v_allocation_amount numeric;
  v_allocation_percentage numeric;
begin
  if v_auth_uid is null then
    raise exception 'Sesión requerida.';
  end if;

  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'Allocations inválidas.';
  end if;

  if p_transaction_id is null then
    if not (
      v_is_admin
      or exists (
        select 1
        from public.event_user_permissions eup
        join public.users u on u.user_id = eup.user_id
        where u.id = v_auth_uid
          and eup.can_add_finance = true
          and (
            eup.event_id = v_event_id
            or exists (
              select 1
              from public.events e
              where e.id = eup.event_id
                and e.event_key = v_event_key
            )
          )
      )
    ) then
      raise exception 'No tienes permiso para capturar finanzas de este evento.';
    end if;
  elsif not v_is_admin then
    raise exception 'Solo admin puede editar movimientos financieros.';
  end if;

  select count(*)
  into v_alloc_count
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb));

  if v_alloc_count > 0 and v_abs_amount <= 0 then
    raise exception 'No se pueden asignar allocations a un monto cero.';
  end if;

  for allocation in select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    v_entity_id := nullif(allocation->>'entity_id', '')::uuid;
    v_allocation_amount := nullif(allocation->>'amount', '')::numeric;
    v_allocation_percentage := nullif(allocation->>'percentage', '')::numeric;

    if v_entity_id is null then
      raise exception 'Cada allocation necesita una entidad.';
    end if;
    if not exists (select 1 from public.finance_entities fe where fe.id = v_entity_id and (fe.status = 'active' or v_is_admin)) then
      raise exception 'Una entidad seleccionada no está activa o no existe.';
    end if;
    if v_allocation_amount is not null and v_allocation_amount <= 0 then
      raise exception 'Los montos asignados deben ser mayores a cero.';
    end if;
    if v_allocation_percentage is not null and v_allocation_percentage <= 0 then
      raise exception 'Los porcentajes asignados deben ser mayores a cero.';
    end if;
    if v_allocation_amount is not null and v_allocation_percentage is not null then
      raise exception 'Usa montos o porcentajes, no ambos en la misma allocation.';
    end if;

    v_has_amount := v_has_amount or v_allocation_amount is not null;
    v_has_percentage := v_has_percentage or v_allocation_percentage is not null;
    v_amount_sum := v_amount_sum + coalesce(v_allocation_amount, 0);
    v_percentage_sum := v_percentage_sum + coalesce(v_allocation_percentage, 0);
  end loop;

  if v_has_amount and v_has_percentage then
    raise exception 'Todas las allocations deben usar el mismo modo: montos o porcentajes.';
  end if;
  if v_has_amount and abs(v_amount_sum - v_abs_amount) > 0.01 then
    raise exception 'La suma de allocations debe igualar el monto del movimiento.';
  end if;
  if v_has_percentage and abs(v_percentage_sum - 100) > 0.01 then
    raise exception 'Los porcentajes de allocations deben sumar 100%.';
  end if;

  if v_alloc_count = 1 then
    select nullif(value->>'entity_id', '')::uuid
    into v_owner_entity_id
    from jsonb_array_elements(p_allocations)
    limit 1;
  elsif v_alloc_count > 1 then
    v_owner_entity_id := null;
  end if;

  if p_transaction_id is null then
    insert into public.hr_transactions (
      event_id,
      event_key,
      movement_type,
      concept,
      amount,
      hidden_room_share,
      from_user_id,
      to_user_id,
      owner_user_id,
      owner_entity_id,
      payment_method,
      movement_date,
      notes,
      user_id,
      username,
      created_by,
      created_by_user_id,
      created_by_username,
      type,
      via,
      date,
      "M.A.I."
    )
    values (
      v_event_id,
      v_event_key,
      nullif(p_transaction->>'movement_type', ''),
      nullif(trim(p_transaction->>'concept'), ''),
      v_amount,
      v_hidden_room_share,
      nullif(p_transaction->>'from_user_id', ''),
      nullif(p_transaction->>'to_user_id', ''),
      nullif(p_transaction->>'owner_user_id', ''),
      v_owner_entity_id,
      nullif(trim(p_transaction->>'payment_method'), ''),
      coalesce(nullif(p_transaction->>'movement_date', '')::date, current_date),
      nullif(trim(p_transaction->>'notes'), ''),
      nullif(p_transaction->>'user_id', ''),
      nullif(p_transaction->>'username', ''),
      coalesce(nullif(p_transaction->>'created_by', '')::uuid, v_auth_uid),
      nullif(p_transaction->>'created_by_user_id', ''),
      nullif(p_transaction->>'created_by_username', ''),
      nullif(p_transaction->>'type', ''),
      nullif(trim(p_transaction->>'via'), ''),
      coalesce(nullif(p_transaction->>'date', '')::date, coalesce(nullif(p_transaction->>'movement_date', '')::date, current_date)),
      v_hidden_room_share
    )
    returning id into v_saved_id;
  else
    update public.hr_transactions
    set
      event_id = v_event_id,
      event_key = v_event_key,
      movement_type = nullif(p_transaction->>'movement_type', ''),
      concept = nullif(trim(p_transaction->>'concept'), ''),
      amount = v_amount,
      hidden_room_share = v_hidden_room_share,
      from_user_id = nullif(p_transaction->>'from_user_id', ''),
      to_user_id = nullif(p_transaction->>'to_user_id', ''),
      owner_user_id = nullif(p_transaction->>'owner_user_id', ''),
      owner_entity_id = v_owner_entity_id,
      payment_method = nullif(trim(p_transaction->>'payment_method'), ''),
      movement_date = coalesce(nullif(p_transaction->>'movement_date', '')::date, current_date),
      notes = nullif(trim(p_transaction->>'notes'), ''),
      user_id = nullif(p_transaction->>'user_id', ''),
      username = nullif(p_transaction->>'username', ''),
      type = nullif(p_transaction->>'type', ''),
      via = nullif(trim(p_transaction->>'via'), ''),
      date = coalesce(nullif(p_transaction->>'date', '')::date, coalesce(nullif(p_transaction->>'movement_date', '')::date, current_date)),
      "M.A.I." = v_hidden_room_share
    where id = p_transaction_id
    returning id into v_saved_id;

    if v_saved_id is null then
      raise exception 'Movimiento no encontrado.';
    end if;
  end if;

  delete from public.hr_transaction_allocations
  where transaction_id = v_saved_id;

  for allocation in select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    v_entity_id := nullif(allocation->>'entity_id', '')::uuid;
    v_allocation_amount := nullif(allocation->>'amount', '')::numeric;
    v_allocation_percentage := nullif(allocation->>'percentage', '')::numeric;

    if v_has_percentage then
      v_allocation_amount := round((v_abs_amount * v_allocation_percentage / 100)::numeric, 2);
    elsif v_has_amount then
      v_allocation_percentage := round((v_allocation_amount / v_abs_amount * 100)::numeric, 6);
    end if;

    insert into public.hr_transaction_allocations (
      transaction_id,
      entity_id,
      amount,
      percentage
    )
    values (
      v_saved_id,
      v_entity_id,
      v_allocation_amount,
      v_allocation_percentage
    );
  end loop;

  return v_saved_id;
end;
$$;

grant execute on function public.save_hr_transaction_with_allocations(jsonb, jsonb, uuid) to authenticated;
