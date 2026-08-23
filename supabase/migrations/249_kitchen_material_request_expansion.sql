-- Expand the canonical Kitchen material request workflow beyond catalog ingredients.
-- The lifecycle, tenant boundaries, event history, and stock movement authority remain unchanged.

alter table public.kitchen_inventory_requests
  add column if not exists request_type text;

-- Existing linked requests are factual inventory/ingredient requests. Historical unlinked rows
-- cannot be proven to be ingredients, so preserve them under the generic material type.
update public.kitchen_inventory_requests
set request_type=case when inventory_item_id is null then 'other' else 'ingredient' end
where request_type is null;

alter table public.kitchen_inventory_requests
  alter column request_type set default 'ingredient',
  alter column request_type set not null;

alter table public.kitchen_inventory_requests
  drop constraint if exists kitchen_inventory_requests_request_type_check;
alter table public.kitchen_inventory_requests
  add constraint kitchen_inventory_requests_request_type_check
  check (request_type in ('ingredient','supply','tool','cleaning','other'));

alter table public.kitchen_inventory_requests
  drop constraint if exists kitchen_inventory_requests_ingredient_item_check;
alter table public.kitchen_inventory_requests
  add constraint kitchen_inventory_requests_ingredient_item_check
  check (request_type<>'ingredient' or inventory_item_id is not null);

-- Replace the deployed eight-argument signature with one backward-compatible canonical RPC.
-- When the new argument is omitted, linked requests infer ingredient and unlinked requests infer other.
drop function if exists public.create_kitchen_inventory_request(uuid,text,numeric,text,text,uuid,text,uuid);
create function public.create_kitchen_inventory_request(
  target_restaurant_id uuid,
  target_item_name text,
  target_quantity numeric,
  target_unit text,
  target_urgency text,
  target_station_id uuid default null,
  target_comment text default null,
  target_inventory_item_id uuid default null,
  target_request_type text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  actor public.restaurant_staff;
  catalog_name text;
  catalog_unit text;
  canonical_free_text_unit text;
  new_id uuid;
  normalized_name text:=btrim(coalesce(target_item_name,''));
  normalized_unit text:=btrim(coalesce(target_unit,''));
  normalized_comment text:=nullif(btrim(coalesce(target_comment,'')),'');
  normalized_type text:=lower(btrim(coalesce(target_request_type,
    case when target_inventory_item_id is null then 'other' else 'ingredient' end)));
begin
  select * into actor from public.restaurant_staff
  where restaurant_id=target_restaurant_id and user_id=auth.uid() and active=true
    and role::text in ('kitchen','owner','manager')
  order by case role::text when 'owner' then 0 when 'manager' then 1 else 2 end limit 1;
  if actor.id is null then raise exception 'Kitchen request access denied.'; end if;

  if normalized_type not in ('ingredient','supply','tool','cleaning','other') then
    raise exception 'Request type is invalid.';
  end if;
  if normalized_type='ingredient' and target_inventory_item_id is null then
    raise exception 'Inventory item is required for an ingredient request.';
  end if;

  if target_inventory_item_id is not null then
    select item.name,coalesce(inventory_unit.name,item.unit) into catalog_name,catalog_unit
    from public.inventory_items item
    left join public.inventory_units inventory_unit
      on inventory_unit.id=item.unit_id and inventory_unit.restaurant_id=item.restaurant_id
      and inventory_unit.status='active'
    where item.id=target_inventory_item_id and item.restaurant_id=target_restaurant_id
      and item.active=true and item.status='active';
    if catalog_name is null then raise exception 'Inventory item is invalid.'; end if;
    normalized_name:=catalog_name;
    normalized_unit:=catalog_unit;
  else
    -- Prefer the tenant's canonical spelling when a matching active unit exists. A concise
    -- free-text representation remains valid for materials not yet modeled in Inventory.
    select inventory_unit.name into canonical_free_text_unit
    from public.inventory_units inventory_unit
    where inventory_unit.restaurant_id=target_restaurant_id and inventory_unit.status='active'
      and lower(btrim(inventory_unit.name))=lower(normalized_unit)
    limit 1;
    normalized_unit:=coalesce(canonical_free_text_unit,normalized_unit);
  end if;

  if normalized_name='' or char_length(normalized_name)>120 then raise exception 'Item name is required.'; end if;
  if target_quantity is null or target_quantity<=0 then raise exception 'Quantity must be greater than zero.'; end if;
  if normalized_unit='' or char_length(normalized_unit)>24 then raise exception 'Unit is required.'; end if;
  if target_urgency not in ('normal','high','critical') then raise exception 'Urgency is invalid.'; end if;
  if normalized_comment is not null and char_length(normalized_comment)>500 then raise exception 'Request reason is too long.'; end if;
  if target_station_id is not null and not exists(
    select 1 from public.kitchen_stations station
    where station.id=target_station_id and station.restaurant_id=target_restaurant_id
  ) then raise exception 'Station is invalid.'; end if;

  insert into public.kitchen_inventory_requests(
    restaurant_id,request_type,inventory_item_id,station_id,requested_by_staff_id,
    item_name,quantity,unit,urgency,comment
  ) values (
    target_restaurant_id,normalized_type,target_inventory_item_id,target_station_id,actor.id,
    normalized_name,target_quantity,normalized_unit,target_urgency,normalized_comment
  ) returning id into new_id;

  insert into public.inventory_request_events(
    restaurant_id,request_id,actor_staff_id,event_type,to_status,details
  ) values (
    target_restaurant_id,new_id,actor.id,'created','pending',jsonb_build_object(
      'request_type',normalized_type,'item_name',normalized_name,
      'inventory_item_id',target_inventory_item_id,'quantity',target_quantity,
      'unit',normalized_unit,'urgency',target_urgency,'station_id',target_station_id
    )
  );
  return new_id;
end $$;

-- Manager review is generic. Approval never creates an inventory movement.
create or replace function public.process_kitchen_inventory_request(
  target_restaurant_id uuid,target_request_id uuid,target_action text,
  target_rejection_reason text default null
)
returns void language plpgsql security definer set search_path=public as $$
declare
  actor public.restaurant_staff;
  request public.kitchen_inventory_requests;
  next_status text;
  now_at timestamptz:=now();
  normalized_reason text:=nullif(btrim(coalesce(target_rejection_reason,'')),'');
begin
  if target_action in ('issue','deliver') then
    perform public.issue_kitchen_inventory_request(target_restaurant_id,target_request_id);
    return;
  end if;
  if target_action not in ('accept','reject') then raise exception 'Invalid request action.'; end if;

  select * into actor from public.restaurant_staff
  where restaurant_id=target_restaurant_id and user_id=auth.uid() and active=true
    and role::text in ('manager','owner')
  order by case role::text when 'owner' then 0 else 1 end limit 1;
  if actor.id is null then raise exception 'Manager request review access denied.'; end if;

  select * into request from public.kitchen_inventory_requests
  where id=target_request_id and restaurant_id=target_restaurant_id for update;
  if request.id is null then raise exception 'Request not found.'; end if;
  if request.status<>'pending' then raise exception 'Request was already handled or is not available for this action.'; end if;

  if target_action='accept' then
    if request.request_type='ingredient' and request.inventory_item_id is null then
      raise exception 'Inventory item is required for an ingredient request.';
    end if;
    if request.inventory_item_id is not null and not exists(
      select 1 from public.inventory_items item where item.id=request.inventory_item_id
        and item.restaurant_id=target_restaurant_id and item.active=true and item.status='active'
    ) then raise exception 'Inventory item is invalid.'; end if;
    if request.station_id is not null and not exists(
      select 1 from public.kitchen_stations station where station.id=request.station_id
        and station.restaurant_id=target_restaurant_id
    ) then raise exception 'Station is invalid.'; end if;
    next_status:='accepted';
  else
    if normalized_reason is null then raise exception 'Rejection reason is required.'; end if;
    next_status:='rejected';
  end if;

  update public.kitchen_inventory_requests set
    status=next_status,processed_by_staff_id=actor.id,reviewed_by_staff_id=actor.id,
    reviewed_at=now_at,
    accepted_at=case when next_status='accepted' then now_at else accepted_at end,
    rejected_at=case when next_status='rejected' then now_at else rejected_at end,
    rejection_reason=case when next_status='rejected' then normalized_reason else rejection_reason end,
    updated_at=now_at
  where id=request.id and restaurant_id=target_restaurant_id;

  insert into public.inventory_request_events(
    restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,details
  ) values (
    target_restaurant_id,request.id,actor.id,next_status,request.status,next_status,
    jsonb_build_object('request_type',request.request_type,'item_name',request.item_name,
      'inventory_item_id',request.inventory_item_id,
      'rejection_reason',case when next_status='rejected' then normalized_reason else null end,
      'reviewed_by_staff_id',actor.id)
  );
end $$;

drop function if exists public.get_inventory_kitchen_request_queue(uuid);
create function public.get_inventory_kitchen_request_queue(target_restaurant_id uuid)
returns table(
  request_id uuid,restaurant_id uuid,request_type text,inventory_item_id uuid,item_name text,
  requested_quantity numeric,unit text,station_id uuid,station_name text,
  requested_by_staff_id uuid,requested_by_name text,requested_at timestamptz,
  priority text,reason text,approved_by_staff_id uuid,approved_by_name text,
  approved_at timestamptz,request_status text,current_quantity numeric,reorder_level numeric
)
language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(
    select 1 from public.restaurant_staff staff where staff.restaurant_id=target_restaurant_id
      and staff.user_id=auth.uid() and staff.active=true
      and staff.role::text in ('inventory_officer','owner')
  ) then raise exception 'Inventory queue access denied.'; end if;

  return query
  select request.id,request.restaurant_id,request.request_type,request.inventory_item_id,
    request.item_name,request.quantity,request.unit,request.station_id,station.name,
    requester.id,requester.display_name,request.requested_at,request.urgency,request.comment,
    reviewer.id,reviewer.display_name,request.reviewed_at,request.status,
    case when item.id is null then null else coalesce((
      select sum(public.inventory_movement_signed_quantity(movement.quantity,movement.quantity_effect))
      from public.inventory_movements movement
      where movement.restaurant_id=request.restaurant_id
        and movement.inventory_item_id=item.id
        and movement.storage_location_id=item.storage_location_id
    ),0)::numeric(12,3) end,
    item.minimum_stock
  from public.kitchen_inventory_requests request
  left join public.inventory_items item on item.id=request.inventory_item_id
    and item.restaurant_id=request.restaurant_id and item.status='active' and item.active=true
  left join public.kitchen_stations station on station.id=request.station_id
    and station.restaurant_id=request.restaurant_id
  join public.restaurant_staff requester on requester.id=request.requested_by_staff_id
    and requester.restaurant_id=request.restaurant_id
  join public.restaurant_staff reviewer on reviewer.id=request.reviewed_by_staff_id
    and reviewer.restaurant_id=request.restaurant_id
  where request.restaurant_id=target_restaurant_id and request.status='accepted'
  order by case request.urgency when 'critical' then 0 when 'high' then 1 else 2 end,
    request.reviewed_at,request.requested_at;
end $$;

revoke all on function public.create_kitchen_inventory_request(uuid,text,numeric,text,text,uuid,text,uuid,text)
  from public,anon,authenticated;
revoke all on function public.process_kitchen_inventory_request(uuid,uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.get_inventory_kitchen_request_queue(uuid)
  from public,anon,authenticated;
grant execute on function public.create_kitchen_inventory_request(uuid,text,numeric,text,text,uuid,text,uuid,text)
  to authenticated,service_role;
grant execute on function public.process_kitchen_inventory_request(uuid,uuid,text,text)
  to authenticated,service_role;
grant execute on function public.get_inventory_kitchen_request_queue(uuid)
  to authenticated,service_role;

comment on column public.kitchen_inventory_requests.request_type is
  'Canonical material category: ingredient, supply, tool, cleaning, or other.';
comment on function public.create_kitchen_inventory_request(uuid,text,numeric,text,text,uuid,text,uuid,text) is
  'Creates a tenant-scoped inventory-backed or free-text Kitchen material request on the canonical lifecycle.';
comment on function public.get_inventory_kitchen_request_queue(uuid) is
  'Same-tenant Inventory Officer queue of all Manager-approved Kitchen material requests, including non-stock materials.';
