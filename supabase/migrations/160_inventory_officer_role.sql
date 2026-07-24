-- Add the Inventory Officer staff role without changing inventory domain behavior.
-- Access remains scoped to the authenticated officer's active restaurant membership.

alter type public.user_role add value if not exists 'inventory_officer';
alter type public.restaurant_staff_role add value if not exists 'inventory_officer';

create or replace function public.staff_employee_prefix(target_role public.restaurant_staff_role)
returns text language sql immutable strict set search_path = public as $$
  select case target_role::text
    when 'waiter' then 'WT'
    when 'cashier' then 'CS'
    when 'kitchen' then 'KT'
    when 'manager' then 'MG'
    when 'reception' then 'RC'
    when 'inventory' then 'IN'
    when 'inventory_officer' then 'IO'
    else null
  end
$$;

create or replace function public.record_staff_login(target_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.restaurant_staff
  set last_login_at = now(),
      staff_session_active = true
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and active = true
    and role::text in ('owner', 'manager', 'cashier', 'kitchen', 'inventory', 'inventory_officer');

  if not found then
    raise exception 'Active staff membership not found for this restaurant.';
  end if;
end;
$$;

create or replace function public.record_staff_logout(target_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.restaurant_staff
  set staff_session_active = false,
      last_logout_at = now()
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and role::text in ('owner', 'manager', 'cashier', 'kitchen', 'inventory', 'inventory_officer');
end;
$$;

create or replace function public.inventory_admin_has_access(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_staff s
    where s.restaurant_id = target_restaurant_id
      and s.user_id = auth.uid()
      and s.active = true
      and s.role::text in ('owner', 'manager', 'inventory_officer')
  );
$$;

create or replace function public.inventory_admin_actor(target_restaurant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.restaurant_staff s
  where s.restaurant_id = target_restaurant_id
    and s.user_id = auth.uid()
    and s.active = true
    and s.role::text in ('owner', 'manager', 'inventory_officer')
  order by case s.role::text when 'owner' then 0 when 'manager' then 1 else 2 end
  limit 1;
$$;

-- Preserve the stock validation engine exactly while extending its actor allowlist.
create or replace function public.inventory_movement_validate_row()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  item_row public.inventory_items;
  unit_name_value text;
  expected_effect text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Inventory movements are immutable.';
  end if;

  if not public.inventory_admin_has_access(new.restaurant_id) then
    raise exception 'Inventory movement access denied.';
  end if;

  if new.quantity is null or new.quantity <= 0 then
    raise exception 'Movement quantity must be greater than zero.';
  end if;

  expected_effect := public.inventory_movement_expected_effect(new.movement_type);
  if expected_effect is not null and new.quantity_effect <> expected_effect then
    raise exception 'Movement direction is invalid for this movement type.';
  end if;
  if expected_effect is null and new.quantity_effect not in ('in','out') then
    raise exception 'Movement direction is required.';
  end if;

  if new.movement_type in ('transfer_in','transfer_out') and new.transfer_group_id is null then
    raise exception 'Transfer movements require a transfer group.';
  end if;
  if new.movement_type not in ('transfer_in','transfer_out') and new.transfer_group_id is not null then
    raise exception 'Only transfer movements can use a transfer group.';
  end if;

  if not public.inventory_movement_requirements_met(new.movement_type, new.reason) then
    raise exception 'Movement reason is required.';
  end if;

  select * into item_row
  from public.inventory_items
  where id = new.inventory_item_id
    and restaurant_id = new.restaurant_id
    and status = 'active';
  if item_row.id is null then
    raise exception 'Inventory item is invalid.';
  end if;

  if not exists (
    select 1 from public.inventory_storage_locations l
    where l.id = new.storage_location_id
      and l.restaurant_id = new.restaurant_id
      and l.status = 'active'
  ) then
    raise exception 'Storage location is invalid.';
  end if;

  select u.name into unit_name_value
  from public.inventory_units u
  where u.id = new.unit_id
    and u.restaurant_id = new.restaurant_id
    and u.status = 'active';
  if unit_name_value is null or item_row.unit_id is distinct from new.unit_id then
    raise exception 'Movement unit is invalid.';
  end if;

  if new.supplier_id is not null and not exists (
    select 1 from public.inventory_suppliers s
    where s.id = new.supplier_id
      and s.restaurant_id = new.restaurant_id
      and s.status = 'active'
  ) then
    raise exception 'Supplier is invalid.';
  end if;

  if new.quantity_effect = 'out'
    and public.get_inventory_storage_balance(new.restaurant_id, new.inventory_item_id, new.storage_location_id) < new.quantity
  then
    raise exception 'Movement would create negative stock.';
  end if;

  if new.created_by_staff_id is null then
    new.created_by_staff_id := public.inventory_admin_actor(new.restaurant_id);
  end if;
  if new.created_by_staff_id is null or not exists (
    select 1 from public.restaurant_staff s
    where s.id = new.created_by_staff_id
      and s.restaurant_id = new.restaurant_id
      and s.active = true
      and s.role::text in ('owner', 'manager', 'inventory_officer')
  ) then
    raise exception 'Movement user is invalid.';
  end if;

  new.unit_name := unit_name_value;
  new.reference_number := nullif(btrim(coalesce(new.reference_number, '')), '');
  new.invoice_number := nullif(btrim(coalesce(new.invoice_number, '')), '');
  new.reason := nullif(btrim(coalesce(new.reason, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  new.source_system := nullif(btrim(coalesce(new.source_system, '')), '');
  if new.source_system is null then
    new.source_system := 'manual';
  end if;
  new.source_payload := coalesce(new.source_payload, '{}'::jsonb);
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  new.created_at := now();
  return new;
end $$;

drop policy if exists restaurant_staff_update_manager_operational_same_restaurant on public.restaurant_staff;
create policy restaurant_staff_update_manager_operational_same_restaurant
on public.restaurant_staff
for update
to authenticated
using (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
  and role::text in ('waiter', 'cashier', 'kitchen', 'reception', 'inventory_officer')
)
with check (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
  and role::text in ('waiter', 'cashier', 'kitchen', 'reception', 'inventory_officer')
);

drop policy if exists restaurant_staff_delete_manager_operational_same_restaurant on public.restaurant_staff;
create policy restaurant_staff_delete_manager_operational_same_restaurant
on public.restaurant_staff
for delete
to authenticated
using (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
  and role::text in ('waiter', 'cashier', 'kitchen', 'reception', 'inventory_officer')
);

revoke all on function public.record_staff_login(uuid) from public, anon;
revoke all on function public.record_staff_logout(uuid) from public, anon;
revoke all on function public.inventory_admin_has_access(uuid) from public, anon;
revoke all on function public.inventory_admin_actor(uuid) from public, anon;
grant execute on function public.record_staff_login(uuid) to authenticated, service_role;
grant execute on function public.record_staff_logout(uuid) to authenticated, service_role;
grant execute on function public.inventory_admin_has_access(uuid) to authenticated, service_role;
grant execute on function public.inventory_admin_actor(uuid) to authenticated, service_role;
