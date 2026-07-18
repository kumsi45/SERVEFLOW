-- Realtime applies table SELECT policies even when dashboards load through
-- security-definer RPCs. Grant only same-tenant operational rows.

drop policy if exists orders_manager_realtime_same_restaurant on public.orders;
create policy orders_manager_realtime_same_restaurant on public.orders
for select to authenticated
using (public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[]));

drop policy if exists order_items_manager_realtime_same_restaurant on public.order_items;
create policy order_items_manager_realtime_same_restaurant on public.order_items
for select to authenticated
using (public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[]));

drop policy if exists order_invoices_manager_realtime_same_restaurant on public.order_invoices;
create policy order_invoices_manager_realtime_same_restaurant on public.order_invoices
for select to authenticated
using (public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[]));

drop policy if exists orders_kitchen_operational_realtime on public.orders;
create policy orders_kitchen_operational_realtime on public.orders
for select to authenticated
using (
  public.has_staff_role(restaurant_id, array['kitchen']::public.restaurant_staff_role[])
  and operational_status::text in ('accepted','preparing','ready','served')
  and public.kitchen_order_has_assigned_station(restaurant_id,id)
);

drop policy if exists order_items_kitchen_operational_realtime on public.order_items;
create policy order_items_kitchen_operational_realtime on public.order_items
for select to authenticated
using (
  public.has_staff_role(restaurant_id, array['kitchen']::public.restaurant_staff_role[])
  and public.kitchen_can_view_order_item(restaurant_id,order_id,kitchen_station_id)
);

do $$
declare relation_name text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach relation_name in array array['staff_activity_log','manager_ai_recommendation_decisions'] loop
      if to_regclass('public.'||relation_name) is not null and not exists(
        select 1 from pg_publication_tables where pubname='supabase_realtime'
          and schemaname='public' and tablename=relation_name
      ) then execute format('alter publication supabase_realtime add table public.%I',relation_name); end if;
    end loop;
  end if;
end;
$$;
