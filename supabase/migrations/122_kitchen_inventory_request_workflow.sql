-- Structured kitchen-to-inventory request workflow.
alter type public.restaurant_staff_role add value if not exists 'inventory';

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  unit text not null,
  current_quantity numeric(12,3) not null default 0 check (current_quantity >= 0),
  reorder_level numeric(12,3) not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, name, unit)
);

create table if not exists public.kitchen_inventory_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  station_id uuid references public.kitchen_stations(id) on delete set null,
  requested_by_staff_id uuid not null references public.restaurant_staff(id),
  processed_by_staff_id uuid references public.restaurant_staff(id),
  item_name text not null check (char_length(btrim(item_name)) between 1 and 120),
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null check (char_length(btrim(unit)) between 1 and 24),
  urgency text not null default 'normal' check (urgency in ('normal','high','critical')),
  comment text check (comment is null or char_length(comment) <= 500),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','delivered')),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  rejected_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_request_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  request_id uuid not null references public.kitchen_inventory_requests(id) on delete cascade,
  actor_staff_id uuid not null references public.restaurant_staff(id),
  event_type text not null check (event_type in ('created','accepted','rejected','delivered')),
  from_status text,
  to_status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kitchen_inventory_requests_restaurant_status_idx on public.kitchen_inventory_requests(restaurant_id,status,requested_at desc);
create index if not exists inventory_request_events_request_idx on public.inventory_request_events(request_id,created_at);
create index if not exists inventory_items_restaurant_stock_idx on public.inventory_items(restaurant_id,active,current_quantity,reorder_level);

alter table public.inventory_items enable row level security;
alter table public.kitchen_inventory_requests enable row level security;
alter table public.inventory_request_events enable row level security;

create or replace function public.inventory_workflow_has_role(target_restaurant_id uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.restaurant_staff s where s.restaurant_id=target_restaurant_id and s.user_id=auth.uid() and s.active=true and s.role::text=any(allowed_roles));
$$;

drop policy if exists inventory_items_read_workflow_staff on public.inventory_items;
create policy inventory_items_read_workflow_staff on public.inventory_items for select to authenticated using (public.inventory_workflow_has_role(restaurant_id,array['owner','manager','kitchen','inventory']));
drop policy if exists inventory_requests_read_workflow_staff on public.kitchen_inventory_requests;
create policy inventory_requests_read_workflow_staff on public.kitchen_inventory_requests for select to authenticated using (public.inventory_workflow_has_role(restaurant_id,array['owner','manager','kitchen','inventory']));
drop policy if exists inventory_events_read_workflow_staff on public.inventory_request_events;
create policy inventory_events_read_workflow_staff on public.inventory_request_events for select to authenticated using (public.inventory_workflow_has_role(restaurant_id,array['owner','manager','kitchen','inventory']));

create or replace function public.create_kitchen_inventory_request(target_restaurant_id uuid,target_item_name text,target_quantity numeric,target_unit text,target_urgency text,target_station_id uuid default null,target_comment text default null,target_inventory_item_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor public.restaurant_staff; new_id uuid; normalized_name text:=btrim(coalesce(target_item_name,'')); normalized_unit text:=btrim(coalesce(target_unit,''));
begin
  select * into actor from public.restaurant_staff where restaurant_id=target_restaurant_id and user_id=auth.uid() and active=true and role::text in ('kitchen','owner','manager') limit 1;
  if actor.id is null then raise exception 'Kitchen request access denied.'; end if;
  if normalized_name='' or char_length(normalized_name)>120 then raise exception 'Item name is required.'; end if;
  if target_quantity is null or target_quantity<=0 then raise exception 'Quantity must be greater than zero.'; end if;
  if normalized_unit='' or char_length(normalized_unit)>24 then raise exception 'Unit is required.'; end if;
  if target_urgency not in ('normal','high','critical') then raise exception 'Urgency is invalid.'; end if;
  if target_station_id is not null and not exists(select 1 from public.kitchen_stations where id=target_station_id and restaurant_id=target_restaurant_id) then raise exception 'Station is invalid.'; end if;
  if target_inventory_item_id is not null and not exists(select 1 from public.inventory_items where id=target_inventory_item_id and restaurant_id=target_restaurant_id and active=true) then raise exception 'Inventory item is invalid.'; end if;
  insert into public.kitchen_inventory_requests(restaurant_id,inventory_item_id,station_id,requested_by_staff_id,item_name,quantity,unit,urgency,comment)
  values(target_restaurant_id,target_inventory_item_id,target_station_id,actor.id,normalized_name,target_quantity,normalized_unit,target_urgency,nullif(btrim(coalesce(target_comment,'')),'')) returning id into new_id;
  insert into public.inventory_request_events(restaurant_id,request_id,actor_staff_id,event_type,to_status,details) values(target_restaurant_id,new_id,actor.id,'created','pending',jsonb_build_object('item_name',normalized_name,'quantity',target_quantity,'unit',normalized_unit,'urgency',target_urgency,'station_id',target_station_id));
  return new_id;
end $$;

create or replace function public.process_kitchen_inventory_request(target_restaurant_id uuid,target_request_id uuid,target_action text,target_rejection_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare actor public.restaurant_staff; req public.kitchen_inventory_requests; next_status text; now_at timestamptz:=now();
begin
  select * into actor from public.restaurant_staff where restaurant_id=target_restaurant_id and user_id=auth.uid() and active=true and role::text in ('inventory','owner') limit 1;
  if actor.id is null then raise exception 'Inventory processing access denied.'; end if;
  select * into req from public.kitchen_inventory_requests where id=target_request_id and restaurant_id=target_restaurant_id for update;
  if req.id is null then raise exception 'Request not found.'; end if;
  if target_action='accept' and req.status='pending' then next_status:='accepted';
  elsif target_action='reject' and req.status='pending' then next_status:='rejected';
  elsif target_action='deliver' and req.status='accepted' then next_status:='delivered';
  else raise exception 'Invalid request status transition.'; end if;
  if next_status='rejected' and nullif(btrim(coalesce(target_rejection_reason,'')),'') is null then raise exception 'Rejection reason is required.'; end if;
  update public.kitchen_inventory_requests set status=next_status,processed_by_staff_id=actor.id,accepted_at=case when next_status='accepted' then now_at else accepted_at end,rejected_at=case when next_status='rejected' then now_at else rejected_at end,delivered_at=case when next_status='delivered' then now_at else delivered_at end,rejection_reason=case when next_status='rejected' then btrim(target_rejection_reason) else rejection_reason end,updated_at=now_at where id=req.id;
  if next_status='delivered' and req.inventory_item_id is not null then update public.inventory_items set current_quantity=greatest(0,current_quantity-req.quantity),updated_at=now_at where id=req.inventory_item_id and restaurant_id=target_restaurant_id; end if;
  insert into public.inventory_request_events(restaurant_id,request_id,actor_staff_id,event_type,from_status,to_status,details) values(target_restaurant_id,req.id,actor.id,next_status,req.status,next_status,jsonb_build_object('rejection_reason',case when next_status='rejected' then btrim(target_rejection_reason) else null end));
end $$;

revoke all on function public.inventory_workflow_has_role(uuid,text[]) from public,anon;
revoke all on function public.create_kitchen_inventory_request(uuid,text,numeric,text,text,uuid,text,uuid) from public,anon;
revoke all on function public.process_kitchen_inventory_request(uuid,uuid,text,text) from public,anon;
grant execute on function public.inventory_workflow_has_role(uuid,text[]) to authenticated,service_role;
grant execute on function public.create_kitchen_inventory_request(uuid,text,numeric,text,text,uuid,text,uuid) to authenticated,service_role;
grant execute on function public.process_kitchen_inventory_request(uuid,uuid,text,text) to authenticated,service_role;
grant select on public.inventory_items,public.kitchen_inventory_requests,public.inventory_request_events to authenticated;
