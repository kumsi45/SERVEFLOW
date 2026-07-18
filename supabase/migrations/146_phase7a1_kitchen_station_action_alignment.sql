-- Align the kitchen action selector with the canonical queue and repair legacy
-- menu/order items that predate automatic station routing.

do $$
declare restaurant_row record;
declare main_station_id uuid;
begin
  for restaurant_row in select id from public.restaurants loop
    main_station_id := public.ensure_main_kitchen_station_for_restaurant(restaurant_row.id);

    update public.menu_items menu
    set kitchen_station_id = main_station_id
    where menu.restaurant_id = restaurant_row.id
      and menu.kitchen_station_id is null;

    update public.order_items items
    set kitchen_station_id = coalesce(menu.kitchen_station_id, main_station_id)
    from public.menu_items menu
    where items.restaurant_id = restaurant_row.id
      and items.kitchen_station_id is null
      and menu.id = items.menu_item_id
      and menu.restaurant_id = items.restaurant_id
      and exists (
        select 1 from public.orders orders
        where orders.id = items.order_id
          and orders.restaurant_id = items.restaurant_id
          and orders.dining_session_status = 'open'
          and orders.table_released_at is null
      );

    update public.order_items items
    set kitchen_station_id = main_station_id
    where items.restaurant_id = restaurant_row.id
      and items.kitchen_station_id is null
      and exists (
        select 1 from public.orders orders
        where orders.id = items.order_id
          and orders.restaurant_id = items.restaurant_id
          and orders.dining_session_status = 'open'
          and orders.table_released_at is null
      );
  end loop;
end;
$$;

do $$
declare definition text;
declare replacement text;
begin
  definition := pg_get_functiondef('public.start_order_preparation(uuid,uuid,text)'::regprocedure);
  if position('get diagnostics updated_count = row_count;' in lower(definition)) = 0 then
    raise exception 'Kitchen start row-count guard was not found.';
  end if;

  replacement := $body$
  get diagnostics updated_count = row_count;

  -- Old clients and PostgreSQL timestamp serialization can disagree on the
  -- derived microsecond batch key. The queue has already authorized this
  -- order/station, so fall back only inside that same tenant/order/station.
  if updated_count = 0 and target_batch_key is not null then
    update public.order_items items
    set kitchen_status = 'preparing',
        kitchen_preparation_started_at = coalesce(kitchen_preparation_started_at, now()),
        kitchen_preparation_started_by = coalesce(kitchen_preparation_started_by, acting_staff.id)
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and items.kitchen_station_id = effective_station_id
      and items.kitchen_status = 'paid';
    get diagnostics updated_count = row_count;
  end if;
  $body$;

  if position('  GET DIAGNOSTICS updated_count = ROW_COUNT;' in definition) > 0 then
    definition := replace(definition, '  GET DIAGNOSTICS updated_count = ROW_COUNT;', replacement);
  else
    definition := replace(definition, '  get diagnostics updated_count = row_count;', replacement);
  end if;
  execute definition;
end;
$$;

revoke all on function public.start_order_preparation(uuid,uuid,text) from public, anon;
grant execute on function public.start_order_preparation(uuid,uuid,text) to authenticated;
