-- Manager Reports R3: Menu Performance + period-aware Cashier / Shift reporting.
-- Reuses R1 period bounds, manager_can_report, frozen order-item prices, and the
-- canonical cashier drawer/reconciliation architecture. No Reports UI changes.

create index if not exists cashier_shift_expenses_restaurant_reviewed_idx
  on public.cashier_shift_expenses (restaurant_id, reviewed_at desc)
  where reviewed_at is not null;

create index if not exists cashier_cash_handovers_restaurant_confirmed_idx
  on public.cashier_cash_handovers (restaurant_id, confirmed_at desc)
  where confirmed_at is not null;

create or replace function public.get_manager_menu_performance_report(
  target_restaurant_id uuid,
  range_start timestamptz,
  range_end timestamptz,
  comparison_range_start timestamptz,
  comparison_range_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.manager_can_report(target_restaurant_id) then
    return jsonb_build_object('error', 'Permission denied.');
  end if;
  if target_restaurant_id is null
    or range_start is null or range_end is null
    or comparison_range_start is null or comparison_range_end is null
    or range_start >= range_end
    or comparison_range_start >= comparison_range_end
    or comparison_range_end > range_start then
    return jsonb_build_object('error', 'Invalid or overlapping reporting periods.');
  end if;

  with
  periods(period_key, period_start, period_end) as (
    values
      ('current'::text, range_start, range_end),
      ('comparison'::text, comparison_range_start, comparison_range_end)
  ),
  catalog as (
    select
      items.id as menu_item_id,
      items.name as menu_item_name,
      items.category_id,
      categories.name as category_name,
      items.available,
      items.archived_at,
      case
        when items.archived_at is not null then 'Hidden'
        when items.available then 'Available'
        else 'Sold Out'
      end as current_status
    from public.menu_items items
    join public.categories categories
      on categories.id = items.category_id
     and categories.restaurant_id = items.restaurant_id
    where items.restaurant_id = target_restaurant_id
  ),
  eligible_lines as (
    select
      periods.period_key,
      order_items.menu_item_id,
      order_items.order_id,
      order_items.quantity::integer as quantity,
      (order_items.price * order_items.quantity)::numeric as sales_value,
      order_items.price
    from periods
    join public.order_invoices invoices
      on invoices.restaurant_id = target_restaurant_id
     and invoices.payment_status = 'paid'
     and invoices.paid_at >= periods.period_start
     and invoices.paid_at < periods.period_end
    join public.orders orders
      on orders.id = invoices.order_id
     and orders.restaurant_id = invoices.restaurant_id
     and orders.status::text <> 'cancelled'
    join public.order_items order_items
      on order_items.invoice_id = invoices.id
     and order_items.order_id = invoices.order_id
     and order_items.restaurant_id = invoices.restaurant_id
     and order_items.kitchen_status <> 'cancelled'
  ),
  item_sales as (
    select
      period_key,
      menu_item_id,
      sum(quantity)::integer as quantity_sold,
      count(distinct order_id)::integer as orders_containing_item,
      count(*)::integer as order_item_count,
      coalesce(sum(sales_value), 0)::numeric as sales_value
    from eligible_lines
    group by period_key, menu_item_id
  ),
  item_metrics as (
    select
      catalog.*,
      coalesce(current_sales.quantity_sold, 0)::integer as current_quantity,
      coalesce(comparison_sales.quantity_sold, 0)::integer as comparison_quantity,
      coalesce(current_sales.orders_containing_item, 0)::integer as current_orders,
      coalesce(comparison_sales.orders_containing_item, 0)::integer as comparison_orders,
      coalesce(current_sales.order_item_count, 0)::integer as current_order_item_count,
      coalesce(comparison_sales.order_item_count, 0)::integer as comparison_order_item_count,
      coalesce(current_sales.sales_value, 0)::numeric as current_sales,
      coalesce(comparison_sales.sales_value, 0)::numeric as comparison_sales
    from catalog
    left join item_sales current_sales
      on current_sales.menu_item_id = catalog.menu_item_id
     and current_sales.period_key = 'current'
    left join item_sales comparison_sales
      on comparison_sales.menu_item_id = catalog.menu_item_id
     and comparison_sales.period_key = 'comparison'
  ),
  item_payloads as (
    select
      item_metrics.*,
      jsonb_build_object(
        'menu_item_id', menu_item_id,
        'menu_item_name', menu_item_name,
        'category_id', category_id,
        'category_name', category_name,
        'current_status', current_status,
        'current_quantity', current_quantity,
        'comparison_quantity', comparison_quantity,
        'quantity_change', current_quantity - comparison_quantity,
        'quantity_change_percent', case when comparison_quantity = 0 then null
          else ((current_quantity - comparison_quantity)::numeric / comparison_quantity) * 100 end,
        'current_sales', current_sales,
        'comparison_sales', comparison_sales,
        'sales_change', current_sales - comparison_sales,
        'sales_change_percent', case when comparison_sales = 0 then null
          else ((current_sales - comparison_sales) / abs(comparison_sales)) * 100 end,
        'current_orders', current_orders,
        'comparison_orders', comparison_orders,
        'current_order_item_count', current_order_item_count,
        'comparison_order_item_count', comparison_order_item_count
      ) as payload
    from item_metrics
  ),
  category_lines as (
    select
      eligible_lines.period_key,
      catalog.category_id,
      catalog.category_name,
      sum(eligible_lines.quantity)::integer as quantity_sold,
      count(distinct eligible_lines.order_id)::integer as orders_containing_category,
      count(*)::integer as order_item_count,
      coalesce(sum(eligible_lines.sales_value), 0)::numeric as sales_value
    from eligible_lines
    join catalog on catalog.menu_item_id = eligible_lines.menu_item_id
    group by eligible_lines.period_key, catalog.category_id, catalog.category_name
  ),
  category_metrics as (
    select
      categories.id as category_id,
      categories.name as category_name,
      coalesce(current_lines.quantity_sold, 0)::integer as current_quantity,
      coalesce(comparison_lines.quantity_sold, 0)::integer as comparison_quantity,
      coalesce(current_lines.sales_value, 0)::numeric as current_sales,
      coalesce(comparison_lines.sales_value, 0)::numeric as comparison_sales,
      coalesce(current_lines.order_item_count, 0)::integer as current_order_item_count,
      coalesce(comparison_lines.order_item_count, 0)::integer as comparison_order_item_count,
      coalesce(current_lines.orders_containing_category, 0)::integer as current_orders,
      coalesce(comparison_lines.orders_containing_category, 0)::integer as comparison_orders
    from public.categories categories
    left join category_lines current_lines
      on current_lines.category_id = categories.id
     and current_lines.period_key = 'current'
    left join category_lines comparison_lines
      on comparison_lines.category_id = categories.id
     and comparison_lines.period_key = 'comparison'
    where categories.restaurant_id = target_restaurant_id
  ),
  category_payloads as (
    select
      category_metrics.*,
      jsonb_build_object(
        'category_id', category_id,
        'category_name', category_name,
        'current_quantity', current_quantity,
        'comparison_quantity', comparison_quantity,
        'quantity_change', current_quantity - comparison_quantity,
        'quantity_change_percent', case when comparison_quantity = 0 then null
          else ((current_quantity - comparison_quantity)::numeric / comparison_quantity) * 100 end,
        'current_sales', current_sales,
        'comparison_sales', comparison_sales,
        'sales_change', current_sales - comparison_sales,
        'sales_change_percent', case when comparison_sales = 0 then null
          else ((current_sales - comparison_sales) / abs(comparison_sales)) * 100 end,
        'current_order_item_count', current_order_item_count,
        'comparison_order_item_count', comparison_order_item_count,
        'current_orders', current_orders,
        'comparison_orders', comparison_orders
      ) as payload
    from category_metrics
  ),
  quality as (
    select
      count(*)::integer as line_count,
      count(*) filter (where price is null)::integer as missing_price_count
    from eligible_lines
    where period_key = 'current'
  )
  select jsonb_build_object(
    'generated_at', now(),
    'range_start', range_start,
    'range_end', range_end,
    'comparison_range_start', comparison_range_start,
    'comparison_range_end', comparison_range_end,
    'items', coalesce((select jsonb_agg(payload order by current_quantity desc, current_sales desc, menu_item_name) from item_payloads), '[]'::jsonb),
    'top_by_quantity', coalesce((select jsonb_agg(payload order by current_quantity desc, current_sales desc, menu_item_name) from (select * from item_payloads where current_quantity > 0 order by current_quantity desc, current_sales desc, menu_item_name limit 10) ranked), '[]'::jsonb),
    'top_by_sales', coalesce((select jsonb_agg(payload order by current_sales desc, current_quantity desc, menu_item_name) from (select * from item_payloads where current_sales > 0 order by current_sales desc, current_quantity desc, menu_item_name limit 10) ranked), '[]'::jsonb),
    'low_selling', coalesce((select jsonb_agg(payload order by current_quantity, current_sales, menu_item_name) from (select * from item_payloads where current_quantity > 0 order by current_quantity, current_sales, menu_item_name limit 10) ranked), '[]'::jsonb),
    'zero_recorded_sales', coalesce((select jsonb_agg(payload order by menu_item_name) from item_payloads where current_quantity = 0), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(payload order by current_quantity desc, current_sales desc, category_name) from category_payloads), '[]'::jsonb),
    'availability_history_available', false,
    'data_quality', jsonb_build_object(
      'historical_price_quality', case
        when (select line_count from quality) = 0 then 'unavailable'
        when (select missing_price_count from quality) = 0 then 'complete'
        else 'mixed_legacy'
      end,
      'availability_history_quality', 'unavailable',
      'item_identity_history_quality', case when (select line_count from quality) = 0 then 'unavailable' else 'legacy_unknown' end,
      'legacy_order_item_quality', case
        when (select line_count from quality) = 0 then 'unavailable'
        when (select missing_price_count from quality) = 0 then 'complete'
        else 'mixed_legacy'
      end
    ),
    'definitions', jsonb_build_object(
      'quantity_sold', 'Quantity on non-cancelled order items attached to currently paid invoices, selected by invoice paid_at.',
      'sales_value', 'Frozen order-item unit price multiplied by quantity; excludes invoice-level VAT, service charge and discount allocation.',
      'zero_sales', 'Zero recorded qualifying sales; current availability is context only and is not historical availability evidence.'
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_manager_menu_performance_report(uuid, timestamptz, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_manager_menu_performance_report(uuid, timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

create or replace function public.get_manager_cashier_period_report(
  target_restaurant_id uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if not public.manager_can_report(target_restaurant_id) then
    return jsonb_build_object('error', 'Permission denied.');
  end if;
  if target_restaurant_id is null or range_start is null or range_end is null or range_start >= range_end then
    return jsonb_build_object('error', 'Invalid reporting period.');
  end if;

  with
  included_shifts as (
    select shifts.*
    from public.cashier_shifts shifts
    where shifts.restaurant_id = target_restaurant_id
      and shifts.opened_at < range_end
      and (shifts.closed_at is null or shifts.closed_at > range_start)
  ),
  shift_rows as (
    select
      shifts.id,
      shifts.opened_by as cashier_id,
      cashier.display_name as cashier_name,
      cashier.employee_id,
      shifts.opened_at,
      shifts.closed_at,
      shifts.opening_cash,
      case when reconciliations.id is not null then reconciliations.cash_payments
        else (drawer.data->>'cash_sales')::numeric end as cash_sales,
      case when reconciliations.id is not null then reconciliations.cash_refunds
        else (drawer.data->>'cash_refunds')::numeric end as cash_refunds,
      (drawer.data->>'non_cash_sales')::numeric as non_cash_sales,
      (drawer.data->>'approved_expenses')::numeric as approved_expenses,
      (drawer.data->>'pending_expenses')::numeric as pending_expenses,
      expense_totals.expense_count,
      expense_totals.rejected_expenses,
      case when reconciliations.id is not null then reconciliations.expected_cash
        else (drawer.data->>'expected_cash')::numeric end as expected_cash,
      case when reconciliations.id is not null then reconciliations.actual_cash else null end as actual_cash,
      case when reconciliations.id is not null then reconciliations.variance else null end as variance,
      case when shifts.closed_at is null then 'open' else 'closed' end as status,
      case
        when shifts.closed_at is null then 'not_yet_reconciled'
        when reconciliations.id is not null then 'reconciled'
        else 'missing_reconciliation'
      end as reconciliation_status,
      reconciliations.id as reconciliation_id,
      reconciliations.variance_reason,
      reconciliations.closed_at as reconciled_at
    from included_shifts shifts
    join public.restaurant_staff cashier
      on cashier.id = shifts.opened_by
     and cashier.restaurant_id = shifts.restaurant_id
    cross join lateral (select public.cashier_shift_drawer_totals(shifts.id) as data) drawer
    cross join lateral (
      select
        count(*)::integer as expense_count,
        coalesce(sum(expenses.amount) filter (where expenses.status = 'rejected'), 0)::numeric as rejected_expenses
      from public.cashier_shift_expenses expenses
      where expenses.restaurant_id = shifts.restaurant_id
        and expenses.shift_id = shifts.id
    ) expense_totals
    left join public.cash_reconciliations reconciliations
      on reconciliations.shift_id = shifts.id
     and reconciliations.restaurant_id = shifts.restaurant_id
  ),
  expense_rows as (
    select
      expenses.*,
      cashier.display_name as cashier_name,
      cashier.employee_id,
      creator.display_name as recorded_by_name,
      reviewer.display_name as reviewed_by_name,
      (expenses.created_at >= range_start and expenses.created_at < range_end) as created_in_period,
      (expenses.reviewed_at >= range_start and expenses.reviewed_at < range_end) as reviewed_in_period
    from public.cashier_shift_expenses expenses
    join public.restaurant_staff cashier
      on cashier.id = expenses.cashier_staff_id
     and cashier.restaurant_id = expenses.restaurant_id
    join public.restaurant_staff creator
      on creator.id = expenses.created_by
     and creator.restaurant_id = expenses.restaurant_id
    left join public.restaurant_staff reviewer
      on reviewer.id = expenses.reviewed_by
     and reviewer.restaurant_id = expenses.restaurant_id
    where expenses.restaurant_id = target_restaurant_id
      and (
        (expenses.created_at >= range_start and expenses.created_at < range_end)
        or (expenses.reviewed_at >= range_start and expenses.reviewed_at < range_end)
      )
  ),
  handover_rows as (
    select
      handovers.*,
      outgoing.display_name as outgoing_name,
      outgoing.employee_id as outgoing_employee_id,
      incoming.display_name as incoming_name,
      incoming.employee_id as incoming_employee_id,
      (handovers.initiated_at >= range_start and handovers.initiated_at < range_end) as initiated_in_period,
      (handovers.confirmed_at >= range_start and handovers.confirmed_at < range_end) as confirmed_in_period
    from public.cashier_cash_handovers handovers
    join public.restaurant_staff outgoing
      on outgoing.id = handovers.outgoing_cashier_id
     and outgoing.restaurant_id = handovers.restaurant_id
    join public.restaurant_staff incoming
      on incoming.id = handovers.incoming_cashier_id
     and incoming.restaurant_id = handovers.restaurant_id
    where handovers.restaurant_id = target_restaurant_id
      and (
        (handovers.initiated_at >= range_start and handovers.initiated_at < range_end)
        or (handovers.confirmed_at >= range_start and handovers.confirmed_at < range_end)
      )
  ),
  reconciliation_rows as (
    select
      reconciliations.*,
      shifts.opened_by as cashier_id,
      cashier.display_name as cashier_name,
      cashier.employee_id
    from public.cash_reconciliations reconciliations
    join public.cashier_shifts shifts
      on shifts.id = reconciliations.shift_id
     and shifts.restaurant_id = reconciliations.restaurant_id
    join public.restaurant_staff cashier
      on cashier.id = shifts.opened_by
     and cashier.restaurant_id = shifts.restaurant_id
    where reconciliations.restaurant_id = target_restaurant_id
      and reconciliations.closed_at >= range_start
      and reconciliations.closed_at < range_end
  ),
  event_rows as (
    select
      logs.*,
      actor.display_name as actor_name,
      actor.employee_id
    from public.shift_activity_logs logs
    left join public.restaurant_staff actor
      on actor.id = logs.actor_staff_id
     and actor.restaurant_id = logs.restaurant_id
    where logs.restaurant_id = target_restaurant_id
      and logs.created_at >= range_start
      and logs.created_at < range_end
      and logs.action in (
        'shift_opened', 'shift_closed', 'expense_created', 'expense_approved', 'expense_rejected',
        'handover_initiated', 'handover_confirmed', 'handover_discrepancy'
      )
  )
  select jsonb_build_object(
    'generated_at', now(),
    'range_start', range_start,
    'range_end', range_end,
    'shifts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'cashier_id', cashier_id, 'cashier_name', cashier_name, 'employee_id', employee_id,
      'opened_at', opened_at, 'closed_at', closed_at, 'opening_cash', opening_cash,
      'cash_sales', cash_sales, 'cash_refunds', cash_refunds, 'non_cash_sales', non_cash_sales,
      'expense_count', expense_count, 'approved_expenses', approved_expenses,
      'pending_expenses', pending_expenses, 'rejected_expenses', rejected_expenses,
      'expected_cash', expected_cash, 'actual_cash', actual_cash, 'variance', variance,
      'status', status, 'reconciliation_status', reconciliation_status,
      'reconciliation_id', reconciliation_id, 'variance_reason', variance_reason, 'reconciled_at', reconciled_at
    ) order by opened_at desc) from shift_rows), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'shift_id', shift_id, 'cashier_id', cashier_staff_id, 'cashier_name', cashier_name,
      'employee_id', employee_id, 'amount', amount, 'reason', reason, 'note', note,
      'recorded_by', created_by, 'recorded_by_name', recorded_by_name, 'status', status,
      'reviewed_by', reviewed_by, 'reviewed_by_name', reviewed_by_name, 'reviewed_at', reviewed_at,
      'rejection_reason', rejection_reason, 'created_at', created_at,
      'created_in_period', created_in_period, 'reviewed_in_period', reviewed_in_period
    ) order by created_at desc) from expense_rows), '[]'::jsonb),
    'handovers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'outgoing_shift_id', outgoing_shift_id, 'incoming_shift_id', incoming_shift_id,
      'outgoing_cashier_id', outgoing_cashier_id, 'outgoing_name', outgoing_name,
      'outgoing_employee_id', outgoing_employee_id, 'incoming_cashier_id', incoming_cashier_id,
      'incoming_name', incoming_name, 'incoming_employee_id', incoming_employee_id,
      'expected_amount', expected_amount, 'declared_amount', declared_amount,
      'received_amount', received_amount, 'difference', difference, 'status', status,
      'initiated_at', initiated_at, 'confirmed_at', confirmed_at,
      'outgoing_note', outgoing_note, 'incoming_note', incoming_note,
      'initiated_in_period', initiated_in_period, 'confirmed_in_period', confirmed_in_period
    ) order by initiated_at desc) from handover_rows), '[]'::jsonb),
    'reconciliations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'shift_id', shift_id, 'cashier_id', cashier_id, 'cashier_name', cashier_name,
      'employee_id', employee_id, 'opening_cash', opening_cash, 'cash_payments', cash_payments,
      'cash_refunds', cash_refunds, 'expected_cash', expected_cash, 'actual_cash', actual_cash,
      'variance', variance, 'variance_reason', variance_reason, 'closed_at', closed_at, 'created_at', created_at
    ) order by closed_at desc) from reconciliation_rows), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'shift_id', shift_id, 'actor_staff_id', actor_staff_id,
      'actor_name', actor_name, 'employee_id', employee_id, 'action', action,
      'message', message, 'amount', amount, 'metadata', metadata, 'created_at', created_at
    ) order by created_at desc) from event_rows), '[]'::jsonb),
    'definitions', jsonb_build_object(
      'shift_inclusion', 'A shift appears when its open-to-close interval overlaps the selected half-open period; event lists still use their own timestamps.',
      'closed_drawer', 'Closed shift cash values come from immutable cash_reconciliations.',
      'open_drawer', 'Open shift expected cash comes from cashier_shift_drawer_totals and actual cash remains null.',
      'event_inclusion', 'Expenses, handovers, reconciliations and activity logs are selected by their own event timestamps.'
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_manager_cashier_period_report(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_manager_cashier_period_report(uuid, timestamptz, timestamptz)
  to authenticated, service_role;
