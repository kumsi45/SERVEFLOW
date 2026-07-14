-- Real split-bill quantities: supports one line such as Burger x2.
create or replace function public.split_waiter_bill_quantities(target_order_id uuid, requested_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session public.orders;
  waiter public.restaurant_staff;
  new_invoice public.order_invoices;
  line record;
  requested_count integer;
  selected_units integer;
  unpaid_units integer;
  selected_total numeric(12, 2);
  next_invoice_number integer;
begin
  select * into session from public.orders orders where orders.id = target_order_id for update;
  select * into waiter from public.restaurant_staff staff
  where staff.restaurant_id = session.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;

  if waiter.id is null then raise exception 'Active waiter access required.'; end if;
  if session.dining_session_status <> 'open' then raise exception 'This dining session is closed.'; end if;
  if jsonb_typeof(requested_items) is distinct from 'array' or jsonb_array_length(requested_items) = 0 then
    raise exception 'Choose item quantities to split.';
  end if;

  select coalesce(sum(items.quantity), 0) into unpaid_units
  from public.order_items items
  join public.order_invoices invoices on invoices.id = items.invoice_id
  where items.order_id = session.id and invoices.status = 'pending' and invoices.verified_at is null;

  with requested as (
    select (value->>'item_id')::uuid item_id, (value->>'quantity')::integer quantity
    from jsonb_array_elements(requested_items)
  ), eligible as (
    select requested.item_id, requested.quantity, items.quantity available_quantity, items.price
    from requested
    join public.order_items items on items.id = requested.item_id and items.order_id = session.id
    join public.order_invoices invoices on invoices.id = items.invoice_id
    where invoices.status = 'pending'
      and invoices.verified_at is null
      and requested.quantity between 1 and items.quantity
  )
  select count(*), coalesce(sum(quantity), 0), coalesce(sum(quantity * price), 0)
  into requested_count, selected_units, selected_total
  from eligible;

  if requested_count <> jsonb_array_length(requested_items) then raise exception 'Split contains invalid or paid items.'; end if;
  if selected_units >= unpaid_units then raise exception 'At least one item must remain on the original bill.'; end if;

  select coalesce(max(invoice_number), 0) + 1 into next_invoice_number
  from public.order_invoices invoices where invoices.order_id = session.id;

  insert into public.order_invoices (restaurant_id, order_id, invoice_number, status, total_price, payment_method)
  values (session.restaurant_id, session.id, next_invoice_number, 'pending', selected_total, session.payment_method)
  returning * into new_invoice;

  for line in
    select items.*, requested.quantity as split_quantity
    from (
      select (value->>'item_id')::uuid item_id, (value->>'quantity')::integer quantity
      from jsonb_array_elements(requested_items)
    ) requested
    join public.order_items items on items.id = requested.item_id
  loop
    if line.split_quantity = line.quantity then
      update public.order_items set invoice_id = new_invoice.id where id = line.id;
    else
      update public.order_items set quantity = line.quantity - line.split_quantity where id = line.id;
      insert into public.order_items (
        restaurant_id, order_id, menu_item_id, quantity, price, created_at, notes, appended_at,
        kitchen_station_id, kitchen_status, kitchen_preparation_started_at, kitchen_preparation_started_by,
        kitchen_ready_marked_at, kitchen_ready_marked_by, kitchen_completed_at, kitchen_completed_by, invoice_id
      ) values (
        line.restaurant_id, line.order_id, line.menu_item_id, line.split_quantity, line.price, line.created_at,
        line.notes, line.appended_at, line.kitchen_station_id, line.kitchen_status,
        line.kitchen_preparation_started_at, line.kitchen_preparation_started_by,
        line.kitchen_ready_marked_at, line.kitchen_ready_marked_by,
        line.kitchen_completed_at, line.kitchen_completed_by, new_invoice.id
      );
    end if;
  end loop;

  update public.order_invoices invoices
  set total_price = totals.total, updated_at = now()
  from (
    select items.invoice_id, sum(items.quantity * items.price)::numeric(12, 2) total
    from public.order_items items where items.order_id = session.id group by items.invoice_id
  ) totals
  where invoices.order_id = session.id and invoices.id = totals.invoice_id;

  delete from public.order_invoices invoices
  where invoices.order_id = session.id
    and invoices.id <> new_invoice.id
    and invoices.status = 'pending'
    and not exists (select 1 from public.order_items items where items.invoice_id = invoices.id);

  return jsonb_build_object(
    'order_id', session.id,
    'invoice_id', new_invoice.id,
    'invoice_number', new_invoice.invoice_number,
    'invoice_total', new_invoice.total_price,
    'units_moved', selected_units
  );
end;
$$;

revoke execute on function public.split_waiter_bill(uuid, uuid[]) from authenticated;
revoke all on function public.split_waiter_bill_quantities(uuid, jsonb) from public, anon;
grant execute on function public.split_waiter_bill_quantities(uuid, jsonb) to authenticated, service_role;
