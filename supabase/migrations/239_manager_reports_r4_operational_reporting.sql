-- Manager Reports R4: operational reporting truth and auditable manager records.
-- Backend only. No scoring, staff rankings, inferred guest counts, or inventory reconstruction.

create index if not exists order_items_restaurant_kitchen_completed_idx
  on public.order_items (restaurant_id, kitchen_completed_at) where kitchen_completed_at is not null;
create index if not exists inventory_request_events_restaurant_created_idx
  on public.inventory_request_events (restaurant_id, created_at);
create index if not exists orders_restaurant_session_opened_idx
  on public.orders (restaurant_id, dining_session_opened_at);
create index if not exists waiter_assistance_requests_restaurant_requested_idx
  on public.waiter_assistance_requests (restaurant_id, requested_at);

create table public.manager_report_incidents (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  incident_type text not null check (length(btrim(incident_type)) between 1 and 80),
  source_entity_type text not null default 'manual' check (length(btrim(source_entity_type)) between 1 and 80),
  source_entity_id uuid,
  severity text not null default 'attention' check (severity in ('info','attention','high','critical')),
  status text not null default 'open' check (status in ('open','reviewed','in_progress','resolved')),
  title text not null check (length(btrim(title)) between 1 and 160),
  summary text not null check (length(btrim(summary)) between 1 and 2000),
  occurred_at timestamptz not null,
  assigned_to_staff_id uuid,
  created_by_staff_id uuid not null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  constraint manager_report_incidents_assignee_same_restaurant foreign key (restaurant_id, assigned_to_staff_id)
    references public.restaurant_staff(restaurant_id, id),
  constraint manager_report_incidents_creator_same_restaurant foreign key (restaurant_id, created_by_staff_id)
    references public.restaurant_staff(restaurant_id, id),
  constraint manager_report_incidents_resolution_check check (
    (status = 'resolved' and resolved_at is not null and length(btrim(coalesce(resolution_note,''))) > 0)
    or (status <> 'resolved' and resolved_at is null)
  )
);

create table public.manager_report_incident_decisions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  incident_id uuid not null,
  manager_staff_id uuid not null,
  decision_type text not null check (length(btrim(decision_type)) between 1 and 80),
  decision_note text not null check (length(btrim(decision_note)) between 1 and 2000),
  resulting_status text not null check (resulting_status in ('reviewed','in_progress','resolved')),
  assigned_to_staff_id uuid,
  created_at timestamptz not null default now(),
  constraint manager_report_incident_decisions_incident_same_restaurant foreign key (restaurant_id, incident_id)
    references public.manager_report_incidents(restaurant_id, id),
  constraint manager_report_incident_decisions_manager_same_restaurant foreign key (restaurant_id, manager_staff_id)
    references public.restaurant_staff(restaurant_id, id),
  constraint manager_report_incident_decisions_assignee_same_restaurant foreign key (restaurant_id, assigned_to_staff_id)
    references public.restaurant_staff(restaurant_id, id)
);

create table public.manager_operational_notes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  manager_staff_id uuid not null,
  note_date date not null,
  period_start timestamptz,
  period_end timestamptz,
  note_text text not null check (length(btrim(note_text)) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint manager_operational_notes_manager_same_restaurant foreign key (restaurant_id, manager_staff_id)
    references public.restaurant_staff(restaurant_id, id),
  constraint manager_operational_notes_period_check check (
    (period_start is null and period_end is null) or
    (period_start is not null and period_end is not null and period_start < period_end)
  )
);

create index manager_report_incidents_period_idx on public.manager_report_incidents(restaurant_id, occurred_at desc);
create index manager_report_incident_decisions_period_idx on public.manager_report_incident_decisions(restaurant_id, created_at desc);
create index manager_operational_notes_period_idx on public.manager_operational_notes(restaurant_id, note_date desc, created_at desc);

alter table public.manager_report_incidents enable row level security;
alter table public.manager_report_incident_decisions enable row level security;
alter table public.manager_operational_notes enable row level security;
revoke all on public.manager_report_incidents, public.manager_report_incident_decisions, public.manager_operational_notes from public, anon, authenticated;
grant select on public.manager_report_incidents, public.manager_report_incident_decisions, public.manager_operational_notes to authenticated;

create policy manager_report_incidents_manager_read on public.manager_report_incidents for select to authenticated
  using (public.manager_can_report(restaurant_id));
create policy manager_report_incident_decisions_manager_read on public.manager_report_incident_decisions for select to authenticated
  using (public.manager_can_report(restaurant_id));
create policy manager_operational_notes_manager_read on public.manager_operational_notes for select to authenticated
  using (public.manager_can_report(restaurant_id));

create or replace function public.create_manager_report_incident(
  target_restaurant_id uuid, incident_type text, source_entity_type text, source_entity_id uuid,
  severity text, title text, summary text, occurred_at timestamptz, assigned_to_staff_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare actor_id uuid; new_id uuid;
begin
  if not public.manager_can_report(target_restaurant_id) then raise exception 'Permission denied.'; end if;
  select id into actor_id from public.restaurant_staff
    where restaurant_id=target_restaurant_id and user_id=auth.uid() and active=true and role::text='manager' limit 1;
  if actor_id is null then raise exception 'Permission denied.'; end if;
  if assigned_to_staff_id is not null and not exists(select 1 from public.restaurant_staff where restaurant_id=target_restaurant_id and id=assigned_to_staff_id) then
    raise exception 'Assigned staff member is invalid.';
  end if;
  insert into public.manager_report_incidents(restaurant_id,incident_type,source_entity_type,source_entity_id,severity,title,summary,occurred_at,assigned_to_staff_id,created_by_staff_id)
  values(target_restaurant_id,btrim(incident_type),coalesce(nullif(btrim(source_entity_type),''),'manual'),source_entity_id,severity,btrim(title),btrim(summary),occurred_at,assigned_to_staff_id,actor_id)
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.record_manager_incident_decision(
  target_incident_id uuid, decision_type text, decision_note text, next_status text,
  target_assigned_to_staff_id uuid default null, target_resolution_note text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare incident public.manager_report_incidents; actor_id uuid; decision_id uuid; decided_at timestamptz:=now();
begin
  select * into incident from public.manager_report_incidents where id=target_incident_id for update;
  if incident.id is null or not public.manager_can_report(incident.restaurant_id) then raise exception 'Permission denied.'; end if;
  select id into actor_id from public.restaurant_staff where restaurant_id=incident.restaurant_id and user_id=auth.uid() and active=true and role::text='manager' limit 1;
  if actor_id is null then raise exception 'Permission denied.'; end if;
  if incident.status='resolved' then raise exception 'Resolved incidents are immutable.'; end if;
  if next_status not in ('reviewed','in_progress','resolved') then raise exception 'Invalid incident status.'; end if;
  if next_status='resolved' and nullif(btrim(coalesce(target_resolution_note,'')),'') is null then raise exception 'Resolution note is required.'; end if;
  if target_assigned_to_staff_id is not null and not exists(select 1 from public.restaurant_staff where restaurant_id=incident.restaurant_id and id=target_assigned_to_staff_id) then raise exception 'Assigned staff member is invalid.'; end if;
  update public.manager_report_incidents set status=next_status, assigned_to_staff_id=coalesce(target_assigned_to_staff_id,manager_report_incidents.assigned_to_staff_id),
    resolved_at=case when next_status='resolved' then decided_at else null end,
    resolution_note=case when next_status='resolved' then btrim(target_resolution_note) else null end, updated_at=decided_at where id=incident.id;
  insert into public.manager_report_incident_decisions(restaurant_id,incident_id,manager_staff_id,decision_type,decision_note,resulting_status,assigned_to_staff_id,created_at)
  values(incident.restaurant_id,incident.id,actor_id,btrim(decision_type),btrim(decision_note),next_status,target_assigned_to_staff_id,decided_at) returning id into decision_id;
  return jsonb_build_object('incident_id',incident.id,'decision_id',decision_id,'status',next_status,'decided_at',decided_at);
end $$;

create or replace function public.create_manager_operational_note(
  target_restaurant_id uuid, note_text text, note_date date,
  period_start timestamptz default null, period_end timestamptz default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare actor_id uuid; new_id uuid;
begin
  if not public.manager_can_report(target_restaurant_id) then raise exception 'Permission denied.'; end if;
  select id into actor_id from public.restaurant_staff where restaurant_id=target_restaurant_id and user_id=auth.uid() and active=true and role::text='manager' limit 1;
  if actor_id is null then raise exception 'Permission denied.'; end if;
  insert into public.manager_operational_notes(restaurant_id,manager_staff_id,note_date,period_start,period_end,note_text)
  values(target_restaurant_id,actor_id,note_date,period_start,period_end,btrim(note_text)) returning id into new_id;
  return new_id;
end $$;

create or replace function public.get_manager_operational_report(
  target_restaurant_id uuid, range_start timestamptz, range_end timestamptz,
  comparison_range_start timestamptz, comparison_range_end timestamptz
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.manager_can_report(target_restaurant_id) then return jsonb_build_object('error','Permission denied.'); end if;
  if target_restaurant_id is null or range_start is null or range_end is null or comparison_range_start is null or comparison_range_end is null
    or range_start>=range_end or comparison_range_start>=comparison_range_end or comparison_range_end>range_start then
    return jsonb_build_object('error','Invalid or overlapping reporting periods.');
  end if;

  with periods(period_key,period_start,period_end) as (values
    ('current'::text,range_start,range_end),('comparison'::text,comparison_range_start,comparison_range_end)),
  kitchen as (
    select p.period_key,
      count(*) filter(where oi.created_at>=p.period_start and oi.created_at<p.period_end)::int items_received,
      count(*) filter(where oi.kitchen_preparation_started_at>=p.period_start and oi.kitchen_preparation_started_at<p.period_end)::int items_started,
      count(*) filter(where oi.kitchen_completed_at>=p.period_start and oi.kitchen_completed_at<p.period_end)::int items_completed,
      count(*) filter(where oi.kitchen_completed_at>=p.period_start and oi.kitchen_completed_at<p.period_end and oi.kitchen_preparation_started_at is not null)::int timed_items,
      avg(extract(epoch from (oi.kitchen_completed_at-oi.kitchen_preparation_started_at))/60) filter(where oi.kitchen_completed_at>=p.period_start and oi.kitchen_completed_at<p.period_end and oi.kitchen_preparation_started_at is not null) avg_minutes,
      percentile_cont(.5) within group(order by extract(epoch from (oi.kitchen_completed_at-oi.kitchen_preparation_started_at))/60) filter(where oi.kitchen_completed_at>=p.period_start and oi.kitchen_completed_at<p.period_end and oi.kitchen_preparation_started_at is not null) median_minutes,
      max(extract(epoch from (oi.kitchen_completed_at-oi.kitchen_preparation_started_at))/60) filter(where oi.kitchen_completed_at>=p.period_start and oi.kitchen_completed_at<p.period_end and oi.kitchen_preparation_started_at is not null) longest_minutes,
      count(*) filter(where oi.kitchen_completed_at>=p.period_start and oi.kitchen_completed_at<p.period_end and oi.kitchen_preparation_started_at is not null and oi.kitchen_completed_at-oi.kitchen_preparation_started_at>=interval '25 minutes')::int delayed_items
    from periods p left join public.order_items oi on oi.restaurant_id=target_restaurant_id
    group by p.period_key
  ),
  station_rows as (
    select oi.kitchen_station_id station_id,coalesce(ks.name,'Unassigned') station_name,count(*)::int completed_items,
      avg(extract(epoch from (oi.kitchen_completed_at-oi.kitchen_preparation_started_at))/60) avg_minutes,
      count(*) filter(where oi.kitchen_completed_at-oi.kitchen_preparation_started_at>=interval '25 minutes')::int delayed_items
    from public.order_items oi left join public.kitchen_stations ks on ks.id=oi.kitchen_station_id and ks.restaurant_id=oi.restaurant_id
    where oi.restaurant_id=target_restaurant_id and oi.kitchen_completed_at>=range_start and oi.kitchen_completed_at<range_end and oi.kitchen_preparation_started_at is not null
    group by oi.kitchen_station_id,ks.name
  ),
  menu_kitchen_rows as (
    select oi.menu_item_id,mi.name menu_item_name,count(*)::int completed_items,
      avg(extract(epoch from (oi.kitchen_completed_at-oi.kitchen_preparation_started_at))/60) avg_minutes,
      max(extract(epoch from (oi.kitchen_completed_at-oi.kitchen_preparation_started_at))/60) longest_minutes,
      count(*) filter(where oi.kitchen_completed_at-oi.kitchen_preparation_started_at>=interval '25 minutes')::int delayed_items
    from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id and mi.restaurant_id=oi.restaurant_id
    where oi.restaurant_id=target_restaurant_id and oi.kitchen_completed_at>=range_start and oi.kitchen_completed_at<range_end and oi.kitchen_preparation_started_at is not null
    group by oi.menu_item_id,mi.name
  ),
  staff_rows as (
    select s.id,s.display_name,s.role::text role,s.active,
      (select count(*)::int from public.orders o where o.restaurant_id=s.restaurant_id and o.created_by_waiter_id=s.id and o.created_at>=range_start and o.created_at<range_end) orders_created,
      (select count(*)::int from public.orders o where o.restaurant_id=s.restaurant_id and o.created_by_waiter_id=s.id and o.created_at>=comparison_range_start and o.created_at<comparison_range_end) comparison_orders_created,
      (select count(*)::int from public.order_items oi where oi.restaurant_id=s.restaurant_id and oi.kitchen_completed_by=s.id and oi.kitchen_completed_at>=range_start and oi.kitchen_completed_at<range_end) kitchen_items_completed,
      (select count(*)::int from public.order_items oi where oi.restaurant_id=s.restaurant_id and oi.kitchen_completed_by=s.id and oi.kitchen_completed_at>=comparison_range_start and oi.kitchen_completed_at<comparison_range_end) comparison_kitchen_items_completed,
      (select count(*)::int from public.inventory_movements im where im.restaurant_id=s.restaurant_id and im.created_by_staff_id=s.id and im.movement_date>=range_start and im.movement_date<range_end) inventory_movements,
      (select count(*)::int from public.inventory_movements im where im.restaurant_id=s.restaurant_id and im.created_by_staff_id=s.id and im.movement_date>=comparison_range_start and im.movement_date<comparison_range_end) comparison_inventory_movements,
      (select count(*)::int from public.inventory_request_events e where e.restaurant_id=s.restaurant_id and e.actor_staff_id=s.id and e.created_at>=range_start and e.created_at<range_end) inventory_request_events,
      (select count(*)::int from public.inventory_request_events e where e.restaurant_id=s.restaurant_id and e.actor_staff_id=s.id and e.created_at>=comparison_range_start and e.created_at<comparison_range_end) comparison_inventory_request_events,
      (select count(*)::int from public.restaurant_table_waiter_assignments a where a.restaurant_id=s.restaurant_id and a.waiter_staff_id=s.id and a.assigned_at>=range_start and a.assigned_at<range_end) table_assignments,
      (select count(*)::int from public.restaurant_table_waiter_assignments a where a.restaurant_id=s.restaurant_id and a.waiter_staff_id=s.id and a.assigned_at>=comparison_range_start and a.assigned_at<comparison_range_end) comparison_table_assignments,
      (select count(*)::int from public.waiter_assistance_requests a where a.restaurant_id=s.restaurant_id and a.waiter_staff_id=s.id and a.resolved_at>=range_start and a.resolved_at<range_end) assistance_resolved,
      (select count(*)::int from public.waiter_assistance_requests a where a.restaurant_id=s.restaurant_id and a.waiter_staff_id=s.id and a.resolved_at>=comparison_range_start and a.resolved_at<comparison_range_end) comparison_assistance_resolved,
      (select count(*)::int from public.order_cancellation_requests c where c.restaurant_id=s.restaurant_id and c.requested_by_staff_id=s.id and c.requested_at>=range_start and c.requested_at<range_end) cancellations_requested,
      (select count(*)::int from public.order_cancellation_requests c where c.restaurant_id=s.restaurant_id and c.requested_by_staff_id=s.id and c.requested_at>=comparison_range_start and c.requested_at<comparison_range_end) comparison_cancellations_requested,
      (select count(*)::int from public.cashier_shifts cs where cs.restaurant_id=s.restaurant_id and cs.opened_by=s.id and cs.opened_at>=range_start and cs.opened_at<range_end) cashier_shifts_opened,
      (select count(*)::int from public.cashier_shifts cs where cs.restaurant_id=s.restaurant_id and cs.opened_by=s.id and cs.opened_at>=comparison_range_start and cs.opened_at<comparison_range_end) comparison_cashier_shifts_opened,
      (select count(*)::int from public.order_invoices inv where inv.restaurant_id=s.restaurant_id and inv.verified_by=s.id and inv.paid_at>=range_start and inv.paid_at<range_end) payments_verified,
      (select count(*)::int from public.order_invoices inv where inv.restaurant_id=s.restaurant_id and inv.verified_by=s.id and inv.paid_at>=comparison_range_start and inv.paid_at<comparison_range_end) comparison_payments_verified,
      (select count(*)::int from public.cashier_shift_expenses x where x.restaurant_id=s.restaurant_id and x.cashier_staff_id=s.id and x.created_at>=range_start and x.created_at<range_end) expenses_recorded,
      (select count(*)::int from public.cashier_shift_expenses x where x.restaurant_id=s.restaurant_id and x.cashier_staff_id=s.id and x.created_at>=comparison_range_start and x.created_at<comparison_range_end) comparison_expenses_recorded,
      (select count(*)::int from public.cashier_cash_handovers h where h.restaurant_id=s.restaurant_id and (h.outgoing_cashier_id=s.id or h.incoming_cashier_id=s.id) and h.initiated_at>=range_start and h.initiated_at<range_end) handovers_involved,
      (select count(*)::int from public.cashier_cash_handovers h where h.restaurant_id=s.restaurant_id and (h.outgoing_cashier_id=s.id or h.incoming_cashier_id=s.id) and h.initiated_at>=comparison_range_start and h.initiated_at<comparison_range_end) comparison_handovers_involved,
      (select count(*)::int from public.cash_reconciliations cr where cr.restaurant_id=s.restaurant_id and cr.closed_by=s.id and cr.closed_at>=range_start and cr.closed_at<range_end) reconciliations_closed,
      (select count(*)::int from public.cash_reconciliations cr where cr.restaurant_id=s.restaurant_id and cr.closed_by=s.id and cr.closed_at>=comparison_range_start and cr.closed_at<comparison_range_end) comparison_reconciliations_closed
    from public.restaurant_staff s where s.restaurant_id=target_restaurant_id and s.role::text in ('waiter','cashier','kitchen','inventory')
  ),
  movement_periods as (
    select p.period_key,count(im.*)::int movement_count,
      coalesce(sum(im.quantity) filter(where im.quantity_effect='in'),0) quantity_in,
      coalesce(sum(im.quantity) filter(where im.quantity_effect='out'),0) quantity_out,
      coalesce(sum(im.quantity) filter(where im.movement_type::text in ('waste','spoilage')),0) waste_spoilage
    from periods p left join public.inventory_movements im on im.restaurant_id=target_restaurant_id and im.movement_date>=p.period_start and im.movement_date<p.period_end group by p.period_key
  ),
  guest_periods as (
    select p.period_key,
      count(*) filter(where o.dining_session_opened_at>=p.period_start and o.dining_session_opened_at<p.period_end)::int sessions_opened,
      count(*) filter(where o.dining_session_closed_at>=p.period_start and o.dining_session_closed_at<p.period_end)::int sessions_closed,
      count(distinct o.table_number) filter(where o.dining_session_opened_at>=p.period_start and o.dining_session_opened_at<p.period_end and o.table_number is not null)::int tables_served,
      avg(extract(epoch from(o.dining_session_closed_at-o.dining_session_opened_at))/60) filter(where o.dining_session_closed_at>=p.period_start and o.dining_session_closed_at<p.period_end and o.dining_session_opened_at is not null) avg_session_minutes
      ,max(extract(epoch from(o.dining_session_closed_at-o.dining_session_opened_at))/60) filter(where o.dining_session_closed_at>=p.period_start and o.dining_session_closed_at<p.period_end and o.dining_session_opened_at is not null) longest_session_minutes
    from periods p left join public.orders o on o.restaurant_id=target_restaurant_id group by p.period_key
  ),
  native_exceptions as (
    select 'complaint' source_type,c.id source_id,c.created_at occurred_at,c.severity,c.status,c.category title,c.description summary from public.manager_customer_complaints c where c.restaurant_id=target_restaurant_id and c.created_at>=range_start and c.created_at<range_end
    union all select 'cancellation_request',r.id,r.requested_at,'attention',r.status,r.reason,coalesce(r.note,r.request_scope) from public.order_cancellation_requests r where r.restaurant_id=target_restaurant_id and r.requested_at>=range_start and r.requested_at<range_end
    union all select 'inventory_loss',im.id,im.movement_date,case when im.movement_type::text='spoilage' then 'high' else 'attention' end,im.movement_type::text,coalesce(ii.name,'Inventory item'),coalesce(im.reason,im.notes,'Recorded inventory loss') from public.inventory_movements im left join public.inventory_items ii on ii.id=im.inventory_item_id and ii.restaurant_id=im.restaurant_id where im.restaurant_id=target_restaurant_id and im.movement_type::text in ('waste','spoilage') and im.movement_date>=range_start and im.movement_date<range_end
  )
  select jsonb_build_object(
    'generated_at',now(),'range_start',range_start,'range_end',range_end,'comparison_range_start',comparison_range_start,'comparison_range_end',comparison_range_end,
    'kitchen',jsonb_build_object('current',(select to_jsonb(k)-'period_key' from kitchen k where period_key='current'),'comparison',(select to_jsonb(k)-'period_key' from kitchen k where period_key='comparison'),'stations',coalesce((select jsonb_agg(to_jsonb(s) order by completed_items desc,station_name) from station_rows s),'[]'::jsonb),'menu_items',coalesce((select jsonb_agg(to_jsonb(m) order by delayed_items desc,avg_minutes desc,menu_item_name) from menu_kitchen_rows m),'[]'::jsonb),'delay_threshold_minutes',25),
    'staff',jsonb_build_object('facts',coalesce((select jsonb_agg(to_jsonb(s) order by display_name) from staff_rows s),'[]'::jsonb),'ranking_available',false,'score_available',false),
    'inventory',jsonb_build_object('current',(select to_jsonb(m)-'period_key' from movement_periods m where period_key='current'),'comparison',(select to_jsonb(m)-'period_key' from movement_periods m where period_key='comparison'),'movements',coalesce((select jsonb_agg(jsonb_build_object('id',im.id,'item_id',im.inventory_item_id,'item_name',ii.name,'movement_type',im.movement_type,'quantity',im.quantity,'quantity_effect',im.quantity_effect,'unit_name',im.unit_name,'movement_date',im.movement_date,'actor_staff_id',im.created_by_staff_id,'source_system',im.source_system) order by im.movement_date desc) from public.inventory_movements im join public.inventory_items ii on ii.id=im.inventory_item_id and ii.restaurant_id=im.restaurant_id where im.restaurant_id=target_restaurant_id and im.movement_date>=range_start and im.movement_date<range_end),'[]'::jsonb),'requests',coalesce((select jsonb_agg(to_jsonb(r) - 'restaurant_id' order by r.requested_at desc) from public.kitchen_inventory_requests r where r.restaurant_id=target_restaurant_id and r.requested_at>=range_start and r.requested_at<range_end),'[]'::jsonb)),
    'guests',jsonb_build_object('current',(select to_jsonb(g)-'period_key' from guest_periods g where period_key='current'),'comparison',(select to_jsonb(g)-'period_key' from guest_periods g where period_key='comparison'),
      'assistance_requests',(select count(*) from public.waiter_assistance_requests a where a.restaurant_id=target_restaurant_id and a.requested_at>=range_start and a.requested_at<range_end),
      'comparison_assistance_requests',(select count(*) from public.waiter_assistance_requests a where a.restaurant_id=target_restaurant_id and a.requested_at>=comparison_range_start and a.requested_at<comparison_range_end),
      'complaints',(select count(*) from public.manager_customer_complaints c where c.restaurant_id=target_restaurant_id and c.created_at>=range_start and c.created_at<range_end),
      'comparison_complaints',(select count(*) from public.manager_customer_complaints c where c.restaurant_id=target_restaurant_id and c.created_at>=comparison_range_start and c.created_at<comparison_range_end),
      'feedback_count',(select count(*) from public.public_order_feedback f where f.restaurant_id=target_restaurant_id and f.created_at>=range_start and f.created_at<range_end),
      'comparison_feedback_count',(select count(*) from public.public_order_feedback f where f.restaurant_id=target_restaurant_id and f.created_at>=comparison_range_start and f.created_at<comparison_range_end),
      'average_feedback_rating',(select avg(f.rating) from public.public_order_feedback f where f.restaurant_id=target_restaurant_id and f.created_at>=range_start and f.created_at<range_end),
      'comparison_average_feedback_rating',(select avg(f.rating) from public.public_order_feedback f where f.restaurant_id=target_restaurant_id and f.created_at>=comparison_range_start and f.created_at<comparison_range_end),
      'unresolved_assistance_requests',(select count(*) from public.waiter_assistance_requests a where a.restaurant_id=target_restaurant_id and a.requested_at<range_end and a.status in ('pending','acknowledged')),
      'unresolved_complaints',(select count(*) from public.manager_customer_complaints c where c.restaurant_id=target_restaurant_id and c.created_at<range_end and c.status<>'resolved'),
      'guest_count_available',false),
    'exceptions',jsonb_build_object('native',coalesce((select jsonb_agg(to_jsonb(e) order by occurred_at desc) from native_exceptions e),'[]'::jsonb),'manual',coalesce((select jsonb_agg(to_jsonb(i)-'restaurant_id' order by occurred_at desc) from public.manager_report_incidents i where i.restaurant_id=target_restaurant_id and i.occurred_at>=range_start and i.occurred_at<range_end),'[]'::jsonb)),
    'manager_records',jsonb_build_object(
      'decisions',coalesce((select jsonb_agg(to_jsonb(d)-'restaurant_id' order by d.created_at desc)
        from public.manager_report_incident_decisions d join public.manager_report_incidents i on i.id=d.incident_id and i.restaurant_id=d.restaurant_id
        where d.restaurant_id=target_restaurant_id and ((d.created_at>=range_start and d.created_at<range_end) or (i.occurred_at>=range_start and i.occurred_at<range_end))),'[]'::jsonb),
      'notes',coalesce((select jsonb_agg(to_jsonb(n)-'restaurant_id' order by n.created_at desc) from public.manager_operational_notes n
        where n.restaurant_id=target_restaurant_id and ((n.created_at>=range_start and n.created_at<range_end)
          or (n.note_date>=range_start::date and n.note_date<range_end::date)
          or (n.period_start is not null and n.period_start<range_end and n.period_end>range_start))),'[]'::jsonb)),
    'data_quality',jsonb_build_object('kitchen_history_quality','legacy_unknown','staff_attribution_quality','legacy_unknown','inventory_history_quality','mixed_legacy','inventory_history_scope','movement_ledger_only','guest_identity_quality','unavailable','party_size_quality','unavailable','incident_provenance_quality','legacy_unknown'),
    'definitions',jsonb_build_object('kitchen_duration','Completed minus preparation-started for rows containing both canonical milestones; grouped by completion time.','delayed_item','Strict kitchen duration of at least 25 minutes; an operational threshold, not a performance score.','inventory','Immutable inventory_movements only; current quantities are never used to reconstruct history.','guest_session','Dining session records; orders are never treated as guest counts.','staff','Attributed event counts only; no ranking or score.','exceptions','Native complaint, cancellation-request and inventory-loss events plus explicitly recorded manager incidents.')
  ) into result;
  return result;
end $$;

revoke all on function public.create_manager_report_incident(uuid,text,text,uuid,text,text,text,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.record_manager_incident_decision(uuid,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.create_manager_operational_note(uuid,text,date,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.get_manager_operational_report(uuid,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.create_manager_report_incident(uuid,text,text,uuid,text,text,text,timestamptz,uuid) to authenticated,service_role;
grant execute on function public.record_manager_incident_decision(uuid,text,text,text,uuid,text) to authenticated,service_role;
grant execute on function public.create_manager_operational_note(uuid,text,date,timestamptz,timestamptz) to authenticated,service_role;
grant execute on function public.get_manager_operational_report(uuid,timestamptz,timestamptz,timestamptz,timestamptz) to authenticated,service_role;

comment on function public.get_manager_operational_report(uuid,timestamptz,timestamptz,timestamptz,timestamptz) is
  'R4 manager-only operational report using canonical event timestamps and explicit data-quality limitations.';
