-- Manager review and inventory fulfillment remain one canonical kitchen request workflow.
-- This migration separates decision authority from fulfillment authority and preserves actors.

alter table public.kitchen_inventory_requests
  add column if not exists reviewed_by_staff_id uuid references public.restaurant_staff(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists fulfilled_by_staff_id uuid references public.restaurant_staff(id);

-- Backfill only attribution that the legacy row still proves. Delivered rows no
-- longer retain their original approver in processed_by_staff_id, so that actor
-- deliberately remains unknown rather than being reconstructed.
update public.kitchen_inventory_requests
set reviewed_by_staff_id=processed_by_staff_id,
    reviewed_at=coalesce(accepted_at,rejected_at)
where status in ('accepted','rejected')
  and processed_by_staff_id is not null
  and reviewed_by_staff_id is null;

update public.kitchen_inventory_requests
set fulfilled_by_staff_id=processed_by_staff_id
where status='delivered'
  and processed_by_staff_id is not null
  and fulfilled_by_staff_id is null;

drop policy if exists inventory_requests_read_workflow_staff on public.kitchen_inventory_requests;
create policy inventory_requests_read_workflow_staff
on public.kitchen_inventory_requests for select to authenticated
using (public.inventory_workflow_has_role(restaurant_id,array['owner','manager','kitchen','inventory','inventory_officer']));

drop policy if exists inventory_events_read_workflow_staff on public.inventory_request_events;
create policy inventory_events_read_workflow_staff
on public.inventory_request_events for select to authenticated
using (public.inventory_workflow_has_role(restaurant_id,array['owner','manager','kitchen','inventory','inventory_officer']));

create or replace function public.create_kitchen_inventory_request(
  target_restaurant_id uuid,
  target_item_name text,
  target_quantity numeric,
  target_unit text,
  target_urgency text,
  target_station_id uuid default null,
  target_comment text default null,
  target_inventory_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.restaurant_staff;
  catalog_name text;
  catalog_unit text;
  new_id uuid;
  normalized_name text:=btrim(coalesce(target_item_name,''));
  normalized_unit text:=btrim(coalesce(target_unit,''));
  normalized_comment text:=nullif(btrim(coalesce(target_comment,'')),'');
begin
  select * into actor
  from public.restaurant_staff
  where restaurant_id=target_restaurant_id
    and user_id=auth.uid()
    and active=true
    and role::text in ('kitchen','owner','manager')
  limit 1;
  if actor.id is null then raise exception 'Kitchen request access denied.'; end if;

  if target_inventory_item_id is not null then
    select i.name,coalesce(u.name,i.unit) into catalog_name,catalog_unit
    from public.inventory_items i
    left join public.inventory_units u on u.id=i.unit_id and u.restaurant_id=i.restaurant_id and u.status='active'
    where i.id=target_inventory_item_id
      and i.restaurant_id=target_restaurant_id
      and i.active=true
      and i.status='active';
    if catalog_name is null then raise exception 'Inventory item is invalid.'; end if;
    normalized_name:=catalog_name;
    normalized_unit:=catalog_unit;
  end if;

  if normalized_name='' or char_length(normalized_name)>120 then raise exception 'Item name is required.'; end if;
  if target_quantity is null or target_quantity<=0 then raise exception 'Quantity must be greater than zero.'; end if;
  if normalized_unit='' or char_length(normalized_unit)>24 then raise exception 'Unit is required.'; end if;
  if target_urgency not in ('normal','high','critical') then raise exception 'Urgency is invalid.'; end if;
  if normalized_comment is not null and char_length(normalized_comment)>500 then raise exception 'Request reason is too long.'; end if;
  if target_station_id is not null and not exists(
    select 1 from public.kitchen_stations where id=target_station_id and restaurant_id=target_restaurant_id
  ) then raise exception 'Station is invalid.'; end if;

  insert into public.kitchen_inventory_requests(
    restaurant_id,inventory_item_id,station_id,requested_by_staff_id,item_name,quantity,unit,urgency,comment
  ) values (
    target_restaurant_id,target_inventory_item_id,target_station_id,actor.id,normalized_name,target_quantity,normalized_unit,target_urgency,normalized_comment
  ) returning id into new_id;

  insert into public.inventory_request_events(
    restaurant_id,request_id,actor_staff_id,event_type,to_status,details
  ) values (
    target_restaurant_id,new_id,actor.id,'created','pending',
    jsonb_build_object('item_name',normalized_name,'quantity',target_quantity,'unit',normalized_unit,'urgency',target_urgency,'station_id',target_station_id,'reason',normalized_comment)
  );
  return new_id;
end
$$;

create or replace function public.process_kitchen_inventory_request(
  target_restaurant_id uuid,
  target_request_id uuid,
  target_action text,
  target_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.restaurant_staff;
  req public.kitchen_inventory_requests;
  next_status text;
  now_at timestamptz:=now();
  normalized_reason text:=nullif(btrim(coalesce(target_rejection_reason,'')),'');
  stock_location_id uuid;
begin
  select * into actor
  from public.restaurant_staff
  where restaurant_id=target_restaurant_id
    and user_id=auth.uid()
    and active=true
    and (
      (target_action in ('accept','reject') and role::text in ('manager','owner'))
      or (target_action='deliver' and role::text in ('inventory_officer','owner'))
    )
  order by case role::text when 'owner' then 0 when 'manager' then 1 when 'inventory_officer' then 2 else 3 end
  limit 1;

  if actor.id is null then
    if target_action in ('accept','reject') then raise exception 'Manager request review access denied.'; end if;
    if target_action='deliver' then raise exception 'Inventory fulfillment access denied.'; end if;
    raise exception 'Invalid request action.';
  end if;

  select * into req
  from public.kitchen_inventory_requests
  where id=target_request_id and restaurant_id=target_restaurant_id
  for update;

  if req.id is null then raise exception 'Request not found.'; end if;

  if target_action='accept' and req.status='pending' then next_status:='accepted';
  elsif target_action='reject' and req.status='pending' then next_status:='rejected';
  elsif target_action='deliver' and req.status='accepted' then next_status:='delivered';
  else raise exception 'Request was already handled or is not available for this action.';
  end if;

  if next_status='rejected' and normalized_reason is null then
    raise exception 'Rejection reason is required.';
  end if;

  update public.kitchen_inventory_requests
  set status=next_status,
      processed_by_staff_id=actor.id,
      reviewed_by_staff_id=case when next_status in ('accepted','rejected') then actor.id else reviewed_by_staff_id end,
      reviewed_at=case when next_status in ('accepted','rejected') then now_at else reviewed_at end,
      fulfilled_by_staff_id=case when next_status='delivered' then actor.id else fulfilled_by_staff_id end,
      accepted_at=case when next_status='accepted' then now_at else accepted_at end,
      rejected_at=case when next_status='rejected' then now_at else rejected_at end,
      delivered_at=case when next_status='delivered' then now_at else delivered_at end,
      rejection_reason=case when next_status='rejected' then normalized_reason else rejection_reason end,
      updated_at=now_at
  where id=req.id;

  if next_status='delivered' then
    if req.inventory_item_id is null then raise exception 'Inventory link is required before fulfillment.'; end if;
    select storage_location_id into stock_location_id
    from public.inventory_items
    where id=req.inventory_item_id and restaurant_id=target_restaurant_id and status='active';
    if stock_location_id is null then raise exception 'Inventory storage location is required before fulfillment.'; end if;
    perform public.record_inventory_movement(
      target_restaurant_id,
      req.inventory_item_id,
      stock_location_id,
      'stock_out'::public.inventory_movement_type,
      req.quantity,
      'out',
      null,
      'KITCHEN-REQUEST-'||req.id::text,
      null,
      'Kitchen material request fulfillment',
      'Fulfilled from kitchen material request '||req.id::text,
      now_at
    );
  end if;

  insert into public.inventory_request_events(
    restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,details
  ) values (
    target_restaurant_id,req.id,actor.id,next_status,req.status,next_status,
    jsonb_build_object(
      'rejection_reason',case when next_status='rejected' then normalized_reason else null end,
      'reviewed_by_staff_id',case when next_status in ('accepted','rejected') then actor.id else null end,
      'fulfilled_by_staff_id',case when next_status='delivered' then actor.id else null end
    )
  );
end
$$;

revoke all on function public.process_kitchen_inventory_request(uuid,uuid,text,text) from public,anon;
revoke all on function public.create_kitchen_inventory_request(uuid,text,numeric,text,text,uuid,text,uuid) from public,anon;
grant execute on function public.process_kitchen_inventory_request(uuid,uuid,text,text) to authenticated,service_role;
grant execute on function public.create_kitchen_inventory_request(uuid,text,numeric,text,text,uuid,text,uuid) to authenticated,service_role;
