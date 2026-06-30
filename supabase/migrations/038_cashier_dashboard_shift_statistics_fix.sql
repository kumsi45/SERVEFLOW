-- Fix cashier dashboard statistics using existing shift and payment relationships.
-- This intentionally does not add orders.cashier_id or any cashier ownership column.

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
  active_shift public.cashier_shifts;
  target_total_tables integer;
  created_order public.orders;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_payment_method text;
  verified_at timestamptz := now();
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
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may create cashier orders.';
  end if;

  select *
  into active_shift
  from public.cashier_shifts
  where restaurant_id = target_restaurant_id
    and opened_by = acting_staff.id
    and closed_at is null
  order by opened_at desc
  limit 1;

  if active_shift.id is null then
    raise exception 'Open a cashier shift before creating orders.';
  end if;

  normalized_table_number_text := nullif(trim(table_number), '');
  normalized_payment_method := nullif(trim(selected_payment_method), '');

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

  if normalized_payment_method is null then
    normalized_payment_method := 'Cash';
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
    order_source,
    payment_verified_at,
    payment_verified_by
  )
  values (
    target_restaurant_id,
    null,
    'paid',
    computed_total,
    null,
    normalized_table_number::text,
    normalized_payment_method,
    'cashier',
    verified_at,
    acting_staff.id
  )
  returning * into created_order;

  insert into public.order_items (restaurant_id, order_id, menu_item_id, quantity, price, notes)
  select
    target_restaurant_id,
    created_order.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), '')
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

  update public.shift_activity_logs
  set
    shift_id = active_shift.id,
    actor_staff_id = acting_staff.id,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'table_number', created_order.table_number,
      'status', created_order.status::text,
      'order_source', created_order.order_source,
      'item_count', requested_count,
      'payment_verified_by', acting_staff.id,
      'payment_verified_at', verified_at
    )
  where restaurant_id = target_restaurant_id
    and order_id = created_order.id
    and action = 'order_created';

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_restaurant_id,
      auth.uid(),
      'create_cashier_order',
      created_order.id,
      jsonb_build_object(
        'order_total', created_order.total_price,
        'payment_method', created_order.payment_method,
        'table_number', created_order.table_number,
        'item_count', requested_count,
        'staff_id', acting_staff.id
      )
    );
  end if;

  return jsonb_build_object(
    'order_id', created_order.id,
    'status', created_order.status,
    'total_price', created_order.total_price,
    'table_number', created_order.table_number,
    'payment_method', created_order.payment_method,
    'order_source', created_order.order_source,
    'payment_verified_at', created_order.payment_verified_at,
    'created_at', created_order.created_at
  );
end;
$$;

revoke all on function public.create_cashier_order(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_cashier_order(uuid, text, text, jsonb) to authenticated;

create or replace function public.get_cashier_shift_summary(target_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  active_shift public.cashier_shifts;
  cash_total numeric(12, 2) := 0;
  digital_total numeric(12, 2) := 0;
  orders_processed integer := 0;
  payments_processed integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view shift status.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role::text in ('cashier', 'owner', 'manager')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers, managers, and owners may view shift status.';
  end if;

  if acting_staff.role = 'cashier' then
    select *
    into active_shift
    from public.cashier_shifts
    where restaurant_id = target_restaurant_id
      and opened_by = acting_staff.id
      and closed_at is null
    order by opened_at desc
    limit 1;
  end if;

  if active_shift.id is not null then
    select
      coalesce(sum(o.total_price) filter (where o.payment_method = 'Cash'), 0),
      coalesce(sum(o.total_price) filter (where coalesce(o.payment_method, '') <> 'Cash'), 0),
      count(*)
    into cash_total, digital_total, payments_processed
    from public.orders o
    where o.restaurant_id = target_restaurant_id
      and o.payment_verified_by = active_shift.opened_by
      and o.payment_verified_at >= active_shift.opened_at
      and o.payment_verified_at <= now();

    select count(distinct logs.order_id)
    into orders_processed
    from public.shift_activity_logs logs
    where logs.restaurant_id = target_restaurant_id
      and logs.shift_id = active_shift.id
      and logs.action = 'order_created'
      and logs.metadata->>'order_source' = 'cashier'
      and logs.order_id is not null;
  end if;

  return jsonb_build_object(
    'staff_id', acting_staff.id,
    'active_shift', case when active_shift.id is null then null else jsonb_build_object(
      'id', active_shift.id,
      'restaurant_id', active_shift.restaurant_id,
      'opened_by', active_shift.opened_by,
      'opened_at', active_shift.opened_at,
      'opening_cash', active_shift.opening_cash,
      'notes', active_shift.notes,
      'cash_collected', cash_total,
      'digital_collected', digital_total,
      'orders_processed', orders_processed,
      'payments_processed', payments_processed,
      'expected_cash', active_shift.opening_cash + cash_total
    ) end
  );
end;
$$;

revoke all on function public.get_cashier_shift_summary(uuid) from public, anon;
grant execute on function public.get_cashier_shift_summary(uuid) to authenticated;

create or replace function public.close_cashier_shift(
  target_shift_id uuid,
  actual_cash_amount numeric,
  variance_explanation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_shift public.cashier_shifts;
  cash_payments numeric(12, 2) := 0;
  cash_refunds numeric(12, 2) := 0;
  expected_drawer numeric(12, 2);
  variance_amount numeric(12, 2);
  unpaid_orders integer := 0;
  active_orders integer := 0;
  reconciliation_row public.cash_reconciliations;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to close a shift.';
  end if;

  if actual_cash_amount is null or actual_cash_amount < 0 then
    raise exception 'Actual cash must be zero or greater.';
  end if;

  select *
  into target_shift
  from public.cashier_shifts
  where id = target_shift_id
  for update;

  if target_shift.id is null then
    raise exception 'Shift not found.';
  end if;

  if target_shift.closed_at is not null then
    raise exception 'Shift is already closed.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_shift.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null or acting_staff.id <> target_shift.opened_by then
    raise exception 'Only the cashier who opened this shift may close it.';
  end if;

  select coalesce(sum(o.total_price), 0)
  into cash_payments
  from public.orders o
  where o.restaurant_id = target_shift.restaurant_id
    and o.payment_method = 'Cash'
    and o.payment_verified_by = target_shift.opened_by
    and o.payment_verified_at >= target_shift.opened_at
    and o.payment_verified_at <= now();

  select
    count(*) filter (where scoped.payment_verified_at is null),
    count(*) filter (where scoped.status::text not in ('completed', 'cancelled'))
  into unpaid_orders, active_orders
  from (
    select distinct o.id, o.status, o.payment_verified_at
    from public.orders o
    where o.restaurant_id = target_shift.restaurant_id
      and (
        exists (
          select 1
          from public.shift_activity_logs logs
          where logs.restaurant_id = o.restaurant_id
            and logs.order_id = o.id
            and logs.shift_id = target_shift.id
            and logs.action in ('order_created', 'order_items_appended')
        )
        or (
          o.payment_verified_by = target_shift.opened_by
          and o.payment_verified_at >= target_shift.opened_at
          and o.payment_verified_at <= now()
        )
      )
  ) scoped;

  if unpaid_orders > 0 then
    raise exception 'Shift cannot close while % unpaid order(s) remain.', unpaid_orders;
  end if;

  if active_orders > 0 then
    raise exception 'Shift cannot close while % active order(s) remain.', active_orders;
  end if;

  expected_drawer := target_shift.opening_cash + cash_payments - cash_refunds;
  variance_amount := actual_cash_amount - expected_drawer;

  if variance_amount <> 0 and nullif(trim(variance_explanation), '') is null then
    raise exception 'Variance explanation is required when cash variance is non-zero.';
  end if;

  update public.cashier_shifts
  set
    closed_at = now(),
    closed_by = acting_staff.id,
    expected_cash = expected_drawer,
    actual_cash = actual_cash_amount,
    variance = variance_amount,
    variance_reason = nullif(trim(variance_explanation), '')
  where id = target_shift.id
  returning * into target_shift;

  insert into public.cash_reconciliations (
    restaurant_id,
    shift_id,
    closed_by,
    opening_cash,
    cash_payments,
    cash_refunds,
    expected_cash,
    actual_cash,
    variance,
    variance_reason,
    closed_at
  )
  values (
    target_shift.restaurant_id,
    target_shift.id,
    acting_staff.id,
    target_shift.opening_cash,
    cash_payments,
    cash_refunds,
    expected_drawer,
    actual_cash_amount,
    variance_amount,
    nullif(trim(variance_explanation), ''),
    target_shift.closed_at
  )
  returning * into reconciliation_row;

  insert into public.shift_activity_logs (restaurant_id, shift_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_shift.restaurant_id,
    target_shift.id,
    acting_staff.id,
    'shift_closed',
    'Shift closed',
    actual_cash_amount,
    jsonb_build_object('expected_cash', expected_drawer, 'variance', variance_amount)
  );

  return jsonb_build_object('shift', to_jsonb(target_shift), 'reconciliation', to_jsonb(reconciliation_row));
end;
$$;

revoke all on function public.close_cashier_shift(uuid, numeric, text) from public, anon;
grant execute on function public.close_cashier_shift(uuid, numeric, text) to authenticated;

create or replace function public.log_shift_order_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_shift_id uuid;
  actor_staff_id uuid;
  created_item_count integer := 0;
begin
  if tg_op = 'INSERT' then
    if new.payment_verified_by is not null then
      select cs.id, cs.opened_by
      into active_shift_id, actor_staff_id
      from public.cashier_shifts cs
      where cs.restaurant_id = new.restaurant_id
        and cs.opened_by = new.payment_verified_by
        and cs.closed_at is null
      order by cs.opened_at desc
      limit 1;
    end if;

    select count(*)
    into created_item_count
    from public.order_items oi
    where oi.restaurant_id = new.restaurant_id
      and oi.order_id = new.id;

    insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
    values (
      new.restaurant_id,
      active_shift_id,
      new.id,
      actor_staff_id,
      'order_created',
      'Order ' || left(new.id::text, 6) || ' created',
      new.total_price,
      jsonb_build_object(
        'table_number', new.table_number,
        'status', new.status::text,
        'order_source', new.order_source,
        'item_count', created_item_count,
        'payment_verified_by', new.payment_verified_by
      )
    );
  elsif tg_op = 'UPDATE' then
    if old.payment_verified_at is null and new.payment_verified_at is not null then
      select cs.id
      into active_shift_id
      from public.cashier_shifts cs
      where cs.restaurant_id = new.restaurant_id
        and cs.opened_by = new.payment_verified_by
        and cs.closed_at is null
      order by cs.opened_at desc
      limit 1;

      insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
      values (
        new.restaurant_id,
        active_shift_id,
        new.id,
        new.payment_verified_by,
        'payment_verified',
        'Table ' || coalesce(new.table_number, '-') || ' paid',
        new.total_price,
        jsonb_build_object('payment_method', new.payment_method, 'table_number', new.table_number)
      );
    end if;

    if old.status is distinct from new.status and new.status::text = 'completed' then
      select cs.id, cs.opened_by
      into active_shift_id, actor_staff_id
      from public.cashier_shifts cs
      where cs.restaurant_id = new.restaurant_id
        and (
          cs.opened_by = new.payment_verified_by
          or exists (
            select 1
            from public.shift_activity_logs logs
            where logs.restaurant_id = new.restaurant_id
              and logs.order_id = new.id
              and logs.shift_id = cs.id
              and logs.action in ('order_created', 'order_items_appended')
          )
        )
        and cs.closed_at is null
      order by cs.opened_at desc
      limit 1;

      insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
      values (
        new.restaurant_id,
        active_shift_id,
        new.id,
        actor_staff_id,
        'order_completed',
        'Order ' || left(new.id::text, 6) || ' completed',
        new.total_price,
        jsonb_build_object('table_number', new.table_number, 'status', new.status::text)
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists log_shift_order_activity on public.orders;
create trigger log_shift_order_activity
after insert or update of status, payment_verified_at, payment_verified_by
on public.orders
for each row
execute function public.log_shift_order_activity();

revoke all on function public.log_shift_order_activity() from public, anon, authenticated;
grant execute on function public.log_shift_order_activity() to service_role;
