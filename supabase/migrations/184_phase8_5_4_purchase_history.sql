-- ServeFlow Phase 8.5.4: read-only purchase history.
-- Reuses the existing purchase-order, receipt, supplier, item, unit, and staff
-- tables. This migration performs no schema redesign and exposes no mutations.

create or replace function public.purchase_history_can_read(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_staff staff
    where staff.restaurant_id = target_restaurant_id
      and staff.user_id = auth.uid()
      and staff.active = true
  );
$$;

create or replace function public.get_purchase_history(target_restaurant_id uuid)
returns table(
  id uuid,
  restaurant_id uuid,
  purchase_number text,
  supplier_id uuid,
  supplier_name text,
  status text,
  expected_delivery_date date,
  notes text,
  created_by_staff_id uuid,
  created_by_name text,
  created_at timestamptz,
  first_received_at timestamptz,
  received_at timestamptz,
  received_by_names text,
  item_count bigint,
  total_cost numeric,
  received_cost numeric,
  remaining_cost numeric,
  lines jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.purchase_history_can_read(target_restaurant_id) then
    raise exception 'Purchase history access denied.';
  end if;

  return query
  select
    purchase_order.id,
    purchase_order.restaurant_id,
    'PO-' || upper(left(purchase_order.id::text, 8)),
    purchase_order.supplier_id,
    supplier.name,
    purchase_order.status,
    purchase_order.expected_delivery_date,
    purchase_order.notes,
    purchase_order.created_by_staff_id,
    coalesce(creator.display_name, creator.email, creator.role::text),
    purchase_order.created_at,
    receipt_summary.first_received_at,
    receipt_summary.received_at,
    receipt_summary.received_by_names,
    count(line.id)::bigint,
    coalesce(sum(line.quantity * line.unit_price), 0)::numeric(18,6),
    coalesce(sum(line.received_quantity * line.unit_price), 0)::numeric(18,6),
    coalesce(sum((line.quantity - line.received_quantity) * line.unit_price), 0)::numeric(18,6),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', line.id,
      'inventory_item_id', line.inventory_item_id,
      'inventory_item_name', item.name,
      'ordered_quantity', line.quantity,
      'received_quantity', line.received_quantity,
      'remaining_quantity', line.quantity - line.received_quantity,
      'purchase_unit_id', line.purchase_unit_id,
      'purchase_unit_name', purchase_unit.name,
      'unit_price', line.unit_price,
      'line_total', line.quantity * line.unit_price,
      'sort_order', line.sort_order
    ) order by line.sort_order, line.id)
      filter (where line.id is not null), '[]'::jsonb)
  from public.purchase_orders purchase_order
  join public.inventory_suppliers supplier
    on supplier.id = purchase_order.supplier_id
   and supplier.restaurant_id = purchase_order.restaurant_id
  join public.restaurant_staff creator
    on creator.id = purchase_order.created_by_staff_id
   and creator.restaurant_id = purchase_order.restaurant_id
  left join public.purchase_order_items line
    on line.purchase_order_id = purchase_order.id
   and line.restaurant_id = purchase_order.restaurant_id
  left join public.inventory_items item
    on item.id = line.inventory_item_id
   and item.restaurant_id = line.restaurant_id
  left join public.inventory_units purchase_unit
    on purchase_unit.id = line.purchase_unit_id
   and purchase_unit.restaurant_id = line.restaurant_id
  left join lateral (
    select
      min(receipt.received_at) first_received_at,
      max(receipt.received_at) received_at,
      string_agg(distinct coalesce(receiver.display_name, receiver.email, receiver.role::text), ', ')
        received_by_names
    from public.purchase_order_receipts receipt
    join public.restaurant_staff receiver
      on receiver.id = receipt.received_by_staff_id
     and receiver.restaurant_id = receipt.restaurant_id
    where receipt.restaurant_id = purchase_order.restaurant_id
      and receipt.purchase_order_id = purchase_order.id
  ) receipt_summary on true
  where purchase_order.restaurant_id = target_restaurant_id
  group by purchase_order.id, supplier.name,
    creator.display_name, creator.email, creator.role,
    receipt_summary.first_received_at, receipt_summary.received_at,
    receipt_summary.received_by_names
  order by purchase_order.created_at desc, purchase_order.id desc;
end;
$$;

revoke all on function public.purchase_history_can_read(uuid) from public, anon;
revoke all on function public.get_purchase_history(uuid) from public, anon;
grant execute on function public.purchase_history_can_read(uuid),
  public.get_purchase_history(uuid) to authenticated;

comment on function public.get_purchase_history(uuid) is
  'Read-only tenant-scoped purchase summary and line detail over existing purchase tables.';
