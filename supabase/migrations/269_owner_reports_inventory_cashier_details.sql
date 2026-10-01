-- Owner Reports: lazy, owner-only inventory and cashier history details.
-- Period boundaries remain authoritative in the server-side Owner Reports resolver.

create or replace function public.get_owner_report_inventory(
  target_restaurant_id uuid,
  requested_period text,
  custom_start_date date default null,
  custom_end_date date default null
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
begin
  perform public._owner_reports_assert_owner(target_restaurant_id);
  resolved := public._owner_reports_resolve_period(target_restaurant_id, requested_period, custom_start_date, custom_end_date);
  range_start := (resolved->>'currentStart')::timestamptz;
  range_end := (resolved->>'currentEnd')::timestamptz;

  return jsonb_build_object(
    'contractVersion', 'owner_inventory_report_v1',
    'period', resolved - 'anchorTime',
    'summary', jsonb_build_object(
      'receivedMovementCount', (select count(*) from public.inventory_movements m where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end and m.quantity_effect='in'),
      'deductedMovementCount', (select count(*) from public.inventory_movements m where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end and m.quantity_effect='out'),
      'wasteMovementCount', (select count(*) from public.inventory_movements m where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end and m.movement_type::text in ('waste','spoilage')),
      'movementCount', (select count(*) from public.inventory_movements m where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end),
      'requestCount', (select count(*) from public.kitchen_inventory_requests r where r.restaurant_id=target_restaurant_id and r.requested_at>=range_start and r.requested_at<range_end)
    ),
    'movements', coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'itemName',i.name,'movementType',m.movement_type,'quantity',m.quantity,
      'direction',m.quantity_effect,'unit',m.unit_name,'reason',m.reason,'recordedAt',m.movement_date
    ) order by m.movement_date desc,m.id desc)
      from public.inventory_movements m
      join public.inventory_items i on i.restaurant_id=m.restaurant_id and i.id=m.inventory_item_id
      where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end),'[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'itemName',r.item_name,'quantity',r.quantity,'unit',r.unit,
      'urgency',r.urgency,'status',r.status,'requestedAt',r.requested_at,
      'deliveredAt',coalesce(r.confirmed_at,r.delivered_at)
    ) order by r.requested_at desc,r.id desc)
      from public.kitchen_inventory_requests r
      where r.restaurant_id=target_restaurant_id and r.requested_at>=range_start and r.requested_at<range_end),'[]'::jsonb),
    'waste', coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'itemName',i.name,'quantity',m.quantity,'unit',m.unit_name,
      'movementType',m.movement_type,'reason',m.reason,'recordedAt',m.movement_date
    ) order by m.movement_date desc,m.id desc)
      from public.inventory_movements m
      join public.inventory_items i on i.restaurant_id=m.restaurant_id and i.id=m.inventory_item_id
      where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end
        and m.movement_type::text in ('waste','spoilage')),'[]'::jsonb),
    'quality', public._owner_reports_quality(
      case when not exists(select 1 from public.inventory_movements m where m.restaurant_id=target_restaurant_id and m.movement_date>=range_start and m.movement_date<range_end)
        and not exists(select 1 from public.kitchen_inventory_requests r where r.restaurant_id=target_restaurant_id and r.requested_at>=range_start and r.requested_at<range_end)
        then 'no_activity' else 'available' end,
      resolved->>'periodCompleteness','mixed_legacy','complete',0,0,0,
      jsonb_build_array('Inventory history is the immutable movement ledger; current stock is not reconstructed for this report.')
    )
  );
end;
$$;

create or replace function public.get_owner_report_cashier_shifts(
  target_restaurant_id uuid,
  requested_period text,
  custom_start_date date default null,
  custom_end_date date default null
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
begin
  perform public._owner_reports_assert_owner(target_restaurant_id);
  resolved := public._owner_reports_resolve_period(target_restaurant_id, requested_period, custom_start_date, custom_end_date);
  range_start := (resolved->>'currentStart')::timestamptz;
  range_end := (resolved->>'currentEnd')::timestamptz;

  return jsonb_build_object(
    'contractVersion','owner_cashier_report_v1',
    'period',resolved-'anchorTime',
    'summary',jsonb_build_object(
      'openShifts',(select count(*) from public.cashier_shifts s where s.restaurant_id=target_restaurant_id and s.opened_at<range_end and s.closed_at is null),
      'shiftsRequiringReconciliation',(select count(*) from public.cashier_shifts s left join public.cash_reconciliations r on r.restaurant_id=s.restaurant_id and r.shift_id=s.id where s.restaurant_id=target_restaurant_id and s.closed_at>=range_start and s.closed_at<range_end and r.id is null),
      'recordedVariance',coalesce((select sum(r.variance) from public.cash_reconciliations r where r.restaurant_id=target_restaurant_id and r.closed_at>=range_start and r.closed_at<range_end),0),
      'handoverCount',(select count(*) from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.initiated_at>=range_start and h.initiated_at<range_end)
    ),
    'shifts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'cashierName',staff.display_name,'openedAt',s.opened_at,'closedAt',s.closed_at,
      'actualCash',r.actual_cash,'variance',r.variance,
      'reconciliationStatus',case when r.id is not null then 'reconciled' when s.closed_at is null then 'open' else 'requires_reconciliation' end
    ) order by s.opened_at desc,s.id desc)
      from public.cashier_shifts s
      join public.restaurant_staff staff on staff.restaurant_id=s.restaurant_id and staff.id=s.opened_by
      left join public.cash_reconciliations r on r.restaurant_id=s.restaurant_id and r.shift_id=s.id
      where s.restaurant_id=target_restaurant_id and s.opened_at<range_end and (s.closed_at is null or s.closed_at>=range_start)),'[]'::jsonb),
    'handovers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'outgoingCashier',outgoing.display_name,'incomingCashier',incoming.display_name,
      'declaredAmount',h.declared_amount,'receivedAmount',h.received_amount,'difference',h.difference,
      'status',h.status,'recordedAt',h.initiated_at
    ) order by h.initiated_at desc,h.id desc)
      from public.cashier_cash_handovers h
      join public.restaurant_staff outgoing on outgoing.restaurant_id=h.restaurant_id and outgoing.id=h.outgoing_cashier_id
      join public.restaurant_staff incoming on incoming.restaurant_id=h.restaurant_id and incoming.id=h.incoming_cashier_id
      where h.restaurant_id=target_restaurant_id and h.initiated_at>=range_start and h.initiated_at<range_end),'[]'::jsonb),
    'quality',public._owner_reports_quality(
      case when not exists(select 1 from public.cashier_shifts s where s.restaurant_id=target_restaurant_id and s.opened_at<range_end and (s.closed_at is null or s.closed_at>=range_start))
        and not exists(select 1 from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.initiated_at>=range_start and h.initiated_at<range_end)
        then 'no_activity' else 'available' end,
      resolved->>'periodCompleteness'
    )
  );
end;
$$;

revoke all on function public.get_owner_report_inventory(uuid,text,date,date) from public, anon, authenticated;
revoke all on function public.get_owner_report_cashier_shifts(uuid,text,date,date) from public, anon, authenticated;
grant execute on function public.get_owner_report_inventory(uuid,text,date,date) to authenticated;
grant execute on function public.get_owner_report_cashier_shifts(uuid,text,date,date) to authenticated;

comment on function public.get_owner_report_inventory(uuid,text,date,date) is
  'Owner-only historical inventory movements and kitchen requests using authoritative Owner Reports periods.';
comment on function public.get_owner_report_cashier_shifts(uuid,text,date,date) is
  'Owner-only financial shift, reconciliation, variance, and cash-handover history using authoritative Owner Reports periods.';
