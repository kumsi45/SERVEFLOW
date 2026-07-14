-- order_items has no updated_at column; notes are the only mutable field here.
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
  set notes = nullif(left(trim(coalesce(new_note, '')), 500), '')
  where id = target_item.id
  returning * into target_item;
  return target_item;
end;
$$;

revoke all on function public.update_waiter_pending_item_note(uuid, text) from public, anon;
grant execute on function public.update_waiter_pending_item_note(uuid, text) to authenticated, service_role;
