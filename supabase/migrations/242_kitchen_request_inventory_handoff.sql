-- Canonical Kitchen request -> Manager approval -> Inventory issue -> Kitchen receipt lifecycle.
-- Manager approval remains authorization-only. Stock changes only through the immutable movement ledger.

alter table public.kitchen_inventory_requests
  add column if not exists issued_by_staff_id uuid,
  add column if not exists issued_at timestamptz,
  add column if not exists issued_quantity numeric(12,3),
  add column if not exists inventory_movement_id uuid references public.inventory_movements(id),
  add column if not exists confirmed_by_staff_id uuid,
  add column if not exists confirmed_at timestamptz,
  add column if not exists unable_to_fulfill_by_staff_id uuid,
  add column if not exists unable_to_fulfill_at timestamptz,
  add column if not exists unable_to_fulfill_reason text;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='kitchen_inventory_requests_issued_quantity_check') then
    alter table public.kitchen_inventory_requests add constraint kitchen_inventory_requests_issued_quantity_check
      check (issued_quantity is null or issued_quantity > 0);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_inventory_requests_unable_reason_check') then
    alter table public.kitchen_inventory_requests add constraint kitchen_inventory_requests_unable_reason_check
      check (unable_to_fulfill_reason is null or char_length(btrim(unable_to_fulfill_reason)) between 1 and 500);
  end if;
end $$;

alter table public.kitchen_inventory_requests drop constraint if exists kitchen_inventory_requests_status_check;
alter table public.kitchen_inventory_requests add constraint kitchen_inventory_requests_status_check
  check (status in ('pending','accepted','rejected','issued','unable_to_fulfill','delivered'));

alter table public.inventory_request_events drop constraint if exists inventory_request_events_event_type_check;
alter table public.inventory_request_events add constraint inventory_request_events_event_type_check
  check (event_type in ('created','accepted','rejected','issued','unable_to_fulfill','confirmed','delivered'));

create unique index if not exists kitchen_inventory_requests_restaurant_id_id_unique
  on public.kitchen_inventory_requests(restaurant_id,id);
create unique index if not exists inventory_request_events_restaurant_id_id_unique
  on public.inventory_request_events(restaurant_id,id);
create unique index if not exists inventory_movements_restaurant_id_id_unique
  on public.inventory_movements(restaurant_id,id);
create unique index if not exists kitchen_inventory_requests_movement_unique
  on public.kitchen_inventory_requests(restaurant_id,inventory_movement_id)
  where inventory_movement_id is not null;

-- Database-level tenant provenance complements the RPC checks and prevents orphaned cross-tenant links.
do $$ begin
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_inventory_item_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_inventory_item_restaurant_fk
      foreign key(restaurant_id,inventory_item_id) references public.inventory_items(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_station_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_station_restaurant_fk
      foreign key(restaurant_id,station_id) references public.kitchen_stations(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_requester_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_requester_restaurant_fk
      foreign key(restaurant_id,requested_by_staff_id) references public.restaurant_staff(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_processor_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_processor_restaurant_fk
      foreign key(restaurant_id,processed_by_staff_id) references public.restaurant_staff(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_reviewer_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_reviewer_restaurant_fk
      foreign key(restaurant_id,reviewed_by_staff_id) references public.restaurant_staff(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_fulfiller_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_fulfiller_restaurant_fk
      foreign key(restaurant_id,fulfilled_by_staff_id) references public.restaurant_staff(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_issuer_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_issuer_restaurant_fk
      foreign key(restaurant_id,issued_by_staff_id) references public.restaurant_staff(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_confirmer_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_confirmer_restaurant_fk
      foreign key(restaurant_id,confirmed_by_staff_id) references public.restaurant_staff(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_unable_actor_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_unable_actor_restaurant_fk
      foreign key(restaurant_id,unable_to_fulfill_by_staff_id) references public.restaurant_staff(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='kitchen_requests_movement_restaurant_fk') then
    alter table public.kitchen_inventory_requests add constraint kitchen_requests_movement_restaurant_fk
      foreign key(restaurant_id,inventory_movement_id) references public.inventory_movements(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='inventory_request_events_request_restaurant_fk') then
    alter table public.inventory_request_events add constraint inventory_request_events_request_restaurant_fk
      foreign key(restaurant_id,request_id) references public.kitchen_inventory_requests(restaurant_id,id);
  end if;
  if not exists(select 1 from pg_constraint where conname='inventory_request_events_actor_restaurant_fk') then
    alter table public.inventory_request_events add constraint inventory_request_events_actor_restaurant_fk
      foreign key(restaurant_id,actor_staff_id) references public.restaurant_staff(restaurant_id,id);
  end if;
end $$;

-- Inventory Officers may read only approved and downstream requests. Managers/Owners/Kitchen retain
-- their existing same-tenant visibility. There are still no direct mutation policies.
drop policy if exists inventory_requests_read_workflow_staff on public.kitchen_inventory_requests;
create policy inventory_requests_read_workflow_staff
on public.kitchen_inventory_requests for select to authenticated
using (
  public.inventory_workflow_has_role(restaurant_id,array['owner','manager','kitchen'])
  or (
    public.inventory_workflow_has_role(restaurant_id,array['inventory','inventory_officer'])
    and status in ('accepted','issued','unable_to_fulfill','delivered')
  )
);

drop policy if exists inventory_events_read_workflow_staff on public.inventory_request_events;
create policy inventory_events_read_workflow_staff
on public.inventory_request_events for select to authenticated
using (
  public.inventory_workflow_has_role(restaurant_id,array['owner','manager','kitchen'])
  or (
    public.inventory_workflow_has_role(restaurant_id,array['inventory','inventory_officer'])
    and exists(
      select 1 from public.kitchen_inventory_requests request
      where request.restaurant_id=inventory_request_events.restaurant_id
        and request.id=inventory_request_events.request_id
        and request.status in ('accepted','issued','unable_to_fulfill','delivered')
    )
  )
);

revoke insert,update,delete on public.kitchen_inventory_requests from authenticated;
revoke insert,update,delete on public.inventory_request_events from authenticated;

-- Manager review remains authorization-only. It deliberately contains no inventory movement call.
create or replace function public.process_kitchen_inventory_request(
  target_restaurant_id uuid,
  target_request_id uuid,
  target_action text,
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
  -- Backward-compatible alias delegates legacy Inventory "deliver" callers to the issue step.
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
    if request.inventory_item_id is null then raise exception 'Inventory link is required before approval.'; end if;
    if not exists(select 1 from public.inventory_items item where item.id=request.inventory_item_id and item.restaurant_id=target_restaurant_id and item.active=true and item.status='active') then
      raise exception 'Inventory item is invalid.';
    end if;
    if request.station_id is not null and not exists(select 1 from public.kitchen_stations station where station.id=request.station_id and station.restaurant_id=target_restaurant_id) then
      raise exception 'Station is invalid.';
    end if;
    next_status:='accepted';
  else
    if normalized_reason is null then raise exception 'Rejection reason is required.'; end if;
    next_status:='rejected';
  end if;

  update public.kitchen_inventory_requests set
    status=next_status, processed_by_staff_id=actor.id, reviewed_by_staff_id=actor.id,
    reviewed_at=now_at,
    accepted_at=case when next_status='accepted' then now_at else accepted_at end,
    rejected_at=case when next_status='rejected' then now_at else rejected_at end,
    rejection_reason=case when next_status='rejected' then normalized_reason else rejection_reason end,
    updated_at=now_at
  where id=request.id and restaurant_id=target_restaurant_id;

  insert into public.inventory_request_events(restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,details)
  values(target_restaurant_id,request.id,actor.id,next_status,request.status,next_status,
    jsonb_build_object('rejection_reason',case when next_status='rejected' then normalized_reason else null end,'reviewed_by_staff_id',actor.id));
end $$;

create or replace function public.get_inventory_kitchen_request_queue(target_restaurant_id uuid)
returns table(
  request_id uuid, restaurant_id uuid, inventory_item_id uuid, item_name text,
  requested_quantity numeric, unit text, station_id uuid, station_name text,
  requested_by_staff_id uuid, requested_by_name text, requested_at timestamptz,
  priority text, reason text, approved_by_staff_id uuid, approved_by_name text,
  approved_at timestamptz, request_status text, current_quantity numeric, reorder_level numeric
)
language plpgsql stable security definer set search_path=public as $$
begin
  if not exists(select 1 from public.restaurant_staff staff where staff.restaurant_id=target_restaurant_id
    and staff.user_id=auth.uid() and staff.active=true and staff.role::text in ('inventory_officer','owner')) then
    raise exception 'Inventory queue access denied.';
  end if;

  return query
  select request.id,request.restaurant_id,request.inventory_item_id,item.name,
    request.quantity,request.unit,request.station_id,station.name,
    requester.id,requester.display_name,request.requested_at,
    request.urgency,request.comment,reviewer.id,reviewer.display_name,
    request.reviewed_at,request.status,
    coalesce((select sum(public.inventory_movement_signed_quantity(movement.quantity,movement.quantity_effect))
      from public.inventory_movements movement where movement.restaurant_id=request.restaurant_id
        and movement.inventory_item_id=item.id and movement.storage_location_id=item.storage_location_id),0)::numeric(12,3),
    item.minimum_stock
  from public.kitchen_inventory_requests request
  join public.inventory_items item on item.id=request.inventory_item_id and item.restaurant_id=request.restaurant_id and item.status='active'
  left join public.kitchen_stations station on station.id=request.station_id and station.restaurant_id=request.restaurant_id
  join public.restaurant_staff requester on requester.id=request.requested_by_staff_id and requester.restaurant_id=request.restaurant_id
  join public.restaurant_staff reviewer on reviewer.id=request.reviewed_by_staff_id and reviewer.restaurant_id=request.restaurant_id
  where request.restaurant_id=target_restaurant_id and request.status='accepted'
  order by case request.urgency when 'critical' then 0 when 'high' then 1 else 2 end,request.reviewed_at,request.requested_at;
end $$;

create or replace function public.issue_kitchen_inventory_request(target_restaurant_id uuid,target_request_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  actor public.restaurant_staff;
  request public.kitchen_inventory_requests;
  item public.inventory_items;
  catalog_unit text;
  available_quantity numeric;
  movement_id uuid;
  now_at timestamptz:=now();
begin
  select * into actor from public.restaurant_staff where restaurant_id=target_restaurant_id
    and user_id=auth.uid() and active=true and role::text in ('inventory_officer','owner')
  order by case role::text when 'owner' then 0 else 1 end limit 1;
  if actor.id is null then raise exception 'Inventory issue access denied.'; end if;

  select * into request from public.kitchen_inventory_requests
  where id=target_request_id and restaurant_id=target_restaurant_id for update;
  if request.id is null then raise exception 'Request not found.'; end if;
  if request.status<>'accepted' then raise exception 'Request was already issued or is not awaiting Inventory.'; end if;
  if request.inventory_item_id is null then raise exception 'Inventory link is required before issue.'; end if;

  select * into item from public.inventory_items where id=request.inventory_item_id
    and restaurant_id=target_restaurant_id and active=true and status='active' for update;
  if item.id is null then raise exception 'Inventory item is invalid.'; end if;
  if item.storage_location_id is null or not exists(select 1 from public.inventory_storage_locations location
    where location.id=item.storage_location_id and location.restaurant_id=target_restaurant_id and location.status='active') then
    raise exception 'Inventory storage location is required before issue.';
  end if;
  select inventory_unit.name into catalog_unit from public.inventory_units inventory_unit
    where inventory_unit.id=item.unit_id and inventory_unit.restaurant_id=target_restaurant_id and inventory_unit.status='active';
  if catalog_unit is null or lower(btrim(catalog_unit))<>lower(btrim(request.unit)) then raise exception 'Request unit does not match the inventory item unit.'; end if;
  if request.quantity is null or request.quantity<=0 then raise exception 'Request quantity is invalid.'; end if;

  available_quantity:=public.get_inventory_storage_balance(target_restaurant_id,item.id,item.storage_location_id);
  if available_quantity<request.quantity then raise exception 'Insufficient stock for full issue.'; end if;

  movement_id:=public.record_inventory_movement(
    target_restaurant_id,item.id,item.storage_location_id,'stock_out'::public.inventory_movement_type,
    request.quantity,'out',null,'KITCHEN-REQUEST-'||request.id::text,null,
    'Kitchen material request issue','Issued for kitchen material request '||request.id::text,now_at
  );

  update public.kitchen_inventory_requests set
    status='issued',processed_by_staff_id=actor.id,fulfilled_by_staff_id=actor.id,
    issued_by_staff_id=actor.id,issued_at=now_at,issued_quantity=request.quantity,
    inventory_movement_id=movement_id,updated_at=now_at
  where id=request.id and restaurant_id=target_restaurant_id;

  insert into public.inventory_request_events(restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,details)
  values(target_restaurant_id,request.id,actor.id,'issued',request.status,'issued',
    jsonb_build_object('issued_quantity',request.quantity,'unit',request.unit,'inventory_movement_id',movement_id,'issued_by_staff_id',actor.id));
  return movement_id;
end $$;

create or replace function public.mark_kitchen_inventory_request_unable_to_fulfill(
  target_restaurant_id uuid,target_request_id uuid,target_reason text
)
returns void language plpgsql security definer set search_path=public as $$
declare
  actor public.restaurant_staff;
  request public.kitchen_inventory_requests;
  normalized_reason text:=nullif(btrim(coalesce(target_reason,'')),'');
  now_at timestamptz:=now();
begin
  select * into actor from public.restaurant_staff where restaurant_id=target_restaurant_id
    and user_id=auth.uid() and active=true and role::text in ('inventory_officer','owner')
  order by case role::text when 'owner' then 0 else 1 end limit 1;
  if actor.id is null then raise exception 'Inventory issue access denied.'; end if;
  if normalized_reason is null then raise exception 'Unable to fulfill reason is required.'; end if;
  if char_length(normalized_reason)>500 then raise exception 'Unable to fulfill reason is too long.'; end if;

  select * into request from public.kitchen_inventory_requests
  where id=target_request_id and restaurant_id=target_restaurant_id for update;
  if request.id is null then raise exception 'Request not found.'; end if;
  if request.status<>'accepted' then raise exception 'Request is not awaiting Inventory.'; end if;

  update public.kitchen_inventory_requests set status='unable_to_fulfill',processed_by_staff_id=actor.id,
    unable_to_fulfill_by_staff_id=actor.id,unable_to_fulfill_at=now_at,
    unable_to_fulfill_reason=normalized_reason,updated_at=now_at
  where id=request.id and restaurant_id=target_restaurant_id;

  insert into public.inventory_request_events(restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,details)
  values(target_restaurant_id,request.id,actor.id,'unable_to_fulfill',request.status,'unable_to_fulfill',
    jsonb_build_object('reason',normalized_reason,'unable_to_fulfill_by_staff_id',actor.id));
end $$;

create or replace function public.confirm_kitchen_inventory_request_receipt(target_restaurant_id uuid,target_request_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  actor public.restaurant_staff;
  request public.kitchen_inventory_requests;
  now_at timestamptz:=now();
begin
  select * into actor from public.restaurant_staff where restaurant_id=target_restaurant_id
    and user_id=auth.uid() and active=true and role::text in ('kitchen','owner')
  order by case role::text when 'owner' then 0 else 1 end limit 1;
  if actor.id is null then raise exception 'Kitchen receipt confirmation access denied.'; end if;

  select * into request from public.kitchen_inventory_requests
  where id=target_request_id and restaurant_id=target_restaurant_id for update;
  if request.id is null then raise exception 'Request not found.'; end if;
  if request.status<>'issued' then raise exception 'Request was already confirmed or is not awaiting Kitchen confirmation.'; end if;
  if request.inventory_movement_id is null or request.issued_by_staff_id is null or request.issued_at is null then
    raise exception 'Issued request provenance is incomplete.';
  end if;
  if not exists(select 1 from public.inventory_movements movement where movement.id=request.inventory_movement_id
    and movement.restaurant_id=target_restaurant_id and movement.inventory_item_id=request.inventory_item_id
    and movement.movement_type='stock_out' and movement.quantity=request.issued_quantity) then
    raise exception 'Issued inventory movement is invalid.';
  end if;

  update public.kitchen_inventory_requests set status='delivered',confirmed_by_staff_id=actor.id,
    confirmed_at=now_at,delivered_at=now_at,updated_at=now_at
  where id=request.id and restaurant_id=target_restaurant_id;

  insert into public.inventory_request_events(restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,details)
  values(target_restaurant_id,request.id,actor.id,'confirmed',request.status,'delivered',
    jsonb_build_object('confirmed_by_staff_id',actor.id,'inventory_movement_id',request.inventory_movement_id));
end $$;

revoke all on function public.process_kitchen_inventory_request(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.get_inventory_kitchen_request_queue(uuid) from public,anon,authenticated;
revoke all on function public.issue_kitchen_inventory_request(uuid,uuid) from public,anon,authenticated;
revoke all on function public.mark_kitchen_inventory_request_unable_to_fulfill(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.confirm_kitchen_inventory_request_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.process_kitchen_inventory_request(uuid,uuid,text,text) to authenticated,service_role;
grant execute on function public.get_inventory_kitchen_request_queue(uuid) to authenticated,service_role;
grant execute on function public.issue_kitchen_inventory_request(uuid,uuid) to authenticated,service_role;
grant execute on function public.mark_kitchen_inventory_request_unable_to_fulfill(uuid,uuid,text) to authenticated,service_role;
grant execute on function public.confirm_kitchen_inventory_request_receipt(uuid,uuid) to authenticated,service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='kitchen_inventory_requests')
  then alter publication supabase_realtime add table public.kitchen_inventory_requests; end if;
end $$;

comment on function public.get_inventory_kitchen_request_queue(uuid) is
  'Same-tenant Inventory Officer queue containing only Manager-approved kitchen material requests.';
comment on function public.issue_kitchen_inventory_request(uuid,uuid) is
  'Atomically records one full stock-out movement and transitions an approved request to issued awaiting Kitchen confirmation.';
comment on function public.confirm_kitchen_inventory_request_receipt(uuid,uuid) is
  'Confirms Kitchen receipt without changing stock and finalizes the request as delivered.';
