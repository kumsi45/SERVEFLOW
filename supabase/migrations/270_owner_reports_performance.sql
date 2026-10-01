-- Owner Reports performance: bounded, keyset-paginated Inventory and Cashier
-- detail contracts. Migrations 267-269 remain immutable.

create or replace function public.get_owner_report_inventory_v2(
  target_restaurant_id uuid,
  requested_period text,
  custom_start_date date default null,
  custom_end_date date default null,
  detail_section text default 'initial',
  cursor_at timestamptz default null,
  cursor_id uuid default null,
  page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved jsonb;
  range_start timestamptz;
  range_end timestamptz;
  summary jsonb;
  movement_items jsonb := '[]'::jsonb;
  movement_next jsonb;
  request_items jsonb := '[]'::jsonb;
  request_next jsonb;
  waste_items jsonb := '[]'::jsonb;
  waste_next jsonb;
begin
  perform public._owner_reports_assert_owner(target_restaurant_id);
  if detail_section is null or detail_section not in ('initial','movements','requests','waste') then raise exception 'Unsupported inventory detail section.'; end if;
  if page_size is null or page_size < 1 or page_size > 100 then raise exception 'Page size must be between 1 and 100.'; end if;
  if (cursor_at is null) <> (cursor_id is null) then raise exception 'A complete cursor is required.'; end if;

  resolved := public._owner_reports_resolve_period(target_restaurant_id, requested_period, custom_start_date, custom_end_date);
  range_start := (resolved->>'currentStart')::timestamptz;
  range_end := (resolved->>'currentEnd')::timestamptz;

  select jsonb_build_object(
    'receivedMovementCount',count(*) filter(where m.quantity_effect='in'),
    'deductedMovementCount',count(*) filter(where m.quantity_effect='out'),
    'wasteMovementCount',count(*) filter(where m.movement_type::text in ('waste','spoilage')),
    'movementCount',count(*),
    'requestCount',(select count(*) from public.kitchen_inventory_requests r where r.restaurant_id=target_restaurant_id and r.requested_at>=range_start and r.requested_at<range_end)
  ) into summary
  from public.inventory_movements m
  where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end;

  if detail_section in ('initial','movements') then
    with candidates as (
      select m.id,i.name item_name,m.movement_type,m.quantity,m.quantity_effect,m.unit_name,m.reason,m.movement_date
      from public.inventory_movements m
      join public.inventory_items i on i.restaurant_id=m.restaurant_id and i.id=m.inventory_item_id
      where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end
        and m.movement_type::text not in ('waste','spoilage')
        and (cursor_at is null or (m.movement_date,m.id)<(cursor_at,cursor_id))
      order by m.movement_date desc,m.id desc limit page_size+1
    ), visible as (select * from candidates order by movement_date desc,id desc limit page_size)
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'itemName',item_name,'movementType',movement_type,'quantity',quantity,
      'direction',quantity_effect,'unit',unit_name,'reason',reason,'recordedAt',movement_date
    ) order by movement_date desc,id desc),'[]'::jsonb),
    case when (select count(*) from candidates)>page_size then
      (select jsonb_build_object('at',movement_date,'id',id) from visible order by movement_date,id limit 1)
    end into movement_items,movement_next from visible;
  end if;

  if detail_section in ('initial','requests') then
    with candidates as (
      select r.id,r.item_name,r.quantity,r.unit,r.urgency,r.status,r.requested_at,coalesce(r.confirmed_at,r.delivered_at) delivered_at
      from public.kitchen_inventory_requests r
      where r.restaurant_id=target_restaurant_id and r.requested_at>=range_start and r.requested_at<range_end
        and (cursor_at is null or (r.requested_at,r.id)<(cursor_at,cursor_id))
      order by r.requested_at desc,r.id desc limit page_size+1
    ), visible as (select * from candidates order by requested_at desc,id desc limit page_size)
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'itemName',item_name,'quantity',quantity,'unit',unit,'urgency',urgency,
      'status',status,'requestedAt',requested_at,'deliveredAt',delivered_at
    ) order by requested_at desc,id desc),'[]'::jsonb),
    case when (select count(*) from candidates)>page_size then
      (select jsonb_build_object('at',requested_at,'id',id) from visible order by requested_at,id limit 1)
    end into request_items,request_next from visible;
  end if;

  if detail_section in ('initial','waste') then
    with candidates as (
      select m.id,i.name item_name,m.quantity,m.unit_name,m.movement_type,m.reason,m.movement_date
      from public.inventory_movements m
      join public.inventory_items i on i.restaurant_id=m.restaurant_id and i.id=m.inventory_item_id
      where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end
        and m.movement_type::text in ('waste','spoilage')
        and (cursor_at is null or (m.movement_date,m.id)<(cursor_at,cursor_id))
      order by m.movement_date desc,m.id desc limit page_size+1
    ), visible as (select * from candidates order by movement_date desc,id desc limit page_size)
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'itemName',item_name,'quantity',quantity,'unit',unit_name,
      'movementType',movement_type,'reason',reason,'recordedAt',movement_date
    ) order by movement_date desc,id desc),'[]'::jsonb),
    case when (select count(*) from candidates)>page_size then
      (select jsonb_build_object('at',movement_date,'id',id) from visible order by movement_date,id limit 1)
    end into waste_items,waste_next from visible;
  end if;

  return jsonb_build_object(
    'contractVersion','owner_inventory_report_v2','period',resolved-'anchorTime','summary',summary,
    'movements',jsonb_build_object('items',movement_items,'nextCursor',movement_next),
    'requests',jsonb_build_object('items',request_items,'nextCursor',request_next),
    'waste',jsonb_build_object('items',waste_items,'nextCursor',waste_next),
    'quality',public._owner_reports_quality(
      case when (summary->>'movementCount')::bigint=0 and (summary->>'requestCount')::bigint=0 then 'no_activity' else 'available' end,
      resolved->>'periodCompleteness','mixed_legacy','complete',0,0,0,
      jsonb_build_array('Inventory history is the immutable movement ledger; current stock is not reconstructed for this report.')
    )
  );
end;
$$;

create or replace function public.get_owner_report_cashier_shifts_v2(
  target_restaurant_id uuid,
  requested_period text,
  custom_start_date date default null,
  custom_end_date date default null,
  detail_section text default 'initial',
  cursor_at timestamptz default null,
  cursor_id uuid default null,
  page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved jsonb;
  range_start timestamptz;
  range_end timestamptz;
  summary jsonb;
  shift_items jsonb := '[]'::jsonb;
  shift_next jsonb;
  handover_items jsonb := '[]'::jsonb;
  handover_next jsonb;
begin
  perform public._owner_reports_assert_owner(target_restaurant_id);
  if detail_section is null or detail_section not in ('initial','shifts','handovers') then raise exception 'Unsupported cashier detail section.'; end if;
  if page_size is null or page_size < 1 or page_size > 100 then raise exception 'Page size must be between 1 and 100.'; end if;
  if (cursor_at is null) <> (cursor_id is null) then raise exception 'A complete cursor is required.'; end if;

  resolved := public._owner_reports_resolve_period(target_restaurant_id, requested_period, custom_start_date, custom_end_date);
  range_start := (resolved->>'currentStart')::timestamptz;
  range_end := (resolved->>'currentEnd')::timestamptz;

  select jsonb_build_object(
    'shiftCount',(select count(*) from public.cashier_shifts s where s.restaurant_id=target_restaurant_id and s.opened_at<range_end and (s.closed_at is null or s.closed_at>=range_start)),
    'openShifts',(select count(*) from public.cashier_shifts s where s.restaurant_id=target_restaurant_id and s.opened_at<range_end and s.closed_at is null),
    'shiftsRequiringReconciliation',(select count(*) from public.cashier_shifts s left join public.cash_reconciliations r on r.restaurant_id=s.restaurant_id and r.shift_id=s.id where s.restaurant_id=target_restaurant_id and s.closed_at>=range_start and s.closed_at<range_end and r.id is null),
    'recordedVariance',coalesce((select sum(r.variance) from public.cash_reconciliations r where r.restaurant_id=target_restaurant_id and r.closed_at>=range_start and r.closed_at<range_end),0),
    'handoverCount',(select count(*) from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.initiated_at>=range_start and h.initiated_at<range_end)
  ) into summary;

  if detail_section in ('initial','shifts') then
    with candidates as (
      select s.id,staff.display_name cashier_name,s.opened_at,s.closed_at,r.actual_cash,r.variance,
        case when r.id is not null then 'reconciled' when s.closed_at is null then 'open' else 'requires_reconciliation' end reconciliation_status
      from public.cashier_shifts s
      join public.restaurant_staff staff on staff.restaurant_id=s.restaurant_id and staff.id=s.opened_by
      left join public.cash_reconciliations r on r.restaurant_id=s.restaurant_id and r.shift_id=s.id
      where s.restaurant_id=target_restaurant_id and s.opened_at<range_end and (s.closed_at is null or s.closed_at>=range_start)
        and (cursor_at is null or (s.opened_at,s.id)<(cursor_at,cursor_id))
      order by s.opened_at desc,s.id desc limit page_size+1
    ), visible as (select * from candidates order by opened_at desc,id desc limit page_size)
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'cashierName',cashier_name,'openedAt',opened_at,'closedAt',closed_at,
      'actualCash',actual_cash,'variance',variance,'reconciliationStatus',reconciliation_status
    ) order by opened_at desc,id desc),'[]'::jsonb),
    case when (select count(*) from candidates)>page_size then
      (select jsonb_build_object('at',opened_at,'id',id) from visible order by opened_at,id limit 1)
    end into shift_items,shift_next from visible;
  end if;

  if detail_section in ('initial','handovers') then
    with candidates as (
      select h.id,outgoing.display_name outgoing_cashier,incoming.display_name incoming_cashier,
        h.declared_amount,h.received_amount,h.difference,h.status,h.initiated_at
      from public.cashier_cash_handovers h
      join public.restaurant_staff outgoing on outgoing.restaurant_id=h.restaurant_id and outgoing.id=h.outgoing_cashier_id
      join public.restaurant_staff incoming on incoming.restaurant_id=h.restaurant_id and incoming.id=h.incoming_cashier_id
      where h.restaurant_id=target_restaurant_id and h.initiated_at>=range_start and h.initiated_at<range_end
        and (cursor_at is null or (h.initiated_at,h.id)<(cursor_at,cursor_id))
      order by h.initiated_at desc,h.id desc limit page_size+1
    ), visible as (select * from candidates order by initiated_at desc,id desc limit page_size)
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'outgoingCashier',outgoing_cashier,'incomingCashier',incoming_cashier,
      'declaredAmount',declared_amount,'receivedAmount',received_amount,'difference',difference,
      'status',status,'recordedAt',initiated_at
    ) order by initiated_at desc,id desc),'[]'::jsonb),
    case when (select count(*) from candidates)>page_size then
      (select jsonb_build_object('at',initiated_at,'id',id) from visible order by initiated_at,id limit 1)
    end into handover_items,handover_next from visible;
  end if;

  return jsonb_build_object(
    'contractVersion','owner_cashier_report_v2','period',resolved-'anchorTime','summary',summary,
    'shifts',jsonb_build_object('items',shift_items,'nextCursor',shift_next),
    'handovers',jsonb_build_object('items',handover_items,'nextCursor',handover_next),
    'quality',public._owner_reports_quality(
      case when (summary->>'shiftCount')::bigint=0 and (summary->>'handoverCount')::bigint=0 then 'no_activity' else 'available' end,
      resolved->>'periodCompleteness'
    )
  );
end;
$$;

revoke all on function public.get_owner_report_inventory_v2(uuid,text,date,date,text,timestamptz,uuid,integer) from public, anon, authenticated;
revoke all on function public.get_owner_report_cashier_shifts_v2(uuid,text,date,date,text,timestamptz,uuid,integer) from public, anon, authenticated;
grant execute on function public.get_owner_report_inventory_v2(uuid,text,date,date,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_owner_report_cashier_shifts_v2(uuid,text,date,date,text,timestamptz,uuid,integer) to authenticated;

comment on function public.get_owner_report_inventory_v2(uuid,text,date,date,text,timestamptz,uuid,integer) is
  'Owner-only Inventory summary plus bounded independent keyset pages; waste rows are excluded from the general movement page.';
comment on function public.get_owner_report_cashier_shifts_v2(uuid,text,date,date,text,timestamptz,uuid,integer) is
  'Owner-only Cashier summary plus bounded independent keyset pages for shifts and handovers.';
