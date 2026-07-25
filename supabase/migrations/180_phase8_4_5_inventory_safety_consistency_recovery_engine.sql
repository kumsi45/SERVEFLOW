-- ServeFlow Phase 8.4.5: Inventory Safety, Consistency & Recovery Engine
-- Read-only verification only. This migration does not alter deduction,
-- movement, realtime, workflow, recipe, order, payment, or kitchen behavior.

create or replace function public.run_inventory_integrity_check(
  target_restaurant_id uuid
)
returns table(
  check_code text,
  check_name text,
  check_status text,
  issue_count bigint,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_role(
    target_restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  ) then
    raise exception 'Inventory integrity check access denied.';
  end if;

  return query
  with movement_balance as (
    select
      movement.inventory_item_id,
      movement.storage_location_id,
      coalesce(sum(public.inventory_movement_signed_quantity(
        movement.quantity,
        movement.quantity_effect
      )), 0)::numeric(12,3) quantity
    from public.inventory_movements movement
    join public.inventory_items item
      on item.id = movement.inventory_item_id
     and item.restaurant_id = movement.restaurant_id
     and item.status = 'active'
    join public.inventory_storage_locations storage
      on storage.id = movement.storage_location_id
     and storage.restaurant_id = movement.restaurant_id
     and storage.status = 'active'
    where movement.restaurant_id = target_restaurant_id
    group by movement.inventory_item_id, movement.storage_location_id
  ), projected_balance as (
    select stock.inventory_item_id, stock.storage_location_id,
      stock.current_quantity::numeric(12,3) quantity
    from public.get_inventory_current_stock(target_restaurant_id) stock
  ), balance_comparison as (
    select
      coalesce(movement.inventory_item_id, projected.inventory_item_id) inventory_item_id,
      coalesce(movement.storage_location_id, projected.storage_location_id) storage_location_id,
      coalesce(movement.quantity, 0)::numeric(12,3) movement_quantity,
      coalesce(projected.quantity, 0)::numeric(12,3) projected_quantity
    from movement_balance movement
    full join projected_balance projected
      on projected.inventory_item_id = movement.inventory_item_id
     and projected.storage_location_id = movement.storage_location_id
  ), issues as (
    select
      'STOCK_BALANCE_MISMATCH'::text code,
      balance.inventory_item_id::text || ':' || balance.storage_location_id::text entity_id,
      jsonb_build_object(
        'inventory_item_id', balance.inventory_item_id,
        'storage_location_id', balance.storage_location_id,
        'movement_total', balance.movement_quantity,
        'projected_quantity', balance.projected_quantity
      ) detail
    from balance_comparison balance
    where abs(balance.movement_quantity - balance.projected_quantity) > 0.0005

    union all

    select
      'DUPLICATE_CONSUMPTION_RECEIPTS',
      receipt.order_item_id::text,
      jsonb_build_object('order_item_id', receipt.order_item_id, 'receipt_count', count(*))
    from public.inventory_order_item_deductions receipt
    where receipt.restaurant_id = target_restaurant_id
    group by receipt.order_item_id
    having count(*) > 1

    union all

    select
      'DUPLICATE_CONSUMPTION_MOVEMENTS',
      movement.source_record_id::text || ':' || movement.inventory_item_id::text,
      jsonb_build_object(
        'order_item_id', movement.source_record_id,
        'inventory_item_id', movement.inventory_item_id,
        'movement_count', count(*)
      )
    from public.inventory_movements movement
    where movement.restaurant_id = target_restaurant_id
      and movement.source_system = 'automatic_order_item_deduction'
    group by movement.source_record_id, movement.inventory_item_id
    having count(*) > 1

    union all

    select
      'ORPHAN_CONSUMPTION_MOVEMENTS',
      movement.id::text,
      jsonb_build_object(
        'movement_id', movement.id,
        'source_order_item_id', movement.source_record_id
      )
    from public.inventory_movements movement
    left join public.inventory_order_item_deductions receipt
      on receipt.restaurant_id = movement.restaurant_id
     and receipt.order_item_id = movement.source_record_id
    where movement.restaurant_id = target_restaurant_id
      and movement.source_system = 'automatic_order_item_deduction'
      and receipt.order_item_id is null

    union all

    select
      'RECEIPT_PLAN_MOVEMENT_MISMATCH',
      receipt.order_item_id::text,
      jsonb_build_object(
        'order_item_id', receipt.order_item_id,
        'expected_movement_count', jsonb_array_length(receipt.deduction_plan),
        'actual_movement_count', (
          select count(*)
          from public.inventory_movements movement
          where movement.restaurant_id = receipt.restaurant_id
            and movement.source_system = 'automatic_order_item_deduction'
            and movement.source_record_id = receipt.order_item_id
        )
      )
    from public.inventory_order_item_deductions receipt
    where receipt.restaurant_id = target_restaurant_id
      and (
        jsonb_array_length(receipt.deduction_plan) <> (
          select count(*)
          from public.inventory_movements movement
          where movement.restaurant_id = receipt.restaurant_id
            and movement.source_system = 'automatic_order_item_deduction'
            and movement.source_record_id = receipt.order_item_id
        )
        or exists (
          select 1
          from jsonb_array_elements(receipt.deduction_plan) plan(entry)
          where not exists (
            select 1
            from public.inventory_movements movement
            where movement.restaurant_id = receipt.restaurant_id
              and movement.source_system = 'automatic_order_item_deduction'
              and movement.source_record_id = receipt.order_item_id
              and movement.inventory_item_id = (plan.entry->>'inventory_item_id')::uuid
              and movement.storage_location_id = (plan.entry->>'storage_location_id')::uuid
              and movement.unit_id = (plan.entry->>'unit_id')::uuid
              and movement.quantity = (plan.entry->>'required_quantity')::numeric
          )
        )
      )

    union all

    select
      'ORDER_ITEM_LINK_MISMATCH',
      movement.id::text,
      jsonb_build_object(
        'movement_id', movement.id,
        'source_order_item_id', movement.source_record_id,
        'audit_order_item_id', movement.order_item_id
      )
    from public.inventory_movements movement
    left join public.order_items order_item
      on order_item.restaurant_id = movement.restaurant_id
     and order_item.id = movement.order_item_id
    where movement.restaurant_id = target_restaurant_id
      and movement.source_system = 'automatic_order_item_deduction'
      and (
        movement.order_item_id is null
        or movement.source_record_id is distinct from movement.order_item_id
        or order_item.id is null
      )

    union all

    select
      'MOVEMENT_QUANTITY_MISMATCH',
      movement.id::text,
      jsonb_build_object(
        'movement_id', movement.id,
        'quantity_before', movement.quantity_before,
        'deducted_quantity', movement.quantity,
        'quantity_after', movement.quantity_after
      )
    from public.inventory_movements movement
    where movement.restaurant_id = target_restaurant_id
      and movement.source_system = 'automatic_order_item_deduction'
      and (
        movement.quantity_before is null
        or movement.quantity_after is null
        or movement.quantity_after < 0
        or abs((movement.quantity_before - movement.quantity) - movement.quantity_after) > 0.0005
      )
  ), definitions(code, name, display_order) as (
    values
      ('STOCK_BALANCE_MISMATCH', 'Inventory quantity matches movement totals', 1),
      ('DUPLICATE_CONSUMPTION_RECEIPTS', 'No duplicate consumption receipts', 2),
      ('DUPLICATE_CONSUMPTION_MOVEMENTS', 'No duplicate consumption movements', 3),
      ('ORPHAN_CONSUMPTION_MOVEMENTS', 'No orphan consumption movements', 4),
      ('RECEIPT_PLAN_MOVEMENT_MISMATCH', 'Every receipt matches its complete deduction plan', 5),
      ('ORDER_ITEM_LINK_MISMATCH', 'Every consumption movement references its order item', 6),
      ('MOVEMENT_QUANTITY_MISMATCH', 'Movement before and after quantities are consistent', 7)
  ), ranked_issues as (
    select issue.*, row_number() over(partition by issue.code order by issue.entity_id) sample_number
    from issues issue
  ), summaries as (
    select
      issue.code,
      count(*)::bigint issue_count,
      jsonb_agg(
        jsonb_build_object('entity_id', issue.entity_id, 'detail', issue.detail)
        order by issue.entity_id
      ) filter (where issue.sample_number <= 10) samples
    from ranked_issues issue
    group by issue.code
  )
  select
    definition.code,
    definition.name,
    case when coalesce(summary.issue_count, 0) = 0 then 'PASS' else 'DETECTED_ISSUES' end,
    coalesce(summary.issue_count, 0)::bigint,
    jsonb_build_object('samples', coalesce(summary.samples, '[]'::jsonb))
  from definitions definition
  left join summaries summary on summary.code = definition.code
  order by definition.display_order;
end;
$$;

revoke all on function public.run_inventory_integrity_check(uuid) from public, anon;
grant execute on function public.run_inventory_integrity_check(uuid) to authenticated;

comment on function public.run_inventory_integrity_check(uuid) is
  'Owner-only, tenant-scoped, read-only Phase 8.4.5 inventory integrity diagnostics. Never repairs data.';
