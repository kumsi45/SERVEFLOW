-- Owner Finance F2: one narrow, side-effect-free financial control read model.
-- Period event metrics use caller-supplied half-open timestamptz boundaries.
-- Current obligations and open drawer controls are deliberately not period-filtered.

create or replace function public.get_owner_finance_read_model(
  target_restaurant_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  comparison_start timestamptz,
  comparison_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  restaurant_timezone text;
  timezone_source text;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if target_restaurant_id is null
    or not public.owner_can_report(target_restaurant_id)
  then
    raise exception 'Permission denied.';
  end if;

  if period_start is null
    or period_end is null
    or comparison_start is null
    or comparison_end is null
    or period_start >= period_end
    or comparison_start >= comparison_end
    or comparison_end > period_start
  then
    raise exception 'Invalid or overlapping finance periods.';
  end if;

  select
    coalesce(nullif(btrim(restaurants.profile->>'timezone'), ''), 'Africa/Nairobi'),
    case
      when nullif(btrim(restaurants.profile->>'timezone'), '') is null
        then 'established_default'
      else 'restaurant_profile'
    end
  into restaurant_timezone, timezone_source
  from public.restaurants
  where restaurants.id = target_restaurant_id;

  if restaurant_timezone is null then
    raise exception 'Restaurant not found.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names timezone_names
    where timezone_names.name = restaurant_timezone
  ) then
    raise exception 'Restaurant timezone configuration is invalid.';
  end if;

  with
  periods(period_key, range_start, range_end) as (
    values
      ('current'::text, period_start, period_end),
      ('comparison'::text, comparison_start, comparison_end)
  ),
  collected_invoices as (
    select
      periods.period_key,
      invoices.id,
      invoices.restaurant_id,
      invoices.order_id,
      invoices.paid_at,
      invoices.payment_method,
      public.normalize_payment_method(invoices.payment_method) as normalized_payment_method,
      coalesce(invoices.grand_total, invoices.total_price, 0)::numeric as amount,
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
    select
      periods.period_key,
      invoices.id,
      invoices.refunded_at,
      coalesce(invoices.grand_total, invoices.total_price, 0)::numeric as amount,
      invoices.grand_total,
      invoices.financial_snapshot_version
    from periods
    join public.order_invoices invoices
      on invoices.restaurant_id = target_restaurant_id
     and invoices.payment_status = 'refunded'
     and invoices.refunded_at >= periods.range_start
     and invoices.refunded_at < periods.range_end
  ),
  current_obligations as (
    select
      invoices.id,
      invoices.payment_status,
      coalesce(invoices.grand_total, invoices.total_price, 0)::numeric as amount,
      invoices.grand_total,
      invoices.financial_snapshot_version
    from public.order_invoices invoices
    where invoices.restaurant_id = target_restaurant_id
      and invoices.payment_status in ('pending', 'held')
  ),
  collection_totals as (
    select
      periods.period_key,
      count(collected_invoices.id)::integer as invoice_count,
      coalesce(sum(collected_invoices.amount), 0)::numeric as collected_amount
    from periods
    left join collected_invoices
      on collected_invoices.period_key = periods.period_key
    group by periods.period_key
  ),
  refund_totals as (
    select
      periods.period_key,
      count(refund_events.id)::integer as refund_count,
      coalesce(sum(refund_events.amount), 0)::numeric as refunded_amount
    from periods
    left join refund_events
      on refund_events.period_key = periods.period_key
    group by periods.period_key
  ),
  obligation_totals as (
    select
      count(*) filter (where payment_status = 'pending')::integer as pending_count,
      coalesce(sum(amount) filter (where payment_status = 'pending'), 0)::numeric as pending_amount,
      count(*) filter (where payment_status = 'held')::integer as held_count,
      coalesce(sum(amount) filter (where payment_status = 'held'), 0)::numeric as held_amount
    from current_obligations
  ),
  current_payment_rows as (
    select
      collected.id,
      collected.amount,
      collected.normalized_payment_method,
      configured.immutable_key,
      configured.method_code,
      configured.display_name,
      configured.enabled,
      case
        when collected.normalized_payment_method is null then 'unknown_unclassified'
        when configured.immutable_key is not null then 'known_configured'
        else 'legacy_unrecognized'
      end as classification
    from collected_invoices collected
    left join lateral (
      select
        methods.immutable_key,
        methods.method_code,
        methods.display_name,
        methods.enabled
      from public.business_payment_methods methods
      where methods.restaurant_id = target_restaurant_id
        and (
          lower(public.normalize_payment_method(methods.display_name))
            = lower(collected.normalized_payment_method)
          or lower(public.normalize_payment_method(replace(methods.method_code, '_', ' ')))
            = lower(collected.normalized_payment_method)
        )
      order by
        case
          when lower(public.normalize_payment_method(methods.display_name))
            = lower(collected.normalized_payment_method) then 0
          else 1
        end,
        methods.id
      limit 1
    ) configured on true
    where collected.period_key = 'current'
  ),
  payment_method_totals as (
    select
      immutable_key,
      method_code,
      case
        when classification = 'unknown_unclassified' then 'Unknown / unclassified'
        when classification = 'known_configured' then display_name
        else normalized_payment_method
      end as display_label,
      enabled,
      classification,
      count(*)::integer as invoice_count,
      coalesce(sum(amount), 0)::numeric as collected_amount
    from current_payment_rows
    group by
      immutable_key,
      method_code,
      case
        when classification = 'unknown_unclassified' then 'Unknown / unclassified'
        when classification = 'known_configured' then display_name
        else normalized_payment_method
      end,
      enabled,
      classification
  ),
  payment_method_quality as (
    select
      count(*) filter (where classification = 'unknown_unclassified')::integer
        as unknown_invoice_count,
      count(*) filter (where classification = 'legacy_unrecognized')::integer
        as legacy_unrecognized_invoice_count
    from current_payment_rows
  ),
  open_shifts as (
    select shifts.id, shifts.opening_cash
    from public.cashier_shifts shifts
    where shifts.restaurant_id = target_restaurant_id
      and shifts.closed_at is null
  ),
  open_shift_invoice_totals as (
    select
      invoices.cashier_shift_id as shift_id,
      coalesce(sum(coalesce(invoices.grand_total, invoices.total_price, 0)) filter (
        where invoices.payment_status = 'paid'
          and coalesce(
            public.normalize_payment_method(invoices.payment_method),
            public.normalize_payment_method(orders.payment_method)
          ) = 'Cash'
      ), 0)::numeric as cash_sales,
      coalesce(sum(coalesce(invoices.grand_total, invoices.total_price, 0)) filter (
        where invoices.payment_status = 'refunded'
          and coalesce(
            public.normalize_payment_method(invoices.payment_method),
            public.normalize_payment_method(orders.payment_method)
          ) = 'Cash'
      ), 0)::numeric as cash_refunds
    from public.order_invoices invoices
    join open_shifts on open_shifts.id = invoices.cashier_shift_id
    join public.orders orders
      on orders.id = invoices.order_id
     and orders.restaurant_id = invoices.restaurant_id
    where invoices.restaurant_id = target_restaurant_id
    group by invoices.cashier_shift_id
  ),
  open_shift_expense_totals as (
    select
      expenses.shift_id,
      coalesce(sum(expenses.amount) filter (where expenses.status = 'approved'), 0)::numeric
        as approved_expenses
    from public.cashier_shift_expenses expenses
    join open_shifts on open_shifts.id = expenses.shift_id
    where expenses.restaurant_id = target_restaurant_id
    group by expenses.shift_id
  ),
  open_shift_summary as (
    select
      count(*)::integer as open_shift_count,
      coalesce(sum(
        open_shifts.opening_cash
        + coalesce(open_shift_invoice_totals.cash_sales, 0)
        - coalesce(open_shift_invoice_totals.cash_refunds, 0)
        - coalesce(open_shift_expense_totals.approved_expenses, 0)
      ), 0)::numeric as expected_cash
    from open_shifts
    left join open_shift_invoice_totals
      on open_shift_invoice_totals.shift_id = open_shifts.id
    left join open_shift_expense_totals
      on open_shift_expense_totals.shift_id = open_shifts.id
  ),
  pending_drawer_expenses as (
    select
      count(*)::integer as expense_count,
      coalesce(sum(expenses.amount), 0)::numeric as expense_amount
    from public.cashier_shift_expenses expenses
    where expenses.restaurant_id = target_restaurant_id
      and expenses.status = 'pending'
  ),
  period_closed_shifts as (
    select shifts.id
    from public.cashier_shifts shifts
    where shifts.restaurant_id = target_restaurant_id
      and shifts.closed_at >= period_start
      and shifts.closed_at < period_end
  ),
  period_reconciliations as (
    select reconciliations.*
    from public.cash_reconciliations reconciliations
    where reconciliations.restaurant_id = target_restaurant_id
      and reconciliations.closed_at >= period_start
      and reconciliations.closed_at < period_end
  ),
  reconciliation_summary as (
    select
      (select count(*)::integer from period_closed_shifts) as closed_shift_count,
      count(*)::integer as reconciled_shift_count,
      count(*) filter (where variance <> 0)::integer as nonzero_variance_count,
      coalesce(sum(expected_cash), 0)::numeric as expected_cash,
      coalesce(sum(actual_cash), 0)::numeric as actual_cash,
      coalesce(sum(variance), 0)::numeric as variance_amount
    from period_reconciliations
  ),
  latest_reconciliation as (
    select
      reconciliations.closed_at,
      reconciliations.expected_cash,
      reconciliations.actual_cash,
      reconciliations.variance
    from period_reconciliations reconciliations
    order by reconciliations.closed_at desc, reconciliations.id
    limit 1
  ),
  trend_settings as (
    select
      case
        when period_end - period_start <= interval '48 hours' then 'hour'
        when period_end - period_start <= interval '93 days' then 'day'
        when period_end - period_start <= interval '366 days' then 'week'
        else 'month'
      end as granularity,
      case
        when period_end - period_start <= interval '48 hours' then interval '1 hour'
        when period_end - period_start <= interval '93 days' then interval '1 day'
        when period_end - period_start <= interval '366 days' then interval '1 week'
        else interval '1 month'
      end as bucket_step
  ),
  trend_buckets as (
    select series.local_start
    from trend_settings
    cross join lateral generate_series(
      date_trunc(trend_settings.granularity, timezone(restaurant_timezone, period_start)),
      date_trunc(
        trend_settings.granularity,
        timezone(restaurant_timezone, period_end - interval '1 microsecond')
      ),
      trend_settings.bucket_step
    ) as series(local_start)
  ),
  trend_values as (
    select
      date_trunc(
        trend_settings.granularity,
        timezone(restaurant_timezone, collected.paid_at)
      ) as local_start,
      count(*)::integer as invoice_count,
      coalesce(sum(collected.amount), 0)::numeric as collected_amount
    from collected_invoices collected
    cross join trend_settings
    where collected.period_key = 'current'
    group by 1
  ),
  snapshot_quality_rows as (
    select id, financial_snapshot_version, grand_total
    from collected_invoices
    where period_key = 'current'
    union
    select id, financial_snapshot_version, grand_total
    from refund_events
    where period_key = 'current'
    union
    select id, financial_snapshot_version, grand_total
    from current_obligations
  ),
  snapshot_quality as (
    select
      count(*)::integer as invoice_count,
      count(*) filter (where financial_snapshot_version is null)::integer as legacy_invoice_count,
      count(*) filter (
        where financial_snapshot_version = 'frozen_v1' and grand_total is null
      )::integer as incomplete_frozen_invoice_count
    from snapshot_quality_rows
  ),
  refund_quality as (
    select
      count(*) filter (where refunded_at is null)::integer as untimed_refund_count
    from public.order_invoices invoices
    where invoices.restaurant_id = target_restaurant_id
      and invoices.payment_status = 'refunded'
  )
  select jsonb_build_object(
    'generated_at', statement_timestamp(),
    'period', jsonb_build_object(
      'start', period_start,
      'end', period_end,
      'comparison_start', comparison_start,
      'comparison_end', comparison_end,
      'boundary_semantics', 'half_open_absolute_timestamps',
      'timezone', restaurant_timezone,
      'timezone_source', timezone_source
    ),
    'collections', jsonb_build_object(
      'collected_amount', current_collections.collected_amount,
      'collected_count', current_collections.invoice_count,
      'comparison_amount', comparison_collections.collected_amount,
      'comparison_count', comparison_collections.invoice_count,
      'comparison_percent', case
        when comparison_collections.collected_amount = 0 then null
        else round(
          (current_collections.collected_amount - comparison_collections.collected_amount)
            / comparison_collections.collected_amount * 100,
          2
        )
      end
    ),
    'obligations', jsonb_build_object(
      'state_basis', 'current',
      'pending_count', obligation_totals.pending_count,
      'pending_amount', obligation_totals.pending_amount,
      'held_count', obligation_totals.held_count,
      'held_amount', obligation_totals.held_amount
    ),
    'refunds', jsonb_build_object(
      'refunded_amount', current_refunds.refunded_amount,
      'refund_count', current_refunds.refund_count,
      'comparison_amount', comparison_refunds.refunded_amount,
      'comparison_count', comparison_refunds.refund_count
    ),
    'net_collected', jsonb_build_object(
      'amount', current_collections.collected_amount - current_refunds.refunded_amount,
      'comparison_amount', comparison_collections.collected_amount - comparison_refunds.refunded_amount,
      'definition', 'Period collected settlement events minus period refund events; not accounting net revenue.'
    ),
    'payment_methods', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'method_identity', payment_method_totals.immutable_key,
          'method_code', payment_method_totals.method_code,
          'display_label', payment_method_totals.display_label,
          'classification', payment_method_totals.classification,
          'currently_enabled', payment_method_totals.enabled,
          'collected_amount', payment_method_totals.collected_amount,
          'invoice_count', payment_method_totals.invoice_count,
          'share_percent', case
            when current_collections.collected_amount = 0 then null
            else round(
              payment_method_totals.collected_amount
                / current_collections.collected_amount * 100,
              2
            )
          end
        )
        order by payment_method_totals.collected_amount desc,
          payment_method_totals.display_label
      )
      from payment_method_totals
    ), '[]'::jsonb),
    'cashier_control', jsonb_build_object(
      'open_shift_count', open_shift_summary.open_shift_count,
      'open_expected_cash', open_shift_summary.expected_cash,
      'open_actual_cash', null,
      'closed_shift_count', reconciliation_summary.closed_shift_count,
      'reconciled_shift_count', reconciliation_summary.reconciled_shift_count,
      'reconciled_expected_cash', reconciliation_summary.expected_cash,
      'reconciled_actual_cash', reconciliation_summary.actual_cash,
      'nonzero_variance_count', reconciliation_summary.nonzero_variance_count,
      'variance_amount', reconciliation_summary.variance_amount,
      'latest_reconciliation', (
        select jsonb_build_object(
          'closed_at', latest_reconciliation.closed_at,
          'expected_cash', latest_reconciliation.expected_cash,
          'actual_cash', latest_reconciliation.actual_cash,
          'variance', latest_reconciliation.variance
        )
        from latest_reconciliation
      ),
      'pending_drawer_expense_count', pending_drawer_expenses.expense_count,
      'pending_drawer_expense_amount', pending_drawer_expenses.expense_amount
    ),
    'trend', jsonb_build_object(
      'granularity', trend_settings.granularity,
      'timezone', restaurant_timezone,
      'buckets', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'bucket_start', trend_buckets.local_start at time zone restaurant_timezone,
            'bucket_local_start', trend_buckets.local_start::text,
            'collected_amount', coalesce(trend_values.collected_amount, 0),
            'invoice_count', coalesce(trend_values.invoice_count, 0)
          )
          order by trend_buckets.local_start
        )
        from trend_buckets
        left join trend_values using (local_start)
      ), '[]'::jsonb)
    ),
    'quality', jsonb_build_object(
      'financial_snapshots', case
        when snapshot_quality.legacy_invoice_count = 0
          and snapshot_quality.incomplete_frozen_invoice_count = 0 then 'complete'
        when snapshot_quality.legacy_invoice_count = snapshot_quality.invoice_count
          and snapshot_quality.invoice_count > 0 then 'legacy_limited'
        else 'partial'
      end,
      'legacy_snapshot_invoice_count', snapshot_quality.legacy_invoice_count,
      'incomplete_frozen_invoice_count', snapshot_quality.incomplete_frozen_invoice_count,
      'refund_timing', case
        when refund_quality.untimed_refund_count = 0 then 'complete'
        else 'partial'
      end,
      'untimed_refund_count', refund_quality.untimed_refund_count,
      'payment_method_attribution', case
        when payment_method_quality.unknown_invoice_count = 0
          and payment_method_quality.legacy_unrecognized_invoice_count = 0 then 'complete'
        else 'partial'
      end,
      'unknown_payment_method_invoice_count', payment_method_quality.unknown_invoice_count,
      'legacy_unrecognized_method_invoice_count',
        payment_method_quality.legacy_unrecognized_invoice_count,
      'timezone', case
        when timezone_source = 'restaurant_profile' then 'complete'
        else 'defaulted'
      end,
      'cash_reconciliation', case
        when reconciliation_summary.closed_shift_count
          = reconciliation_summary.reconciled_shift_count then 'complete'
        else 'partial'
      end
    ),
    'definitions', jsonb_build_object(
      'collected', 'Paid settlement events at paid_at; later-refunded invoices retain their original collection event.',
      'pending', 'Current tenant-wide invoices in payment_status pending; not a historical period-end balance.',
      'held', 'Current tenant-wide invoices in payment_status held; never collected.',
      'refund', 'Full refunded invoice value at refunded_at; untimed legacy refunds cannot be assigned to a period.',
      'open_expected_cash', 'Opening cash plus paid cash invoices minus cash refunds and approved cash-drawer expenses for current open shifts.',
      'closed_cash', 'Selected-period actual and variance values come only from immutable cash_reconciliations.',
      'drawer_expenses', 'Current pending cash-drawer expenses; not general business expenses.',
      'amount_quality', 'Frozen grand_total is authoritative; legacy rows use stored total_price and are identified by quality metadata.'
    )
  )
  into result
  from collection_totals current_collections
  join collection_totals comparison_collections
    on comparison_collections.period_key = 'comparison'
  join refund_totals current_refunds
    on current_refunds.period_key = 'current'
  join refund_totals comparison_refunds
    on comparison_refunds.period_key = 'comparison'
  cross join obligation_totals
  cross join open_shift_summary
  cross join pending_drawer_expenses
  cross join reconciliation_summary
  cross join trend_settings
  cross join snapshot_quality
  cross join refund_quality
  cross join payment_method_quality
  where current_collections.period_key = 'current';

  return result;
end;
$$;

comment on function public.get_owner_finance_read_model(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz
) is
  'Owner-only Finance F2 read model. Collection/refund/trend values are period events; pending/held and open-shift controls are current state. Side-effect free.';

revoke all on function public.get_owner_finance_read_model(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.get_owner_finance_read_model(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz
) to authenticated, service_role;
