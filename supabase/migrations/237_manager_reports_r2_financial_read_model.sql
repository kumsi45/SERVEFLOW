-- Manager Reports R2: Overview + Sales / Payments / VAT backend only.
-- Financial events are isolated by their canonical timestamps. No Owner report
-- authority or mutable restaurant tax settings are used by this read model.

alter table public.order_invoices
  add column if not exists financial_snapshot_version text;

alter table public.order_invoices
  alter column financial_snapshot_version set default 'frozen_v1';

alter table public.order_invoices
  drop constraint if exists order_invoices_financial_snapshot_version_allowed,
  add constraint order_invoices_financial_snapshot_version_allowed
    check (financial_snapshot_version is null or financial_snapshot_version = 'frozen_v1');

comment on column public.order_invoices.financial_snapshot_version is
  'frozen_v1 identifies invoices created after explicit R2 financial-history provenance was introduced. NULL means older stored totals whose original VAT/service-charge completeness cannot be proven.';

create index if not exists order_invoices_manager_paid_event_idx
  on public.order_invoices (restaurant_id, paid_at)
  where payment_status in ('paid', 'refunded') and paid_at is not null;

create index if not exists order_invoices_manager_refund_event_idx
  on public.order_invoices (restaurant_id, refunded_at)
  where payment_status = 'refunded' and refunded_at is not null;

create or replace function public.get_manager_financial_report(
  target_restaurant_id uuid,
  range_start timestamptz,
  range_end timestamptz,
  comparison_range_start timestamptz,
  comparison_range_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
guard as (
  select public.manager_can_report(target_restaurant_id) as allowed
),
periods(period_key, period_start, period_end) as (
  values
    ('current'::text, range_start, range_end),
    ('comparison'::text, comparison_range_start, comparison_range_end)
),
collected_invoices as (
  select
    periods.period_key,
    invoices.id,
    coalesce(invoices.grand_total, invoices.total_price, 0)::numeric as amount,
    coalesce(invoices.subtotal, 0)::numeric as subtotal,
    coalesce(invoices.vat_amount, 0)::numeric as vat_amount,
    coalesce(invoices.service_charge_amount, 0)::numeric as service_charge_amount,
    coalesce(invoices.discount_amount, 0)::numeric as discount_amount,
    coalesce(public.normalize_payment_method(invoices.payment_method), 'Other') as payment_method,
    invoices.financial_snapshot_version
  from periods
  join public.order_invoices invoices
    on invoices.restaurant_id = target_restaurant_id
   and invoices.payment_status in ('paid', 'refunded')
   and invoices.paid_at >= periods.period_start
   and invoices.paid_at < periods.period_end
  join guard on guard.allowed
),
refund_events as (
  select
    periods.period_key,
    invoices.id,
    coalesce(invoices.grand_total, invoices.total_price, 0)::numeric as amount,
    coalesce(invoices.vat_amount, 0)::numeric as vat_amount,
    coalesce(invoices.service_charge_amount, 0)::numeric as service_charge_amount,
    invoices.financial_snapshot_version
  from periods
  join public.order_invoices invoices
    on invoices.restaurant_id = target_restaurant_id
   and invoices.payment_status = 'refunded'
   and invoices.refunded_at >= periods.period_start
   and invoices.refunded_at < periods.period_end
  join guard on guard.allowed
),
outstanding_invoices as (
  select
    periods.period_key,
    invoices.id,
    coalesce(invoices.grand_total, invoices.total_price, 0)::numeric as amount,
    invoices.financial_snapshot_version
  from periods
  join public.order_invoices invoices
    on invoices.restaurant_id = target_restaurant_id
   and invoices.payment_status in ('pending', 'held')
   and invoices.created_at >= periods.period_start
   and invoices.created_at < periods.period_end
  join guard on guard.allowed
),
orders_created as (
  select periods.period_key, count(orders.id)::integer as order_count
  from periods
  left join public.orders orders
    on orders.restaurant_id = target_restaurant_id
   and orders.created_at >= periods.period_start
   and orders.created_at < periods.period_end
  join guard on guard.allowed
  group by periods.period_key
),
collection_totals as (
  select
    period_key,
    count(*)::integer as invoice_count,
    coalesce(sum(amount), 0)::numeric as collected_amount,
    coalesce(sum(subtotal), 0)::numeric as subtotal_amount,
    coalesce(sum(vat_amount), 0)::numeric as vat_amount,
    coalesce(sum(service_charge_amount), 0)::numeric as service_charge_amount,
    coalesce(sum(discount_amount), 0)::numeric as discount_amount
  from collected_invoices
  group by period_key
),
refund_totals as (
  select
    period_key,
    count(*)::integer as invoice_count,
    coalesce(sum(amount), 0)::numeric as refund_amount,
    coalesce(sum(vat_amount), 0)::numeric as refunded_vat_amount,
    coalesce(sum(service_charge_amount), 0)::numeric as refunded_service_charge_amount
  from refund_events
  group by period_key
),
outstanding_totals as (
  select
    period_key,
    count(*)::integer as invoice_count,
    coalesce(sum(amount), 0)::numeric as outstanding_amount
  from outstanding_invoices
  group by period_key
),
payment_methods as (
  select
    period_key,
    payment_method,
    count(*)::integer as invoice_count,
    coalesce(sum(amount), 0)::numeric as collected_amount
  from collected_invoices
  group by period_key, payment_method
),
financial_quality_rows as (
  select period_key, id, financial_snapshot_version from collected_invoices
  union
  select period_key, id, financial_snapshot_version from refund_events
  union
  select period_key, id, financial_snapshot_version from outstanding_invoices
),
financial_quality as (
  select
    period_key,
    count(*)::integer as row_count,
    count(*) filter (where financial_snapshot_version is null)::integer as legacy_count
  from financial_quality_rows
  group by period_key
),
tax_quality_rows as (
  select period_key, id, financial_snapshot_version from collected_invoices
  union
  select period_key, id, financial_snapshot_version from refund_events
),
tax_quality as (
  select
    period_key,
    count(*)::integer as row_count,
    count(*) filter (where financial_snapshot_version is null)::integer as legacy_count
  from tax_quality_rows
  group by period_key
),
refund_quality as (
  select
    period_key,
    count(*)::integer as row_count,
    count(*) filter (where financial_snapshot_version is null)::integer as legacy_count
  from refund_events
  group by period_key
),
untimed_legacy_refunds as (
  select exists (
    select 1
    from public.order_invoices invoices
    join guard on guard.allowed
    where invoices.restaurant_id = target_restaurant_id
      and invoices.payment_status = 'refunded'
      and invoices.refunded_at is null
  ) as present
),
period_payloads as (
  select
    periods.period_key,
    jsonb_build_object(
      'range_start', periods.period_start,
      'range_end', periods.period_end,
      'collected_amount', coalesce(collection_totals.collected_amount, 0),
      'collected_invoice_count', coalesce(collection_totals.invoice_count, 0),
      'outstanding_amount', coalesce(outstanding_totals.outstanding_amount, 0),
      'outstanding_invoice_count', coalesce(outstanding_totals.invoice_count, 0),
      'refund_amount', coalesce(refund_totals.refund_amount, 0),
      'refunded_invoice_count', coalesce(refund_totals.invoice_count, 0),
      'net_collection', coalesce(collection_totals.collected_amount, 0) - coalesce(refund_totals.refund_amount, 0),
      'subtotal_amount', coalesce(collection_totals.subtotal_amount, 0),
      'discount_amount', coalesce(collection_totals.discount_amount, 0),
      'service_charge_amount', coalesce(collection_totals.service_charge_amount, 0),
      'refunded_service_charge_amount', coalesce(refund_totals.refunded_service_charge_amount, 0),
      'net_service_charge_amount', coalesce(collection_totals.service_charge_amount, 0) - coalesce(refund_totals.refunded_service_charge_amount, 0),
      'vat_amount', coalesce(collection_totals.vat_amount, 0),
      'refunded_vat_amount', coalesce(refund_totals.refunded_vat_amount, 0),
      'net_vat_amount', coalesce(collection_totals.vat_amount, 0) - coalesce(refund_totals.refunded_vat_amount, 0),
      'average_paid_invoice', case
        when coalesce(collection_totals.invoice_count, 0) = 0 then null
        else collection_totals.collected_amount / collection_totals.invoice_count
      end,
      'orders_created', coalesce(orders_created.order_count, 0),
      'payment_methods', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'payment_method', payment_methods.payment_method,
            'collected_amount', payment_methods.collected_amount,
            'invoice_count', payment_methods.invoice_count
          ) order by payment_methods.collected_amount desc, payment_methods.payment_method
        )
        from payment_methods
        where payment_methods.period_key = periods.period_key
      ), '[]'::jsonb),
      'data_quality', jsonb_build_object(
        'financial_history', case
          when coalesce(financial_quality.row_count, 0) = 0 then 'unavailable'
          when financial_quality.legacy_count = 0 then 'complete'
          when financial_quality.legacy_count = financial_quality.row_count then 'legacy_unknown'
          else 'mixed_legacy'
        end,
        'tax_history', case
          when coalesce(tax_quality.row_count, 0) = 0 then 'unavailable'
          when tax_quality.legacy_count = 0 then 'complete'
          when tax_quality.legacy_count = tax_quality.row_count then 'legacy_unknown'
          else 'mixed_legacy'
        end,
        'service_charge_history', case
          when coalesce(tax_quality.row_count, 0) = 0 then 'unavailable'
          when tax_quality.legacy_count = 0 then 'complete'
          when tax_quality.legacy_count = tax_quality.row_count then 'legacy_unknown'
          else 'mixed_legacy'
        end,
        'refund_history', case
          when (select present from untimed_legacy_refunds) and coalesce(refund_quality.row_count, 0) = 0 then 'legacy_unknown'
          when (select present from untimed_legacy_refunds) or (
            coalesce(refund_quality.row_count, 0) > 0
            and refund_quality.legacy_count > 0
            and refund_quality.legacy_count < refund_quality.row_count
          ) then 'mixed_legacy'
          when coalesce(refund_quality.row_count, 0) = 0 then 'unavailable'
          when refund_quality.legacy_count = 0 then 'complete'
          when refund_quality.legacy_count = refund_quality.row_count then 'legacy_unknown'
          else 'mixed_legacy'
        end
      )
    ) as payload
  from periods
  left join collection_totals on collection_totals.period_key = periods.period_key
  left join refund_totals on refund_totals.period_key = periods.period_key
  left join outstanding_totals on outstanding_totals.period_key = periods.period_key
  left join orders_created on orders_created.period_key = periods.period_key
  left join financial_quality on financial_quality.period_key = periods.period_key
  left join tax_quality on tax_quality.period_key = periods.period_key
  left join refund_quality on refund_quality.period_key = periods.period_key
)
select case
  when not exists (select 1 from guard where allowed) then
    jsonb_build_object('error', 'Permission denied.')
  when target_restaurant_id is null
    or range_start is null
    or range_end is null
    or comparison_range_start is null
    or comparison_range_end is null
    or range_start >= range_end
    or comparison_range_start >= comparison_range_end
    or comparison_range_end > range_start then
    jsonb_build_object('error', 'Invalid or overlapping reporting periods.')
  else jsonb_build_object(
    'generated_at', now(),
    'current', (select payload from period_payloads where period_key = 'current'),
    'comparison', (select payload from period_payloads where period_key = 'comparison'),
    'definitions', jsonb_build_object(
      'collected', 'Invoice collection events at paid_at, including invoices later refunded.',
      'outstanding', 'Currently pending or held invoices created inside the period; not a historical balance-at-time reconstruction.',
      'refund', 'Full refunded invoice value at refunded_at.',
      'net_collection', 'Collected amount minus refund amount for the same event period.',
      'orders_created', 'Orders whose created_at is inside the period.'
    )
  )
end
from guard;
$$;

revoke all on function public.get_manager_financial_report(uuid, timestamptz, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_manager_financial_report(uuid, timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;
