-- SERVEFLOW Phase 4D.1 Menu Data Foundation.
-- Nullable international menu metadata only. Ordering, kitchen routing, cashier,
-- payments, receipts, reports, analytics, AI, auth, Docker, and owner layout
-- behavior are intentionally unchanged.

alter table public.menu_items
  add column if not exists description text,
  add column if not exists ingredients text[],
  add column if not exists allergens text[],
  add column if not exists preparation_time_minutes integer,
  add column if not exists spice_level integer,
  add column if not exists dietary_tags text[],
  add column if not exists calories integer,
  add column if not exists protein_g numeric(8, 2),
  add column if not exists carbohydrates_g numeric(8, 2),
  add column if not exists fat_g numeric(8, 2),
  add column if not exists fiber_g numeric(8, 2),
  add column if not exists sugar_g numeric(8, 2),
  add column if not exists sodium_mg numeric(8, 2);

alter table public.menu_items
  drop constraint if exists menu_items_preparation_time_non_negative,
  add constraint menu_items_preparation_time_non_negative
    check (preparation_time_minutes is null or preparation_time_minutes >= 0);

alter table public.menu_items
  drop constraint if exists menu_items_spice_level_range,
  add constraint menu_items_spice_level_range
    check (spice_level is null or (spice_level >= 0 and spice_level <= 5));

alter table public.menu_items
  drop constraint if exists menu_items_nutrition_non_negative,
  add constraint menu_items_nutrition_non_negative
    check (
      (calories is null or calories >= 0)
      and (protein_g is null or protein_g >= 0)
      and (carbohydrates_g is null or carbohydrates_g >= 0)
      and (fat_g is null or fat_g >= 0)
      and (fiber_g is null or fiber_g >= 0)
      and (sugar_g is null or sugar_g >= 0)
      and (sodium_mg is null or sodium_mg >= 0)
    );

alter table public.restaurant_starter_template_items
  add column if not exists ingredients text[],
  add column if not exists allergens text[],
  add column if not exists spice_level integer,
  add column if not exists dietary_tags text[],
  add column if not exists calories integer,
  add column if not exists protein_g numeric(8, 2),
  add column if not exists carbohydrates_g numeric(8, 2),
  add column if not exists fat_g numeric(8, 2),
  add column if not exists fiber_g numeric(8, 2),
  add column if not exists sugar_g numeric(8, 2),
  add column if not exists sodium_mg numeric(8, 2);

alter table public.restaurant_starter_template_items
  drop constraint if exists restaurant_starter_template_items_spice_level_range,
  add constraint restaurant_starter_template_items_spice_level_range
    check (spice_level is null or (spice_level >= 0 and spice_level <= 5));

alter table public.restaurant_starter_template_items
  drop constraint if exists restaurant_starter_template_items_nutrition_non_negative,
  add constraint restaurant_starter_template_items_nutrition_non_negative
    check (
      (calories is null or calories >= 0)
      and (protein_g is null or protein_g >= 0)
      and (carbohydrates_g is null or carbohydrates_g >= 0)
      and (fat_g is null or fat_g >= 0)
      and (fiber_g is null or fiber_g >= 0)
      and (sugar_g is null or sugar_g >= 0)
      and (sodium_mg is null or sodium_mg >= 0)
    );

create or replace function public.get_public_qr_menu(target_restaurant_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target_restaurant as (
    select id, name, slug, total_tables, branding
    from public.restaurants
    where slug = target_restaurant_slug
    limit 1
  )
  select
    case
      when not exists (select 1 from target_restaurant) then null
      else jsonb_build_object(
        'restaurant',
        (
          select jsonb_build_object(
            'id', restaurants.id,
            'name', restaurants.name,
            'slug', restaurants.slug,
            'table_count', restaurants.total_tables,
            'total_tables', restaurants.total_tables,
            'logo_url', restaurants.branding->>'logo_url',
            'cover_url', restaurants.branding->>'cover_url'
          )
          from target_restaurant restaurants
        ),
        'tables',
        coalesce((
          select jsonb_agg(jsonb_build_object('table_number', table_number, 'label', label, 'qr_path', qr_path) order by table_number)
          from public.restaurant_tables
          where restaurant_id = (select id from target_restaurant)
            and active = true
        ), '[]'::jsonb),
        'categories',
        coalesce((
          select jsonb_agg(jsonb_build_object('id', categories.id, 'restaurant_id', categories.restaurant_id, 'name', categories.name) order by categories.name)
          from public.categories
          where categories.restaurant_id = (select id from target_restaurant)
            and exists (
              select 1
              from public.menu_items
              where menu_items.restaurant_id = categories.restaurant_id
                and menu_items.category_id = categories.id
                and menu_items.available = true
                and menu_items.archived_at is null
            )
        ), '[]'::jsonb),
        'items',
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', menu_items.id,
            'restaurant_id', menu_items.restaurant_id,
            'category_id', menu_items.category_id,
            'name', menu_items.name,
            'description', menu_items.description,
            'ingredients', menu_items.ingredients,
            'allergens', menu_items.allergens,
            'preparation_time_minutes', menu_items.preparation_time_minutes,
            'spice_level', menu_items.spice_level,
            'dietary_tags', menu_items.dietary_tags,
            'calories', menu_items.calories,
            'protein_g', menu_items.protein_g,
            'carbohydrates_g', menu_items.carbohydrates_g,
            'fat_g', menu_items.fat_g,
            'fiber_g', menu_items.fiber_g,
            'sugar_g', menu_items.sugar_g,
            'sodium_mg', menu_items.sodium_mg,
            'price', menu_items.price,
            'image_url', menu_items.image_url,
            'available', menu_items.available
          ) order by menu_items.name)
          from public.menu_items
          where menu_items.restaurant_id = (select id from target_restaurant)
            and menu_items.available = true
            and menu_items.archived_at is null
        ), '[]'::jsonb)
      )
    end;
$$;

revoke all on function public.get_public_qr_menu(text) from public;
grant execute on function public.get_public_qr_menu(text) to anon;
grant execute on function public.get_public_qr_menu(text) to authenticated;

create or replace function public.get_restaurant_starter_templates(target_restaurant_type text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', templates.id,
      'template_key', templates.template_key,
      'restaurant_type', templates.restaurant_type,
      'name', templates.name,
      'description', templates.description,
      'display_order', templates.display_order,
      'categories', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', categories.id,
            'name', categories.name,
            'description', categories.description,
            'display_order', categories.display_order,
            'items', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', items.id,
                  'name', items.name,
                  'description', items.description,
                  'ingredients', items.ingredients,
                  'allergens', items.allergens,
                  'preparation_time_minutes', items.preparation_time_minutes,
                  'spice_level', items.spice_level,
                  'dietary_tags', items.dietary_tags,
                  'calories', items.calories,
                  'protein_g', items.protein_g,
                  'carbohydrates_g', items.carbohydrates_g,
                  'fat_g', items.fat_g,
                  'fiber_g', items.fiber_g,
                  'sugar_g', items.sugar_g,
                  'sodium_mg', items.sodium_mg,
                  'suggested_station', items.suggested_station,
                  'available', items.available,
                  'price', items.price,
                  'image_url', items.image_url,
                  'display_order', items.display_order
                )
                order by items.display_order, items.name
              )
              from public.restaurant_starter_template_items items
              where items.template_category_id = categories.id
            ), '[]'::jsonb)
          )
          order by categories.display_order, categories.name
        )
        from public.restaurant_starter_template_categories categories
        where categories.template_id = templates.id
      ), '[]'::jsonb)
    )
    order by templates.display_order, templates.name
  ), '[]'::jsonb)
  from public.restaurant_starter_templates templates
  where templates.active = true
    and (
      nullif(btrim(coalesce(target_restaurant_type, '')), '') is null
      or templates.restaurant_type = nullif(btrim(target_restaurant_type), '')
      or templates.restaurant_type = 'Mixed Restaurant'
    );
$$;

revoke all on function public.get_restaurant_starter_templates(text) from public, anon;
grant execute on function public.get_restaurant_starter_templates(text) to authenticated;

create or replace function public.import_restaurant_starter_templates(
  target_restaurant_id uuid,
  template_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_keys text[];
  requested_count integer;
  missing_key text;
  template_record record;
  category_record record;
  item_record record;
  copied_category_id uuid;
  main_station_id uuid;
  beverage_station_id uuid;
  selected_station_id uuid;
  inserted_categories integer := 0;
  inserted_items integer := 0;
  imported_templates integer := 0;
  skipped_templates integer := 0;
  template_categories integer := 0;
  template_items integer := 0;
  row_was_inserted integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to import starter templates.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may import starter templates.';
  end if;

  perform 1
  from public.restaurants
  where id = target_restaurant_id
  for update;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  select coalesce(array_agg(distinct normalized_key order by normalized_key), '{}'::text[])
  into normalized_keys
  from (
    select nullif(btrim(key_value), '') as normalized_key
    from unnest(coalesce(template_keys, '{}'::text[])) as key_value
  ) keys
  where normalized_key is not null;

  requested_count := coalesce(array_length(normalized_keys, 1), 0);
  if requested_count = 0 then
    return jsonb_build_object(
      'requested_templates', 0,
      'imported_templates', 0,
      'skipped_templates', 0,
      'categories_created', 0,
      'items_created', 0
    );
  end if;

  select requested_key
  into missing_key
  from unnest(normalized_keys) requested_key
  where not exists (
    select 1
    from public.restaurant_starter_templates templates
    where templates.template_key = requested_key
      and templates.active = true
  )
  limit 1;

  if missing_key is not null then
    raise exception 'Starter template % does not exist.', missing_key;
  end if;

  select stations.id
  into main_station_id
  from public.kitchen_stations stations
  where stations.restaurant_id = target_restaurant_id
    and stations.active = true
    and stations.archived_at is null
  order by
    case
      when lower(btrim(stations.name)) = 'main kitchen' then 0
      when lower(stations.name) like '%main%' then 1
      else 2
    end,
    stations.priority,
    stations.name
  limit 1;

  select stations.id
  into beverage_station_id
  from public.kitchen_stations stations
  where stations.restaurant_id = target_restaurant_id
    and stations.active = true
    and stations.archived_at is null
    and (
      lower(btrim(stations.name)) = 'beverage kitchen'
      or lower(stations.name) like '%beverage%'
      or lower(stations.name) like '%drink%'
    )
  order by
    case when lower(btrim(stations.name)) = 'beverage kitchen' then 0 else 1 end,
    stations.priority,
    stations.name
  limit 1;

  beverage_station_id := coalesce(beverage_station_id, main_station_id);

  for template_record in
    select *
    from public.restaurant_starter_templates templates
    where templates.template_key = any(normalized_keys)
      and templates.active = true
    order by templates.display_order, templates.name
  loop
    if exists (
      select 1
      from public.restaurant_starter_template_imports imports
      where imports.restaurant_id = target_restaurant_id
        and imports.template_id = template_record.id
    ) then
      skipped_templates := skipped_templates + 1;
      continue;
    end if;

    template_categories := 0;
    template_items := 0;

    for category_record in
      select *
      from public.restaurant_starter_template_categories categories
      where categories.template_id = template_record.id
      order by categories.display_order, categories.name
    loop
      copied_category_id := null;
      row_was_inserted := 0;

      insert into public.categories (
        restaurant_id,
        name,
        description,
        display_order
      )
      values (
        target_restaurant_id,
        category_record.name,
        category_record.description,
        category_record.display_order
      )
      on conflict (restaurant_id, name) do nothing
      returning id into copied_category_id;

      get diagnostics row_was_inserted = row_count;
      if row_was_inserted > 0 then
        inserted_categories := inserted_categories + 1;
        template_categories := template_categories + 1;
      end if;

      if copied_category_id is null then
        select id
        into copied_category_id
        from public.categories
        where restaurant_id = target_restaurant_id
          and lower(btrim(name)) = lower(btrim(category_record.name))
        order by created_at
        limit 1;
      end if;

      if copied_category_id is null then
        raise exception 'Starter category % could not be copied.', category_record.name;
      end if;

      for item_record in
        select *
        from public.restaurant_starter_template_items items
        where items.template_category_id = category_record.id
        order by items.display_order, items.name
      loop
        if exists (
          select 1
          from public.menu_items existing
          where existing.restaurant_id = target_restaurant_id
            and existing.category_id = copied_category_id
            and lower(btrim(existing.name)) = lower(btrim(item_record.name))
            and coalesce(existing.archived_at, 'infinity'::timestamptz) = 'infinity'::timestamptz
        ) then
          continue;
        end if;

        selected_station_id := case
          when item_record.suggested_station = 'beverage' then beverage_station_id
          else main_station_id
        end;

        insert into public.menu_items (
          restaurant_id,
          category_id,
          name,
          description,
          ingredients,
          allergens,
          preparation_time_minutes,
          spice_level,
          dietary_tags,
          calories,
          protein_g,
          carbohydrates_g,
          fat_g,
          fiber_g,
          sugar_g,
          sodium_mg,
          price,
          image_url,
          available,
          kitchen_station_id,
          display_order
        )
        values (
          target_restaurant_id,
          copied_category_id,
          item_record.name,
          item_record.description,
          item_record.ingredients,
          item_record.allergens,
          item_record.preparation_time_minutes,
          item_record.spice_level,
          item_record.dietary_tags,
          item_record.calories,
          item_record.protein_g,
          item_record.carbohydrates_g,
          item_record.fat_g,
          item_record.fiber_g,
          item_record.sugar_g,
          item_record.sodium_mg,
          0,
          null,
          true,
          selected_station_id,
          item_record.display_order
        );

        inserted_items := inserted_items + 1;
        template_items := template_items + 1;
      end loop;
    end loop;

    insert into public.restaurant_starter_template_imports (
      restaurant_id,
      template_id,
      imported_by,
      category_count,
      item_count
    )
    values (
      target_restaurant_id,
      template_record.id,
      auth.uid(),
      template_categories,
      template_items
    )
    on conflict (restaurant_id, template_id) do nothing;

    get diagnostics row_was_inserted = row_count;
    if row_was_inserted > 0 then
      imported_templates := imported_templates + 1;
    else
      skipped_templates := skipped_templates + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'requested_templates', requested_count,
    'imported_templates', imported_templates,
    'skipped_templates', skipped_templates,
    'categories_created', inserted_categories,
    'items_created', inserted_items
  );
end;
$$;

revoke all on function public.import_restaurant_starter_templates(uuid, text[]) from public, anon;
grant execute on function public.import_restaurant_starter_templates(uuid, text[]) to authenticated;
