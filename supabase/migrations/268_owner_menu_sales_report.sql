-- Complete, on-demand menu detail; preserves the bounded Reports V1 summary.
-- One row per historical menu identity, not per order line. Hundreds of menu
-- identities remain compact; this endpoint is never loaded on Reports entry.
create or replace function public.get_owner_menu_sales_report(
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
  restaurant_currency text;
  result jsonb;
begin
  perform public._owner_reports_assert_owner(target_restaurant_id);
  resolved := public._owner_reports_resolve_period(
    target_restaurant_id, requested_period, custom_start_date, custom_end_date, statement_timestamp()
  );
  select coalesce(nullif(btrim(currency_code), ''), 'ETB') into restaurant_currency
  from public.restaurants where id = target_restaurant_id;

  with current_menu_lines as (
    select items.id, items.menu_item_id, items.quantity, items.price
    from public.order_invoices invoices
    join public.order_items items
      on items.restaurant_id = target_restaurant_id and items.invoice_id = invoices.id
    where invoices.restaurant_id = target_restaurant_id
      and invoices.payment_status in ('paid', 'refunded')
      and invoices.paid_at >= (resolved->>'currentStart')::timestamptz
      and invoices.paid_at < (resolved->>'currentEnd')::timestamptz
      and items.kitchen_status <> 'cancelled'
  ), menu_sales as (
    select menu_item_id, sum(quantity)::bigint quantity,
      sum(quantity * price)::numeric item_line_sales_value, count(*) line_count
    from current_menu_lines group by menu_item_id
  ), ranked as (
    select row_number() over(order by sales.quantity desc, sales.item_line_sales_value desc, sales.menu_item_id) rank,
      sales.*, items.id matched_id, coalesce(nullif(items.name,''), 'Unavailable historical item') name,
      coalesce(nullif(categories.name,''), 'Uncategorized / historical') category,
      items.archived_at is not null archived
    from menu_sales sales
    left join public.menu_items items on items.restaurant_id = target_restaurant_id and items.id = sales.menu_item_id
    left join public.categories categories on categories.restaurant_id = items.restaurant_id and categories.id = items.category_id
  ), totals as (
    select coalesce(sum(item_line_sales_value),0) sales_value,
      coalesce(sum(line_count) filter(where matched_id is null),0) unmatched_count
    from ranked
  ), legacy as (
    -- Same tenant-wide, non-period-attributable population exposed by R3.
    select count(*) item_count from public.order_items
    where restaurant_id = target_restaurant_id and invoice_id is null
  )
  select jsonb_build_object(
    'contractVersion', 'owner_menu_sales_v1', 'period', resolved - 'anchorTime',
    'currency', restaurant_currency,
    'totalItemLineSalesValue', totals.sales_value,
    'soldItems', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', rank, 'menuItemKey', menu_item_id, 'name', name, 'category', category,
      'quantity', quantity, 'itemLineSalesValue', item_line_sales_value,
      'salesSharePercent', case when totals.sales_value = 0 then null else round(item_line_sales_value / totals.sales_value * 100, 2) end,
      'archived', archived, 'matchedToCurrentMenu', matched_id is not null
    ) order by rank) from ranked), '[]'::jsonb),
    'noSalesItems', coalesce((select jsonb_agg(jsonb_build_object(
      'menuItemKey', items.id, 'name', items.name, 'category', coalesce(nullif(categories.name,''), 'Uncategorized'),
      'quantity', 0, 'currentlyAvailable', true
    ) order by items.name, items.id)
      from public.menu_items items
      left join public.categories categories on categories.restaurant_id = items.restaurant_id and categories.id = items.category_id
      left join menu_sales sales on sales.menu_item_id = items.id
      where items.restaurant_id = target_restaurant_id and items.available and items.archived_at is null
        and coalesce(sales.quantity,0) = 0), '[]'::jsonb),
    'legacyUnattributedItemCount', legacy.item_count,
    'unmatchedItemLineCount', totals.unmatched_count,
    'limitations', jsonb_build_array(
      'Sales value uses recorded item prices; it does not allocate discounts, tax, service charges or refunds.',
      'Names, categories and availability reflect your current menu.',
      'Older items without a linked payment cannot be assigned to this period.'
    )
  ) into result from totals cross join legacy;
  return result;
end;
$$;

revoke all on function public.get_owner_menu_sales_report(uuid,text,date,date) from public, anon, authenticated;
grant execute on function public.get_owner_menu_sales_report(uuid,text,date,date) to authenticated;
comment on function public.get_owner_menu_sales_report(uuid,text,date,date) is
  'Owner-only complete menu sales detail using Reports V1 paid-invoice cohorts and item-line values; never collected money or profit.';
