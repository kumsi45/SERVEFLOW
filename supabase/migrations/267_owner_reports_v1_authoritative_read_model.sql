-- Owner Reports V1: authoritative historical analysis and comparison backend.
-- This migration is read-only in business effect. It does not replace Finance,
-- mutate historical rows, or retire legacy reporting functions.

create or replace function public._owner_reports_assert_owner(target_restaurant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.restaurant_staff staff
    where staff.restaurant_id = target_restaurant_id
      and staff.user_id = auth.uid()
      and staff.active
      and staff.role::text = 'owner'
  ) then
    raise exception 'Owner report access is required.';
  end if;
end;
$$;

create or replace function public._owner_reports_quality(
  state text,
  period_completeness text,
  history text default 'modern',
  attribution text default 'not_applicable',
  legacy_count integer default 0,
  unknown_attribution_count integer default 0,
  excluded_count integer default 0,
  limitations jsonb default '[]'::jsonb,
  error_code text default null
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'state', state,
    'periodCompleteness', period_completeness,
    'history', history,
    'attribution', attribution,
    'legacyCount', legacy_count,
    'unknownAttributionCount', unknown_attribution_count,
    'excludedCount', excluded_count,
    'limitations', coalesce(limitations, '[]'::jsonb),
    'errorCode', error_code
  )
$$;

create or replace function public._owner_reports_resolve_period(
  target_restaurant_id uuid,
  requested_period text,
  custom_start_date date default null,
  custom_end_date date default null,
  anchor_time timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_period text := lower(btrim(coalesce(requested_period, '')));
  restaurant_timezone text;
  timezone_source text;
  local_now timestamp without time zone;
  local_today date;
  current_start_local timestamp without time zone;
  requested_end_local timestamp without time zone;
  effective_end_local timestamp without time zone;
  comparison_start_local timestamp without time zone;
  comparison_end_local timestamp without time zone;
  current_start timestamptz;
  requested_end timestamptz;
  current_end timestamptz;
  comparison_start timestamptz;
  comparison_end timestamptz;
  completeness text;
  comparison_alignment text;
  comparison_capped boolean := false;
  granularity text;
  custom_days integer;
  local_elapsed interval;
begin
  select
    coalesce(nullif(btrim(restaurants.profile->>'timezone'), ''), 'Africa/Nairobi'),
    case when nullif(btrim(restaurants.profile->>'timezone'), '') is null
      then 'established_default' else 'restaurant_profile' end
  into restaurant_timezone, timezone_source
  from public.restaurants
  where restaurants.id = target_restaurant_id;

  if restaurant_timezone is null then
    raise exception 'Owner report access is required.';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names zones
    where zones.name = restaurant_timezone
  ) then
    raise exception 'Restaurant timezone configuration is invalid.';
  end if;
  if normalized_period not in ('today', 'yesterday', 'week', 'month', 'custom') then
    raise exception 'Unsupported report period.';
  end if;

  local_now := anchor_time at time zone restaurant_timezone;
  local_today := local_now::date;

  if normalized_period = 'today' then
    current_start_local := local_today::timestamp;
    requested_end_local := (local_today + 1)::timestamp;
    effective_end_local := local_now;
    completeness := 'in_progress';
    comparison_start_local := current_start_local - interval '1 day';
    comparison_end_local := comparison_start_local + (local_now - current_start_local);
    comparison_alignment := 'same_stage_previous_local_day';
    granularity := 'hour';
  elsif normalized_period = 'yesterday' then
    current_start_local := (local_today - 1)::timestamp;
    requested_end_local := local_today::timestamp;
    effective_end_local := requested_end_local;
    completeness := 'complete';
    comparison_start_local := current_start_local - interval '1 day';
    comparison_end_local := current_start_local;
    comparison_alignment := 'previous_local_calendar_day';
    granularity := 'hour';
  elsif normalized_period = 'week' then
    current_start_local := date_trunc('week', local_now);
    requested_end_local := current_start_local + interval '7 days';
    effective_end_local := local_now;
    completeness := 'in_progress';
    comparison_start_local := current_start_local - interval '7 days';
    comparison_end_local := comparison_start_local + (local_now - current_start_local);
    comparison_alignment := 'same_stage_previous_local_week';
    granularity := 'day';
  elsif normalized_period = 'month' then
    current_start_local := date_trunc('month', local_now);
    requested_end_local := current_start_local + interval '1 month';
    effective_end_local := local_now;
    completeness := 'in_progress';
    comparison_start_local := current_start_local - interval '1 month';
    local_elapsed := local_now - current_start_local;
    comparison_end_local := least(comparison_start_local + local_elapsed, current_start_local);
    comparison_capped := comparison_start_local + local_elapsed > current_start_local;
    comparison_alignment := case when comparison_capped
      then 'same_stage_previous_local_month_capped'
      else 'same_stage_previous_local_month' end;
    granularity := 'day';
  else
    if custom_start_date is null or custom_end_date is null then
      raise exception 'Custom report dates are required.';
    end if;
    if custom_end_date < custom_start_date then
      raise exception 'Custom report end date cannot be before its start date.';
    end if;
    if custom_end_date > local_today then
      raise exception 'Custom report end date cannot be in the future.';
    end if;
    custom_days := custom_end_date - custom_start_date + 1;
    if custom_days > 366 then
      raise exception 'Custom report range cannot exceed 366 calendar days.';
    end if;
    current_start_local := custom_start_date::timestamp;
    requested_end_local := (custom_end_date + 1)::timestamp;
    if custom_end_date = local_today then
      effective_end_local := local_now;
      completeness := 'in_progress';
    else
      effective_end_local := requested_end_local;
      completeness := 'complete';
    end if;
    current_start := current_start_local at time zone restaurant_timezone;
    requested_end := requested_end_local at time zone restaurant_timezone;
    current_end := case when custom_end_date = local_today then anchor_time else requested_end end;
    comparison_end := current_start;
    comparison_start := comparison_end - (current_end - current_start);
    comparison_alignment := 'preceding_equal_elapsed_duration';
    granularity := case when custom_days = 1 then 'hour'
      when custom_days <= 62 then 'day' else 'week' end;
  end if;

  if normalized_period <> 'custom' then
    current_start := current_start_local at time zone restaurant_timezone;
    requested_end := requested_end_local at time zone restaurant_timezone;
    current_end := case when completeness = 'in_progress' then anchor_time else requested_end end;
    comparison_start := comparison_start_local at time zone restaurant_timezone;
    comparison_end := comparison_end_local at time zone restaurant_timezone;
  end if;

  if current_start >= current_end or comparison_start >= comparison_end then
    raise exception 'Resolved report period is invalid.';
  end if;

  return jsonb_build_object(
    'key', normalized_period,
    'timezone', restaurant_timezone,
    'timezoneSource', timezone_source,
    'currentStart', current_start,
    'currentEnd', current_end,
    'requestedEnd', requested_end,
    'comparisonStart', comparison_start,
    'comparisonEnd', comparison_end,
    'completeness', completeness,
    'comparisonAlignment', comparison_alignment,
    'comparisonCapped', comparison_capped,
    'durationSecondsEqual', extract(epoch from (current_end - current_start))
      = extract(epoch from (comparison_end - comparison_start)),
    'granularity', granularity,
    'boundarySemantics', 'half_open_absolute_timestamps',
    'anchorTime', anchor_time
  );
end;
$$;

create or replace function public.get_owner_reports_read_model(
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
  anchor_time timestamptz := statement_timestamp();
  resolved jsonb;
  restaurant_currency text;
  result jsonb;
begin
  perform public._owner_reports_assert_owner(target_restaurant_id);
  resolved := public._owner_reports_resolve_period(
    target_restaurant_id, requested_period, custom_start_date, custom_end_date, anchor_time
  );
  select coalesce(nullif(btrim(restaurants.currency_code), ''), 'ETB')
  into restaurant_currency
  from public.restaurants
  where restaurants.id = target_restaurant_id;

  with
  boundaries as (
    select
      (resolved->>'currentStart')::timestamptz current_start,
      (resolved->>'currentEnd')::timestamptz current_end,
      (resolved->>'comparisonStart')::timestamptz comparison_start,
      (resolved->>'comparisonEnd')::timestamptz comparison_end,
      resolved->>'timezone' restaurant_timezone,
      resolved->>'completeness' period_completeness,
      resolved->>'granularity' granularity
  ),
  periods(period_key, range_start, range_end) as (
    select 'current'::text, current_start, current_end from boundaries
    union all
    select 'comparison', comparison_start, comparison_end from boundaries
  ),
  collected_invoices as (
    select periods.period_key, invoices.id, invoices.order_id, invoices.paid_at,
      invoices.payment_method,
      public.normalize_payment_method(invoices.payment_method) normalized_payment_method,
      coalesce(invoices.grand_total, invoices.total_price, 0)::numeric amount,
      invoices.grand_total,
      invoices.financial_snapshot_version
    from periods
    join public.order_invoices invoices
      on invoices.restaurant_id = target_restaurant_id
     and invoices.payment_status in ('paid', 'refunded')
     and invoices.paid_at >= periods.range_start
     and invoices.paid_at < periods.range_end
  ),
  refund_events as (
    select periods.period_key, invoices.id,
      coalesce(invoices.grand_total, invoices.total_price, 0)::numeric amount
    from periods
    join public.order_invoices invoices
      on invoices.restaurant_id = target_restaurant_id
     and invoices.payment_status = 'refunded'
     and invoices.refunded_at >= periods.range_start
     and invoices.refunded_at < periods.range_end
  ),
  period_orders as (
    select periods.period_key, orders.*
    from periods
    join public.orders orders
      on orders.restaurant_id = target_restaurant_id
     and orders.created_at >= periods.range_start
     and orders.created_at < periods.range_end
  ),
  period_totals as (
    select periods.period_key,
      (select count(*)::integer from collected_invoices rows where rows.period_key=periods.period_key) collected_invoices,
      (select coalesce(sum(rows.amount),0)::numeric from collected_invoices rows where rows.period_key=periods.period_key) collected_sales,
      (select count(*)::integer from refund_events rows where rows.period_key=periods.period_key) refund_count,
      (select coalesce(sum(rows.amount),0)::numeric from refund_events rows where rows.period_key=periods.period_key) refund_amount,
      (select count(*)::integer from period_orders rows where rows.period_key=periods.period_key) orders_started
    from periods
  ),
  trend_buckets as (
    select series.bucket_start,
      lead(series.bucket_start, 1, (select current_end from boundaries)) over(order by series.bucket_start) bucket_end
    from boundaries
    cross join lateral (
      select generated bucket_start
      from generate_series(
        boundaries.current_start,
        boundaries.current_end - interval '1 microsecond',
        interval '1 hour'
      ) generated
      where boundaries.granularity = 'hour'
      union all
      select local_start at time zone boundaries.restaurant_timezone
      from generate_series(
        date_trunc('day', boundaries.current_start at time zone boundaries.restaurant_timezone),
        date_trunc('day', (boundaries.current_end - interval '1 microsecond') at time zone boundaries.restaurant_timezone),
        interval '1 day'
      ) local_start
      where boundaries.granularity = 'day'
      union all
      select local_start at time zone boundaries.restaurant_timezone
      from generate_series(
        date_trunc('week', boundaries.current_start at time zone boundaries.restaurant_timezone),
        date_trunc('week', (boundaries.current_end - interval '1 microsecond') at time zone boundaries.restaurant_timezone),
        interval '7 days'
      ) local_start
      where boundaries.granularity = 'week'
    ) series
  ),
  current_menu_lines as (
    select items.id, items.menu_item_id, items.quantity, items.price
    from collected_invoices invoices
    join public.order_items items
      on items.restaurant_id = target_restaurant_id
     and items.invoice_id = invoices.id
    where invoices.period_key = 'current'
      and items.kitchen_status <> 'cancelled'
  ),
  menu_sales as (
    select lines.menu_item_id, sum(lines.quantity)::integer quantity,
      sum(lines.quantity * lines.price)::numeric item_line_sales_value,
      count(distinct lines.id)::integer line_count
    from current_menu_lines lines
    group by lines.menu_item_id
  ),
  legacy_items as (
    select count(*)::integer item_count
    from public.order_items items
    where items.restaurant_id = target_restaurant_id and items.invoice_id is null
  ),
  current_order_sources as (
    select case
      when orders.order_source = 'public_qr' then 'customer_qr'
      when orders.order_source = 'waiter' then 'waiter'
      when orders.order_source = 'cashier' then 'cashier_pos'
      when orders.order_source = 'authenticated' then 'authenticated_customer_legacy'
      else 'unknown_legacy' end source_key,
      count(*)::integer orders_started
    from period_orders orders
    where orders.period_key = 'current'
    group by 1
  ),
  current_table_orders as (
    select case when orders.table_id is not null then 'table:' || orders.table_id::text
      when nullif(btrim(orders.table_number), '') is not null then 'legacy:' || btrim(orders.table_number)
      else 'unknown' end table_key,
      orders.table_id, nullif(btrim(orders.table_number), '') recorded_table_number,
      count(*)::integer orders_started
    from period_orders orders
    where orders.period_key = 'current'
    group by 1, orders.table_id, nullif(btrim(orders.table_number), '')
  ),
  current_table_collections as (
    select case when orders.table_id is not null then 'table:' || orders.table_id::text
      when nullif(btrim(orders.table_number), '') is not null then 'legacy:' || btrim(orders.table_number)
      else 'unknown' end table_key,
      orders.table_id, nullif(btrim(orders.table_number), '') recorded_table_number,
      count(invoices.id)::integer collected_invoices,
      sum(invoices.amount)::numeric collected_sales
    from collected_invoices invoices
    join public.orders orders
      on orders.restaurant_id = target_restaurant_id and orders.id = invoices.order_id
    where invoices.period_key = 'current'
    group by 1, orders.table_id, nullif(btrim(orders.table_number), '')
  ),
  current_payment_rows as (
    select invoices.id, invoices.amount, invoices.normalized_payment_method,
      configured.immutable_key, configured.method_code, configured.display_name, configured.enabled,
      case when invoices.normalized_payment_method is null then 'unknown_unclassified'
        when configured.immutable_key is not null then 'known_configured'
        else 'legacy_unrecognized' end classification
    from collected_invoices invoices
    left join lateral (
      select methods.immutable_key, methods.method_code, methods.display_name, methods.enabled
      from public.business_payment_methods methods
      where methods.restaurant_id = target_restaurant_id
        and (lower(public.normalize_payment_method(methods.display_name)) = lower(invoices.normalized_payment_method)
          or lower(public.normalize_payment_method(replace(methods.method_code, '_', ' '))) = lower(invoices.normalized_payment_method))
      order by case when lower(public.normalize_payment_method(methods.display_name)) = lower(invoices.normalized_payment_method) then 0 else 1 end,
        methods.id
      limit 1
    ) configured on true
    where invoices.period_key = 'current'
  ),
  payment_totals as (
    select immutable_key, method_code,
      case when classification = 'unknown_unclassified' then 'Unknown / unclassified'
        when classification = 'known_configured' then display_name
        else normalized_payment_method end display_label,
      enabled, classification, count(*)::integer invoice_count,
      sum(amount)::numeric collected_amount
    from current_payment_rows
    group by immutable_key, method_code,
      case when classification = 'unknown_unclassified' then 'Unknown / unclassified'
        when classification = 'known_configured' then display_name
        else normalized_payment_method end,
      enabled, classification
  ),
  completed_kitchen as (
    select items.*
    from public.order_items items, boundaries
    where items.restaurant_id = target_restaurant_id
      and items.kitchen_completed_at >= boundaries.current_start
      and items.kitchen_completed_at < boundaries.current_end
  ),
  kitchen_totals as (
    select count(*)::integer completed_items,
      count(*) filter(where kitchen_preparation_started_at is not null)::integer timed_items,
      count(*) filter(where kitchen_preparation_started_at is null)::integer untimed_items,
      avg(extract(epoch from (kitchen_completed_at - kitchen_preparation_started_at)) / 60)
        filter(where kitchen_preparation_started_at is not null)::numeric average_minutes,
      percentile_cont(0.5) within group(order by extract(epoch from (kitchen_completed_at - kitchen_preparation_started_at)) / 60)
        filter(where kitchen_preparation_started_at is not null)::numeric median_minutes
    from completed_kitchen
  ),
  kitchen_stations as (
    select items.kitchen_station_id station_id, coalesce(nullif(stations.name, ''), 'Unknown / historical station') station_name,
      count(*)::integer completed_items,
      count(*) filter(where items.kitchen_preparation_started_at is not null)::integer timed_items,
      avg(extract(epoch from (items.kitchen_completed_at - items.kitchen_preparation_started_at)) / 60)
        filter(where items.kitchen_preparation_started_at is not null)::numeric average_minutes,
      percentile_cont(0.5) within group(order by extract(epoch from (items.kitchen_completed_at - items.kitchen_preparation_started_at)) / 60)
        filter(where items.kitchen_preparation_started_at is not null)::numeric median_minutes
    from completed_kitchen items
    left join public.kitchen_stations stations
      on stations.restaurant_id = items.restaurant_id and stations.id = items.kitchen_station_id
    group by items.kitchen_station_id, coalesce(nullif(stations.name, ''), 'Unknown / historical station')
  ),
  feedback_periods as (
    select periods.period_key, count(feedback.id)::integer review_count,
      avg(feedback.rating)::numeric average_rating
    from periods
    left join public.public_order_feedback feedback
      on feedback.restaurant_id = target_restaurant_id
     and feedback.created_at >= periods.range_start
     and feedback.created_at < periods.range_end
    group by periods.period_key
  ),
  current_ratings as (
    select ratings.rating, count(feedback.id)::integer review_count
    from generate_series(1, 5) ratings(rating)
    left join public.public_order_feedback feedback on feedback.restaurant_id = target_restaurant_id
      and feedback.rating = ratings.rating
      and feedback.created_at >= (select current_start from boundaries)
      and feedback.created_at < (select current_end from boundaries)
    group by ratings.rating
  ),
  data_quality as (
    select
      count(*) filter(where invoices.grand_total is null or invoices.financial_snapshot_version is distinct from 'frozen_v1')::integer legacy_financial_count,
      (select count(*)::integer from public.order_invoices i where i.restaurant_id = target_restaurant_id
        and i.payment_status = 'refunded' and i.refunded_at is null) untimed_refund_count,
      (select count(*)::integer from current_payment_rows where classification = 'unknown_unclassified') unknown_method_count,
      (select count(*)::integer from current_payment_rows where classification = 'legacy_unrecognized') legacy_method_count,
      (select count(*)::integer from period_orders where period_key = 'current'
        and coalesce(order_source,'') not in ('public_qr','waiter','cashier','authenticated')) unknown_source_count
    from collected_invoices invoices
    where invoices.period_key = 'current'
  )
  select jsonb_build_object(
    'contractVersion', 'owner_reports_v1',
    'generatedAt', anchor_time,
    'currency', restaurant_currency,
    'period', resolved - 'anchorTime',
    'summary', jsonb_build_object(
      'collectedSales', current_totals.collected_sales,
      'collectedInvoices', current_totals.collected_invoices,
      'averageCollectedInvoice', case when current_totals.collected_invoices = 0 then null
        else round(current_totals.collected_sales / current_totals.collected_invoices, 2) end,
      'ordersStarted', current_totals.orders_started,
      'refundAmount', current_totals.refund_amount,
      'refundCount', current_totals.refund_count,
      'comparison', jsonb_build_object(
        'collectedSales', comparison_totals.collected_sales,
        'collectedInvoices', comparison_totals.collected_invoices,
        'averageCollectedInvoice', case when comparison_totals.collected_invoices = 0 then null
          else round(comparison_totals.collected_sales / comparison_totals.collected_invoices, 2) end,
        'ordersStarted', comparison_totals.orders_started,
        'refundAmount', comparison_totals.refund_amount,
        'refundCount', comparison_totals.refund_count,
        'collectedSalesPercentChange', case when comparison_totals.collected_sales = 0 then null
          else round((current_totals.collected_sales - comparison_totals.collected_sales)
            / comparison_totals.collected_sales * 100, 2) end
      ),
      'quality', public._owner_reports_quality(
        case when current_totals.collected_invoices = 0 and current_totals.orders_started = 0
          and current_totals.refund_count = 0 then 'no_activity'
          when data_quality.legacy_financial_count > 0 or data_quality.untimed_refund_count > 0 then 'partial'
          else 'available' end,
        boundaries.period_completeness,
        case when data_quality.legacy_financial_count > 0 or data_quality.untimed_refund_count > 0
          then 'legacy_limited' else 'modern' end,
        'not_applicable', data_quality.legacy_financial_count + data_quality.untimed_refund_count, 0, 0,
        case when data_quality.untimed_refund_count > 0
          then jsonb_build_array('Legacy refunds without refunded_at cannot be assigned to a report period.')
          else '[]'::jsonb end
      )
    ),
    'salesAndOrders', jsonb_build_object(
      'granularity', boundaries.granularity,
      'buckets', coalesce((select jsonb_agg(jsonb_build_object(
        'bucketStart', buckets.bucket_start,
        'bucketLocalStart', (buckets.bucket_start at time zone boundaries.restaurant_timezone)::text,
        'collectedSales', coalesce((select sum(i.amount) from collected_invoices i
          where i.period_key = 'current' and i.paid_at >= buckets.bucket_start and i.paid_at < buckets.bucket_end), 0),
        'collectedInvoices', coalesce((select count(*) from collected_invoices i
          where i.period_key = 'current' and i.paid_at >= buckets.bucket_start and i.paid_at < buckets.bucket_end), 0),
        'ordersStarted', coalesce((select count(*) from period_orders o
          where o.period_key = 'current' and o.created_at >= buckets.bucket_start and o.created_at < buckets.bucket_end), 0)
      ) order by buckets.bucket_start) from trend_buckets buckets), '[]'::jsonb),
      'quality', public._owner_reports_quality(
        case when current_totals.collected_invoices = 0 and current_totals.orders_started = 0 then 'no_activity' else 'available' end,
        boundaries.period_completeness
      )
    ),
    'menu', jsonb_build_object(
      'identityBasis', 'current_catalog',
      'topSelling', coalesce((select jsonb_agg(row_data order by quantity desc, item_line_sales_value desc, menu_item_id) from (
        select jsonb_build_object('menuItemKey', sales.menu_item_id, 'name', coalesce(nullif(items.name,''), 'Unavailable historical item'),
          'category', coalesce(nullif(categories.name,''), 'Uncategorized / historical'), 'archived', items.archived_at is not null,
          'quantity', sales.quantity, 'itemLineSalesValue', sales.item_line_sales_value) row_data,
          sales.quantity, sales.item_line_sales_value, sales.menu_item_id
        from menu_sales sales
        left join public.menu_items items on items.restaurant_id = target_restaurant_id and items.id = sales.menu_item_id
        left join public.categories categories on categories.restaurant_id = items.restaurant_id and categories.id = items.category_id
        order by sales.quantity desc, sales.item_line_sales_value desc, sales.menu_item_id limit 10
      ) ranked), '[]'::jsonb),
      'currentMenuItemsWithLowestRecordedSales', coalesce((select jsonb_agg(row_data order by quantity, item_line_sales_value, menu_item_id) from (
        select jsonb_build_object('menuItemKey', items.id, 'name', items.name,
          'category', coalesce(nullif(categories.name,''), 'Uncategorized'),
          'quantity', coalesce(sales.quantity,0), 'itemLineSalesValue', coalesce(sales.item_line_sales_value,0)) row_data,
          coalesce(sales.quantity,0) quantity, coalesce(sales.item_line_sales_value,0) item_line_sales_value, items.id menu_item_id
        from public.menu_items items
        left join public.categories categories on categories.restaurant_id = items.restaurant_id and categories.id = items.category_id
        left join menu_sales sales on sales.menu_item_id = items.id
        where items.restaurant_id = target_restaurant_id and items.available and items.archived_at is null
        order by coalesce(sales.quantity,0), coalesce(sales.item_line_sales_value,0), items.id limit 10
      ) lowest), '[]'::jsonb),
      'categories', coalesce((select jsonb_agg(row_data order by quantity desc, category_key) from (
        select jsonb_build_object(
          'categoryKey', coalesce(items.category_id::text,'uncategorized'),
          'name', coalesce(nullif(categories.name,''),'Uncategorized / historical'),
          'quantity', sum(lines.quantity), 'itemLineSalesValue', sum(lines.quantity * lines.price)
        ) row_data, sum(lines.quantity) quantity, coalesce(items.category_id::text,'uncategorized') category_key
        from current_menu_lines lines
        left join public.menu_items items on items.restaurant_id = target_restaurant_id and items.id = lines.menu_item_id
        left join public.categories categories on categories.restaurant_id = items.restaurant_id and categories.id = items.category_id
        group by items.category_id, categories.name
        order by sum(lines.quantity) desc, coalesce(items.category_id::text,'uncategorized') limit 20
      ) category_rows), '[]'::jsonb),
      'legacyUnattributedItemCount', legacy_items.item_count,
      'quality', public._owner_reports_quality(
        case when legacy_items.item_count > 0 then 'partial'
          when not exists(select 1 from current_menu_lines) then 'no_activity' else 'available' end,
        boundaries.period_completeness,
        case when legacy_items.item_count > 0 then 'legacy_limited' else 'modern' end,
        'complete', legacy_items.item_count, 0, 0,
        jsonb_build_array(
          'Names and categories use the current catalog because immutable historical name/category snapshots do not exist.',
          'Current menu items with lowest recorded sales use the current catalog; historical availability is not tracked.',
          'Item-line sales value is not equal to accounting collected sales.'
        )
      )
    ),
    'operations', jsonb_build_object(
      'orderSources', coalesce((select jsonb_agg(jsonb_build_object(
        'source', source_key, 'ordersStarted', orders_started
      ) order by orders_started desc, source_key) from current_order_sources), '[]'::jsonb),
      'tableActivity', jsonb_build_object(
        'busiestByOrdersStarted', coalesce((select jsonb_agg(row_data order by orders_started desc, table_key) from (
          select jsonb_build_object('tableKey', source.table_key,
            'label', case when source.table_key='unknown' then 'Unknown / Non-table activity'
              else coalesce(tables.table_number::text, source.recorded_table_number, 'Unknown / Non-table activity') end,
            'identityBasis', case when source.table_id is not null then 'stable_table_id'
              when source.recorded_table_number is not null then 'recorded_table_number_legacy' else 'unknown' end,
            'ordersStarted', source.orders_started) row_data, source.orders_started, source.table_key
          from current_table_orders source
          left join public.restaurant_tables tables on tables.restaurant_id=target_restaurant_id and tables.id=source.table_id
          order by source.orders_started desc, source.table_key limit 10
        ) rows), '[]'::jsonb),
        'topByCollectedSales', coalesce((select jsonb_agg(row_data order by collected_sales desc, table_key) from (
          select jsonb_build_object('tableKey', source.table_key,
            'label', case when source.table_key='unknown' then 'Unknown / Non-table activity'
              else coalesce(tables.table_number::text, source.recorded_table_number, 'Unknown / Non-table activity') end,
            'identityBasis', case when source.table_id is not null then 'stable_table_id'
              when source.recorded_table_number is not null then 'recorded_table_number_legacy' else 'unknown' end,
            'collectedSales', source.collected_sales, 'collectedInvoices', source.collected_invoices) row_data,
            source.collected_sales, source.table_key
          from current_table_collections source
          left join public.restaurant_tables tables on tables.restaurant_id=target_restaurant_id and tables.id=source.table_id
          order by source.collected_sales desc, source.table_key limit 10
        ) rows), '[]'::jsonb)
      ),
      'kitchen', jsonb_build_object(
        'completedItems', kitchen_totals.completed_items,
        'timedItems', kitchen_totals.timed_items,
        'untimedItems', kitchen_totals.untimed_items,
        'timingCoveragePercent', case when kitchen_totals.completed_items=0 then null
          else round(kitchen_totals.timed_items::numeric/kitchen_totals.completed_items*100,2) end,
        'averagePreparationMinutes', round(kitchen_totals.average_minutes,2),
        'medianPreparationMinutes', round(kitchen_totals.median_minutes,2),
        'stations', coalesce((select jsonb_agg(jsonb_build_object(
          'stationKey', coalesce(station_id::text,'unknown'), 'name', station_name,
          'identityBasis','current_station_catalog','completedItems',completed_items,'timedItems',timed_items,
          'averagePreparationMinutes',round(average_minutes,2),'medianPreparationMinutes',round(median_minutes,2)
        ) order by completed_items desc, coalesce(station_id::text,'unknown')) from kitchen_stations), '[]'::jsonb),
        'quality', public._owner_reports_quality(
          case when kitchen_totals.completed_items=0 then 'no_activity'
            when kitchen_totals.untimed_items>0 then 'partial' else 'available' end,
          boundaries.period_completeness,
          case when kitchen_totals.untimed_items>0 then 'legacy_limited' else 'modern' end,
          'not_applicable', kitchen_totals.untimed_items, 0, 0,
          jsonb_build_array('Station names use the current station catalog; historical station-name snapshots do not exist.')
        )
      ),
      'quality', public._owner_reports_quality(
        case when current_totals.orders_started=0 and kitchen_totals.completed_items=0 then 'no_activity'
          when data_quality.unknown_source_count>0 then 'partial' else 'available' end,
        boundaries.period_completeness,
        case when data_quality.unknown_source_count>0 then 'legacy_limited' else 'modern' end,
        case when data_quality.unknown_source_count>0 then 'unknown_present' else 'complete' end,
        0, data_quality.unknown_source_count
      )
    ),
    'payments', jsonb_build_object(
      'methods', coalesce((select jsonb_agg(jsonb_build_object(
        'methodIdentity', immutable_key, 'methodCode', method_code, 'displayLabel', display_label,
        'classification', classification, 'currentlyEnabled', enabled,
        'collectedAmount', collected_amount, 'collectedInvoices', invoice_count,
        'sharePercent', case when current_totals.collected_sales=0 then null
          else round(collected_amount/current_totals.collected_sales*100,2) end
      ) order by collected_amount desc, display_label) from payment_totals), '[]'::jsonb),
      'quality', public._owner_reports_quality(
        case when current_totals.collected_invoices=0 then 'no_activity'
          when data_quality.unknown_method_count+data_quality.legacy_method_count>0 then 'partial' else 'available' end,
        boundaries.period_completeness,
        case when data_quality.legacy_method_count>0 then 'legacy_limited' else 'modern' end,
        case when data_quality.unknown_method_count>0 then 'unknown_present' else 'complete' end,
        data_quality.legacy_method_count, data_quality.unknown_method_count
      )
    ),
    'feedback', jsonb_build_object(
      'reviewCount', current_feedback.review_count,
      'averageOrderExperienceRating', round(current_feedback.average_rating,2),
      'ratingDistribution', (select jsonb_agg(jsonb_build_object('rating',rating,'reviewCount',review_count) order by rating) from current_ratings),
      'comparison', jsonb_build_object('reviewCount',comparison_feedback.review_count,
        'averageOrderExperienceRating',round(comparison_feedback.average_rating,2)),
      'detailAvailable', true,
      'quality', public._owner_reports_quality(
        case when current_feedback.review_count=0 then 'no_activity' else 'available' end,
        boundaries.period_completeness
      )
    ),
    'detailAvailability', jsonb_build_object('feedbackPage',true,'staffOperationsPage',true),
    'definitions', jsonb_build_object(
      'collectedSales','Paid settlement events at paid_at using Finance F2 amount semantics; not accounting revenue.',
      'refunds','Full refunded invoice value at refunded_at; untimed legacy refunds are not assigned to a period.',
      'ordersStarted','Persisted orders created in the selected period, including orders cancelled later.',
      'itemLineSalesValue','Non-cancelled item quantity multiplied by stored order-time unit price; no allocation of discounts, tax, service charge, refunds, or cost.',
      'kitchenPreparation','Duration from kitchen_preparation_started_at to kitchen_completed_at for timed completed items only.',
      'financialShift','Cash-drawer responsibility; never attendance or hours worked.',
      'cashHandover','Existing full expected-drawer cashier-to-cashier custody event; never a sale or collection.'
    )
  ) into result
  from period_totals current_totals
  join period_totals comparison_totals on comparison_totals.period_key='comparison'
  cross join boundaries
  cross join legacy_items
  cross join kitchen_totals
  join feedback_periods current_feedback on current_feedback.period_key='current'
  join feedback_periods comparison_feedback on comparison_feedback.period_key='comparison'
  cross join data_quality
  where current_totals.period_key='current';

  return result;
end;
$$;

create or replace function public.get_owner_report_feedback_page(
  target_restaurant_id uuid,
  requested_period text,
  custom_start_date date default null,
  custom_end_date date default null,
  page_size integer default 25,
  cursor_created_at timestamptz default null,
  cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved jsonb;
  effective_size integer := coalesce(page_size,25);
  rows jsonb;
  next_created_at timestamptz;
  next_id uuid;
  has_more boolean;
begin
  perform public._owner_reports_assert_owner(target_restaurant_id);
  if effective_size < 1 or effective_size > 100 then raise exception 'Feedback page size must be between 1 and 100.'; end if;
  if (cursor_created_at is null) <> (cursor_id is null) then raise exception 'Feedback cursor is incomplete.'; end if;
  resolved := public._owner_reports_resolve_period(target_restaurant_id,requested_period,custom_start_date,custom_end_date,statement_timestamp());

  with selected as (
    select feedback.id, feedback.rating, feedback.reactions, feedback.comment,
      feedback.photo_url is not null as has_photo, feedback.created_at
    from public.public_order_feedback feedback
    where feedback.restaurant_id=target_restaurant_id
      and feedback.created_at >= (resolved->>'currentStart')::timestamptz
      and feedback.created_at < (resolved->>'currentEnd')::timestamptz
      and (cursor_created_at is null or (feedback.created_at,feedback.id) < (cursor_created_at,cursor_id))
    order by feedback.created_at desc, feedback.id desc
    limit effective_size+1
  ), page_rows as (
    select * from selected order by created_at desc,id desc limit effective_size
  )
  select coalesce(jsonb_agg(jsonb_build_object('rating',rating,'reactions',reactions,'comment',comment,
      'hasPhoto',has_photo,'submittedAt',created_at) order by created_at desc,id desc),'[]'::jsonb),
    (select created_at from page_rows order by created_at,id limit 1),
    (select id from page_rows order by created_at,id limit 1),
    (select count(*)>effective_size from selected)
  into rows,next_created_at,next_id,has_more
  from page_rows;

  return jsonb_build_object('contractVersion','owner_reports_v1','period',resolved-'anchorTime','items',rows,
    'nextCursor',case when has_more then jsonb_build_object('createdAt',next_created_at,'id',next_id) else null end,
    'quality',public._owner_reports_quality(case when jsonb_array_length(rows)=0 then 'no_activity' else 'available' end,resolved->>'completeness'));
end;
$$;

create or replace function public.get_owner_report_staff_operations_page(
  target_restaurant_id uuid,
  requested_period text,
  custom_start_date date default null,
  custom_end_date date default null,
  page_size integer default 50,
  cursor_role text default null,
  cursor_display_name text default null,
  cursor_staff_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  resolved jsonb;
  effective_size integer := coalesce(page_size,50);
  rows jsonb;
  next_role text;
  next_name text;
  next_id uuid;
  has_more boolean;
  completeness text;
  current_start timestamptz;
  current_end timestamptz;
  comparison_start timestamptz;
  comparison_end timestamptz;
  unattributed jsonb;
begin
  perform public._owner_reports_assert_owner(target_restaurant_id);
  if effective_size < 1 or effective_size > 100 then raise exception 'Staff Operations page size must be between 1 and 100.'; end if;
  if num_nonnulls(cursor_role,cursor_display_name,cursor_staff_id) not in (0,3) then raise exception 'Staff Operations cursor is incomplete.'; end if;
  resolved := public._owner_reports_resolve_period(target_restaurant_id,requested_period,custom_start_date,custom_end_date,statement_timestamp());
  completeness := resolved->>'completeness';
  current_start := (resolved->>'currentStart')::timestamptz;
  current_end := (resolved->>'currentEnd')::timestamptz;
  comparison_start := (resolved->>'comparisonStart')::timestamptz;
  comparison_end := (resolved->>'comparisonEnd')::timestamptz;

  with candidates as (
    select staff.id, staff.role::text role,
      coalesce(nullif(btrim(staff.display_name),''),case staff.role::text when 'waiter' then 'Former waiter'
        when 'cashier' then 'Former cashier' else 'Former kitchen staff' end) display_name,
      lower(coalesce(nullif(btrim(staff.display_name),''),case staff.role::text when 'waiter' then 'former waiter'
        when 'cashier' then 'former cashier' else 'former kitchen staff' end)) normalized_name,
      staff.employee_id, case when staff.active then 'active' else 'inactive' end membership_state
    from public.restaurant_staff staff
    where staff.restaurant_id=target_restaurant_id and staff.role::text in ('waiter','cashier','kitchen')
      and (cursor_role is null or (staff.role::text,
        lower(coalesce(nullif(btrim(staff.display_name),''),case staff.role::text when 'waiter' then 'former waiter'
          when 'cashier' then 'former cashier' else 'former kitchen staff' end)),staff.id)
        > (cursor_role,lower(cursor_display_name),cursor_staff_id))
    order by role,normalized_name,id limit effective_size+1
  ), page_staff as (
    select * from candidates order by role,normalized_name,id limit effective_size
  ), facts as (
    select staff.*,
      case staff.role
        when 'waiter' then jsonb_build_object(
          'ordersTaken',(select count(*) from public.orders o where o.restaurant_id=target_restaurant_id and o.created_by_waiter_id=staff.id and o.created_at>=current_start and o.created_at<current_end))
        when 'cashier' then jsonb_build_object(
          'settlementsHandled',(select count(*) from public.order_invoices i where i.restaurant_id=target_restaurant_id and i.verified_by=staff.id and i.payment_status in('paid','refunded') and i.paid_at>=current_start and i.paid_at<current_end),
          'collectedAmountHandled',(select coalesce(sum(coalesce(i.grand_total,i.total_price,0)),0) from public.order_invoices i where i.restaurant_id=target_restaurant_id and i.verified_by=staff.id and i.payment_status in('paid','refunded') and i.paid_at>=current_start and i.paid_at<current_end),
          'financialShiftsOpened',(select count(*) from public.cashier_shifts s where s.restaurant_id=target_restaurant_id and s.opened_by=staff.id and s.opened_at>=current_start and s.opened_at<current_end),
          'financialShiftsClosed',(select count(*) from public.cashier_shifts s where s.restaurant_id=target_restaurant_id and s.opened_by=staff.id and s.closed_at>=current_start and s.closed_at<current_end),
          'reconciliationsCompleted',(select count(*) from public.cash_reconciliations r join public.cashier_shifts s on s.restaurant_id=r.restaurant_id and s.id=r.shift_id where r.restaurant_id=target_restaurant_id and s.opened_by=staff.id and r.closed_at>=current_start and r.closed_at<current_end),
          'recordedVariance',(select coalesce(sum(r.variance),0) from public.cash_reconciliations r join public.cashier_shifts s on s.restaurant_id=r.restaurant_id and s.id=r.shift_id where r.restaurant_id=target_restaurant_id and s.opened_by=staff.id and r.closed_at>=current_start and r.closed_at<current_end),
          'expensesRecorded',(select count(*) from public.cashier_shift_expenses e where e.restaurant_id=target_restaurant_id and e.cashier_staff_id=staff.id and e.created_at>=current_start and e.created_at<current_end),
          'handoversInitiated',(select count(*) from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.outgoing_cashier_id=staff.id and h.initiated_at>=current_start and h.initiated_at<current_end),
          'handoversConfirmed',(select count(*) from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.incoming_cashier_id=staff.id and h.status='confirmed' and h.confirmed_at>=current_start and h.confirmed_at<current_end),
          'handoverDiscrepancies',(select count(*) from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.incoming_cashier_id=staff.id and h.status='discrepancy' and h.confirmed_at>=current_start and h.confirmed_at<current_end))
        else jsonb_build_object('itemsCompleted',(select count(*) from public.order_items i where i.restaurant_id=target_restaurant_id and i.kitchen_completed_by=staff.id and i.kitchen_completed_at>=current_start and i.kitchen_completed_at<current_end))
      end operations,
      case staff.role
        when 'waiter' then jsonb_build_object('ordersTaken',(select count(*) from public.orders o where o.restaurant_id=target_restaurant_id and o.created_by_waiter_id=staff.id and o.created_at>=comparison_start and o.created_at<comparison_end))
        when 'cashier' then jsonb_build_object(
          'settlementsHandled',(select count(*) from public.order_invoices i where i.restaurant_id=target_restaurant_id and i.verified_by=staff.id and i.payment_status in('paid','refunded') and i.paid_at>=comparison_start and i.paid_at<comparison_end),
          'collectedAmountHandled',(select coalesce(sum(coalesce(i.grand_total,i.total_price,0)),0) from public.order_invoices i where i.restaurant_id=target_restaurant_id and i.verified_by=staff.id and i.payment_status in('paid','refunded') and i.paid_at>=comparison_start and i.paid_at<comparison_end),
          'financialShiftsOpened',(select count(*) from public.cashier_shifts s where s.restaurant_id=target_restaurant_id and s.opened_by=staff.id and s.opened_at>=comparison_start and s.opened_at<comparison_end),
          'financialShiftsClosed',(select count(*) from public.cashier_shifts s where s.restaurant_id=target_restaurant_id and s.opened_by=staff.id and s.closed_at>=comparison_start and s.closed_at<comparison_end),
          'reconciliationsCompleted',(select count(*) from public.cash_reconciliations r join public.cashier_shifts s on s.restaurant_id=r.restaurant_id and s.id=r.shift_id where r.restaurant_id=target_restaurant_id and s.opened_by=staff.id and r.closed_at>=comparison_start and r.closed_at<comparison_end),
          'recordedVariance',(select coalesce(sum(r.variance),0) from public.cash_reconciliations r join public.cashier_shifts s on s.restaurant_id=r.restaurant_id and s.id=r.shift_id where r.restaurant_id=target_restaurant_id and s.opened_by=staff.id and r.closed_at>=comparison_start and r.closed_at<comparison_end),
          'expensesRecorded',(select count(*) from public.cashier_shift_expenses e where e.restaurant_id=target_restaurant_id and e.cashier_staff_id=staff.id and e.created_at>=comparison_start and e.created_at<comparison_end),
          'handoversInitiated',(select count(*) from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.outgoing_cashier_id=staff.id and h.initiated_at>=comparison_start and h.initiated_at<comparison_end),
          'handoversConfirmed',(select count(*) from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.incoming_cashier_id=staff.id and h.status='confirmed' and h.confirmed_at>=comparison_start and h.confirmed_at<comparison_end),
          'handoverDiscrepancies',(select count(*) from public.cashier_cash_handovers h where h.restaurant_id=target_restaurant_id and h.incoming_cashier_id=staff.id and h.status='discrepancy' and h.confirmed_at>=comparison_start and h.confirmed_at<comparison_end))
        else jsonb_build_object('itemsCompleted',(select count(*) from public.order_items i where i.restaurant_id=target_restaurant_id and i.kitchen_completed_by=staff.id and i.kitchen_completed_at>=comparison_start and i.kitchen_completed_at<comparison_end))
      end comparison_operations
    from page_staff staff
  )
  select coalesce(jsonb_agg(jsonb_build_object('role',role,'displayName',display_name,'employeeId',employee_id,
      'membershipState',membership_state,'operations',operations,'comparisonOperations',comparison_operations)
      order by role,normalized_name,id),'[]'::jsonb),
    (select role from page_staff order by role desc,normalized_name desc,id desc limit 1),
    (select normalized_name from page_staff order by role desc,normalized_name desc,id desc limit 1),
    (select id from page_staff order by role desc,normalized_name desc,id desc limit 1),
    (select count(*)>effective_size from candidates)
  into rows,next_role,next_name,next_id,has_more from facts;

  select jsonb_build_object(
    'waiterOrdersTaken',(select count(*) from public.orders o where o.restaurant_id=target_restaurant_id and o.created_by_waiter_id is null and o.created_at>=current_start and o.created_at<current_end),
    'cashierSettlements',(select count(*) from public.order_invoices i where i.restaurant_id=target_restaurant_id and i.verified_by is null and i.payment_status in('paid','refunded') and i.paid_at>=current_start and i.paid_at<current_end),
    'kitchenItemsCompleted',(select count(*) from public.order_items i where i.restaurant_id=target_restaurant_id and i.kitchen_completed_by is null and i.kitchen_completed_at>=current_start and i.kitchen_completed_at<current_end)
  ) into unattributed;

  return jsonb_build_object('contractVersion','owner_reports_v1','period',resolved-'anchorTime','items',rows,
    'unattributedHistoricalActivity',unattributed,
    'nextCursor',case when has_more then jsonb_build_object('role',next_role,'displayName',next_name,'staffId',next_id) else null end,
    'quality',public._owner_reports_quality(
      case when jsonb_array_length(rows)=0 and ((unattributed->>'waiterOrdersTaken')::int+(unattributed->>'cashierSettlements')::int+(unattributed->>'kitchenItemsCompleted')::int)=0 then 'no_activity'
        when ((unattributed->>'waiterOrdersTaken')::int+(unattributed->>'cashierSettlements')::int+(unattributed->>'kitchenItemsCompleted')::int)>0 then 'partial' else 'available' end,
      completeness,'modern',case when ((unattributed->>'waiterOrdersTaken')::int+(unattributed->>'cashierSettlements')::int+(unattributed->>'kitchenItemsCompleted')::int)>0 then 'unknown_present' else 'complete' end,
      0,((unattributed->>'waiterOrdersTaken')::int+(unattributed->>'cashierSettlements')::int+(unattributed->>'kitchenItemsCompleted')::int)));
end;
$$;

comment on function public.get_owner_reports_read_model(uuid,text,date,date) is
  'Owner-only authoritative Reports V1 aggregate. Historical analysis only; read-only in business effect.';
comment on function public.get_owner_report_feedback_page(uuid,text,date,date,integer,timestamptz,uuid) is
  'Owner-only keyset-paginated order-experience feedback detail for Reports V1.';
comment on function public.get_owner_report_staff_operations_page(uuid,text,date,date,integer,text,text,uuid) is
  'Owner-only keyset-paginated role-specific historical Staff Operations facts; never attendance or ranking.';

revoke all on function public._owner_reports_assert_owner(uuid) from public, anon, authenticated;
revoke all on function public._owner_reports_quality(text,text,text,text,integer,integer,integer,jsonb,text) from public, anon, authenticated;
revoke all on function public._owner_reports_resolve_period(uuid,text,date,date,timestamptz) from public, anon, authenticated;

revoke all on function public.get_owner_reports_read_model(uuid,text,date,date) from public, anon, authenticated;
revoke all on function public.get_owner_report_feedback_page(uuid,text,date,date,integer,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.get_owner_report_staff_operations_page(uuid,text,date,date,integer,text,text,uuid) from public, anon, authenticated;

grant execute on function public.get_owner_reports_read_model(uuid,text,date,date) to authenticated;
grant execute on function public.get_owner_report_feedback_page(uuid,text,date,date,integer,timestamptz,uuid) to authenticated;
grant execute on function public.get_owner_report_staff_operations_page(uuid,text,date,date,integer,text,text,uuid) to authenticated;
