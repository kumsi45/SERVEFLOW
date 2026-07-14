-- Final waiter dashboard polish: safe pending-item notes and transfer policy.

create or replace function public.update_waiter_pending_item_note(target_item_id uuid, new_note text)
returns public.order_items
language plpgsql
security definer
set search_path = public
as $$
declare
  target_item public.order_items;
  waiter public.restaurant_staff;
begin
  select items.* into target_item
  from public.order_items items
  where items.id = target_item_id
  for update;

  select staff.* into waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_item.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;

  if waiter.id is null then raise exception 'Active waiter access required.'; end if;
  if target_item.kitchen_status not in ('held', 'paid') then
    raise exception 'This item was accepted by the kitchen and cannot be modified.';
  end if;
  if not exists (
    select 1 from public.order_invoices invoices
    where invoices.id = target_item.invoice_id
      and invoices.status = 'pending'
      and invoices.verified_at is null
  ) then
    raise exception 'Only unpaid items can be modified.';
  end if;

  update public.order_items
  set notes = nullif(left(trim(coalesce(new_note, '')), 500), ''), updated_at = now()
  where id = target_item.id
  returning * into target_item;
  return target_item;
end;
$$;

create or replace function public.get_waiter_item_notes(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.orders;
  waiter public.restaurant_staff;
  result jsonb;
begin
  select * into target from public.orders orders where orders.id = target_order_id;
  select * into waiter from public.restaurant_staff staff
  where staff.restaurant_id = target.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;
  if target.id is null or waiter.id is null then raise exception 'Active waiter session not found.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('item_id', items.id, 'notes', items.notes)), '[]'::jsonb)
  into result
  from public.order_items items
  where items.order_id = target.id;
  return result;
end;
$$;

create or replace function public.get_waiter_transfer_policy(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target public.orders;
  waiter public.restaurant_staff;
  restaurant public.restaurants;
  manager_allows boolean;
begin
  select * into target from public.orders orders where orders.id = target_order_id;
  select * into waiter from public.restaurant_staff staff
  where staff.restaurant_id = target.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;
  if target.id is null or waiter.id is null then raise exception 'Active waiter session not found.'; end if;

  select * into restaurant from public.restaurants restaurants where restaurants.id = target.restaurant_id;
  manager_allows := coalesce((restaurant.ordering_settings->>'allow_waiter_table_transfer')::boolean, true);

  if target.dining_session_status <> 'open' then
    return jsonb_build_object('allowed', false, 'reason', 'This dining session is closed.');
  end if;
  if exists (select 1 from public.order_items items where items.order_id = target.id and items.kitchen_status = 'preparing') then
    return jsonb_build_object('allowed', false, 'reason', 'Kitchen preparation is active. Transfer is available after preparation finishes.');
  end if;
  if exists (select 1 from public.order_invoices invoices where invoices.order_id = target.id)
     and not exists (select 1 from public.order_invoices invoices where invoices.order_id = target.id and invoices.status not in ('verified', 'refunded', 'cancelled')) then
    return jsonb_build_object('allowed', false, 'reason', 'Payment is complete.');
  end if;
  if not manager_allows then
    return jsonb_build_object('allowed', false, 'reason', 'Table transfers are disabled by the manager.');
  end if;
  return jsonb_build_object('allowed', true, 'reason', null);
end;
$$;

revoke all on function public.update_waiter_pending_item_note(uuid, text) from public, anon;
revoke all on function public.get_waiter_item_notes(uuid) from public, anon;
revoke all on function public.get_waiter_transfer_policy(uuid) from public, anon;
revoke execute on function public.split_waiter_bill(uuid, uuid[]) from authenticated;
grant execute on function public.update_waiter_pending_item_note(uuid, text) to authenticated, service_role;
grant execute on function public.get_waiter_item_notes(uuid) to authenticated, service_role;
grant execute on function public.get_waiter_transfer_policy(uuid) to authenticated, service_role;
