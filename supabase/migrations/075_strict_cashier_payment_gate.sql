-- ServeFlow Phase W2.1 strict cashier payment gate.
-- All customer-facing order items stay held until an active cashier verifies
-- the pending invoice. Kitchen dashboards only receive released paid items.

create or replace function public.create_cashier_order(
  target_restaurant_id uuid,
  table_number text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_total_tables integer;
  created_order public.orders;
  created_invoice public.order_invoices;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_payment_method text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create cashier orders.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role = 'cashier'
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers may create cashier orders.';
  end if;

  normalized_table_number_text := nullif(trim(table_number), '');
  normalized_payment_method := coalesce(nullif(trim(selected_payment_method), ''), 'Cash');

  if normalized_table_number_text is null then
    raise exception 'Table number is required.';
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  select r.total_tables
  into target_total_tables
  from public.restaurants r
  where r.id = target_restaurant_id
  limit 1;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = target_restaurant_id
      and rt.table_number = normalized_table_number
      and rt.active = true
  ) then
    raise exception 'Invalid table number. Please select a table between 1 and %.', coalesce(target_total_tables, 20);
  end if;

  if normalized_payment_method not in ('Cash', 'Telebirr', 'CBE Birr', 'Mobile Banking', 'Chapa', 'Credit/Debit Card') then
    raise exception 'Payment method is not supported.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then
    raise exception 'Order must include at least one item.';
  end if;
  if requested_count > 50 then
    raise exception 'Order cannot include more than 50 line items.';
  end if;

  with normalized_items as (
    select
      case when line_item ? 'menu_item_id'
        and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (line_item->>'menu_item_id')::uuid else null end as menu_item_id,
      case when line_item ? 'quantity' and (line_item->>'quantity') ~ '^[0-9]+$'
        then (line_item->>'quantity')::integer else null end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1 from normalized_items
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 99
  ),
  valid_items as (
    select normalized_items.menu_item_id, normalized_items.quantity, menu_items.price
    from normalized_items
    join public.menu_items
      on menu_items.id = normalized_items.menu_item_id
     and menu_items.restaurant_id = target_restaurant_id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_total
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_total is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  insert into public.orders (
    restaurant_id,
    customer_user_id,
    status,
    total_price,
    customer_name,
    table_number,
    payment_method,
    order_source
  )
  values (
    target_restaurant_id,
    null,
    'pending_payment',
    computed_total,
    null,
    normalized_table_number::text,
    normalized_payment_method,
    'cashier'
  )
  returning * into created_order;

  insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method)
  values (target_restaurant_id, created_order.id, 1, 'pending', computed_total, normalized_payment_method)
  returning * into created_invoice;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, kitchen_status)
  select
    target_restaurant_id,
    created_order.id,
    created_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), ''),
    'held'
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      line_item->>'notes' as notes
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id
   and menu_items.available = true;

  return jsonb_build_object(
    'order_id', created_order.id,
    'invoice_id', created_invoice.id,
    'invoice_number', created_invoice.invoice_number,
    'invoice_status', created_invoice.status,
    'status', created_order.status,
    'total_price', created_order.total_price,
    'invoice_total', created_invoice.total_price,
    'table_number', created_order.table_number,
    'payment_method', created_invoice.payment_method,
    'order_source', created_order.order_source,
    'created_at', created_order.created_at
  );
end;
$$;

create or replace function public.append_items_to_order(
  target_order_id uuid,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  latest_invoice public.order_invoices;
  current_invoice public.order_invoices;
  next_invoice_number integer;
  requested_count integer;
  computed_addition numeric(12, 2);
  updated_order public.orders;
  active_shift_id uuid;
  added_at timestamptz := now();
  added_items jsonb;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to append order items.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role = 'cashier'
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers may append order items.';
  end if;

  if target_order.status::text not in ('pending_payment', 'paid', 'preparing', 'ready') then
    raise exception 'Items may only be appended to active orders.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then
    raise exception 'Order must include at least one item.';
  end if;
  if requested_count > 50 then
    raise exception 'Order cannot include more than 50 line items.';
  end if;

  with normalized_items as (
    select
      case when line_item ? 'menu_item_id'
        and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (line_item->>'menu_item_id')::uuid else null end as menu_item_id,
      case when line_item ? 'quantity' and (line_item->>'quantity') ~ '^[0-9]+$'
        then (line_item->>'quantity')::integer else null end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1 from normalized_items
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 99
  ),
  valid_items as (
    select normalized_items.menu_item_id, normalized_items.quantity, menu_items.price
    from normalized_items
    join public.menu_items
      on menu_items.id = normalized_items.menu_item_id
     and menu_items.restaurant_id = target_order.restaurant_id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_addition
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_addition is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  select *
  into latest_invoice
  from public.order_invoices invoices
  where invoices.restaurant_id = target_order.restaurant_id
    and invoices.order_id = target_order.id
  order by invoices.invoice_number desc
  limit 1
  for update;

  if latest_invoice.id is null or latest_invoice.status = 'paid' then
    select coalesce(max(invoice_number), 0) + 1
    into next_invoice_number
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id;

    insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method, created_at, updated_at)
    values (target_order.restaurant_id, target_order.id, next_invoice_number, 'pending', computed_addition, target_order.payment_method, added_at, added_at)
    returning * into current_invoice;
  else
    update public.order_invoices
    set
      total_price = (latest_invoice.total_price + computed_addition)::numeric(12, 2),
      updated_at = added_at
    where id = latest_invoice.id
      and restaurant_id = latest_invoice.restaurant_id
      and status = 'pending'
    returning * into current_invoice;
  end if;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, appended_at, kitchen_status)
  select
    target_order.restaurant_id,
    target_order.id,
    current_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), ''),
    added_at,
    'held'
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      line_item->>'notes' as notes
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_order.restaurant_id
   and menu_items.available = true;

  update public.orders
  set
    total_price = (target_order.total_price + computed_addition)::numeric(12, 2),
    updated_at = added_at
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id
  returning * into updated_order;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', appended.quantity,
        'unit_price', menu_items.price,
        'notes', appended.notes
      )
      order by menu_items.name
    ),
    '[]'::jsonb
  )
  into added_items
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      nullif(left(trim(coalesce(line_item->>'notes', '')), 500), '') as notes
    from jsonb_array_elements(requested_items) as line_item
  ) appended
  join public.menu_items
    on menu_items.id = appended.menu_item_id
   and menu_items.restaurant_id = target_order.restaurant_id;

  select cs.id
  into active_shift_id
  from public.cashier_shifts cs
  where cs.restaurant_id = target_order.restaurant_id
    and cs.opened_by = acting_staff.id
    and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  if active_shift_id is null then
    select cs.id
    into active_shift_id
    from public.cashier_shifts cs
    where cs.restaurant_id = target_order.restaurant_id
      and cs.closed_at is null
    order by cs.opened_at desc
    limit 1;
  end if;

  insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_order.restaurant_id,
    active_shift_id,
    target_order.id,
    acting_staff.id,
    'order_items_appended',
    'Table ' || coalesce(target_order.table_number, '-') || ' added ' || requested_count || ' item(s)',
    computed_addition,
    jsonb_build_object(
      'cashier_id', acting_staff.id,
      'order_id', target_order.id,
      'invoice_id', current_invoice.id,
      'invoice_number', current_invoice.invoice_number,
      'table_number', target_order.table_number,
      'items_added', added_items,
      'timestamp', added_at
    )
  );

  return jsonb_build_object(
    'order_id', updated_order.id,
    'invoice_id', current_invoice.id,
    'invoice_number', current_invoice.invoice_number,
    'invoice_status', current_invoice.status,
    'status', updated_order.status,
    'total_price', updated_order.total_price,
    'invoice_total', current_invoice.total_price,
    'table_number', updated_order.table_number,
    'payment_method', current_invoice.payment_method,
    'order_source', updated_order.order_source,
    'created_at', updated_order.created_at,
    'appended_at', added_at,
    'items_added', added_items
  );
end;
$$;

create or replace function public.approve_order_payment(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_order public.orders;
  target_invoice public.order_invoices;
  updated_order public.orders;
  active_shift_id uuid;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to approve payment.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role = 'cashier'
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers may approve payment.';
  end if;

  select *
  into target_invoice
  from public.order_invoices invoices
  where invoices.restaurant_id = target_order.restaurant_id
    and invoices.order_id = target_order.id
    and invoices.status = 'pending'
  order by invoices.invoice_number desc
  limit 1
  for update;

  if target_invoice.id is null then
    raise exception 'No pending invoice was found for this order.';
  end if;

  update public.order_invoices
  set
    status = 'paid',
    paid_at = now(),
    paid_by = acting_staff.id,
    locked_at = now(),
    updated_at = now()
  where id = target_invoice.id
    and restaurant_id = target_invoice.restaurant_id
    and status = 'pending'
  returning * into target_invoice;

  update public.order_items items
  set kitchen_status = 'paid'
  where items.restaurant_id = target_invoice.restaurant_id
    and items.invoice_id = target_invoice.id
    and items.kitchen_status = 'held';

  update public.orders
  set
    payment_verified_at = coalesce(payment_verified_at, target_invoice.paid_at),
    payment_verified_by = coalesce(payment_verified_by, acting_staff.id),
    payment_method = coalesce(payment_method, target_invoice.payment_method),
    updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id;

  updated_order := public.derive_order_status_from_items(target_order.id, acting_staff.id);

  select cs.id
  into active_shift_id
  from public.cashier_shifts cs
  where cs.restaurant_id = target_order.restaurant_id
    and cs.opened_by = acting_staff.id
    and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  if active_shift_id is null then
    select cs.id
    into active_shift_id
    from public.cashier_shifts cs
    where cs.restaurant_id = target_order.restaurant_id
      and cs.closed_at is null
    order by cs.opened_at desc
    limit 1;
  end if;

  insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_order.restaurant_id,
    active_shift_id,
    target_order.id,
    acting_staff.id,
    'payment_verified',
    'Invoice #' || target_invoice.invoice_number || ' payment verified for table ' || coalesce(target_order.table_number, '-'),
    target_invoice.total_price,
    jsonb_build_object(
      'invoice_id', target_invoice.id,
      'invoice_number', target_invoice.invoice_number,
      'payment_method', target_invoice.payment_method,
      'table_number', target_order.table_number,
      'staff_id', acting_staff.id
    )
  );

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'approve_payment',
      target_order.id,
      jsonb_build_object(
        'invoice_id', target_invoice.id,
        'invoice_number', target_invoice.invoice_number,
        'invoice_total', target_invoice.total_price,
        'payment_method', target_invoice.payment_method,
        'table_number', updated_order.table_number,
        'staff_id', acting_staff.id
      )
    );
  end if;

  return updated_order;
end;
$$;

update public.orders orders
set
  status = 'pending_payment',
  payment_verified_at = null,
  payment_verified_by = null,
  updated_at = now()
where orders.status::text in ('paid', 'preparing', 'ready')
  and orders.order_source in ('public_qr', 'cashier')
  and exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = orders.restaurant_id
      and invoices.order_id = orders.id
      and invoices.status = 'pending'
  )
  and not exists (
    select 1
    from public.order_items items
    where items.restaurant_id = orders.restaurant_id
      and items.order_id = orders.id
      and items.kitchen_status <> 'held'
  );

revoke all on function public.create_cashier_order(uuid, text, text, jsonb) from public, anon;
revoke all on function public.append_items_to_order(uuid, jsonb) from public, anon;
revoke all on function public.approve_order_payment(uuid) from public, anon;
grant execute on function public.create_cashier_order(uuid, text, text, jsonb) to authenticated;
grant execute on function public.append_items_to_order(uuid, jsonb) to authenticated;
grant execute on function public.approve_order_payment(uuid) to authenticated;
