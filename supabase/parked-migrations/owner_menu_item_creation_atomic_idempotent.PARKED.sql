-- Owner Menu Phase 3B: atomic, retry-safe creation for new menu items.
-- Storage remains a separate, deterministic and retryable operation.

create table public.menu_item_creation_operations (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  request_id uuid not null,
  actor_user_id uuid not null,
  request_fingerprint text not null,
  menu_item_id uuid not null,
  result jsonb not null,
  photo_state text not null check (photo_state in ('none', 'pending', 'attached')),
  expected_photo_path text,
  attached_photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, request_id),
  constraint menu_item_creation_photo_state_check check (
    (photo_state = 'none' and expected_photo_path is null and attached_photo_url is null)
    or (photo_state = 'pending' and expected_photo_path is not null and attached_photo_url is null)
    or (photo_state = 'attached' and expected_photo_path is not null and attached_photo_url is not null)
  )
);

create index menu_item_creation_operations_item_idx
  on public.menu_item_creation_operations(restaurant_id, menu_item_id);

create index menu_item_creation_operations_pending_photo_idx
  on public.menu_item_creation_operations(restaurant_id, updated_at)
  where photo_state = 'pending';

alter table public.menu_item_creation_operations enable row level security;
revoke all on public.menu_item_creation_operations from public, anon, authenticated;

create or replace function public.create_owner_menu_item_v1(
  target_restaurant_id uuid,
  target_request_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_id uuid := auth.uid();
  existing public.menu_item_creation_operations;
  saved public.menu_items;
  created_recipe jsonb;
  result jsonb;
  fingerprint text;
  normalized_payload jsonb;
  normalized_name text;
  normalized_description text;
  normalized_category_name text;
  category_id uuid;
  recipe_id uuid;
  direct_inventory_item_id uuid;
  station_id uuid;
  tracking_mode text;
  photo_content_type text;
  photo_extension text;
  expected_photo_path text;
  ingredients text[];
  price numeric;
  preparation_time integer;
  calories integer;
  protein_g numeric;
  carbohydrates_g numeric;
  fat_g numeric;
  fiber_g numeric;
  sugar_g numeric;
  sodium_mg numeric;
  initially_available boolean;
  auto_created_recipe boolean := false;
begin
  if actor_id is null
     or target_restaurant_id is null
     or not public.has_staff_role(
       target_restaurant_id,
       array['owner']::public.restaurant_staff_role[]
     ) then
    raise exception 'Owner menu item creation access denied.';
  end if;
  if target_request_id is null then
    raise exception 'Menu item creation request ID is required.';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Menu item creation payload is invalid.';
  end if;

  normalized_name := btrim(coalesce(payload->>'name', ''));
  normalized_description := nullif(btrim(coalesce(payload->>'description', '')), '');
  normalized_category_name := nullif(btrim(coalesce(payload->>'new_category_name', '')), '');
  tracking_mode := lower(btrim(coalesce(payload->>'tracking_mode', 'no_tracking')));
  photo_content_type := nullif(lower(btrim(coalesce(payload->>'photo_content_type', ''))), '');

  begin
    category_id := nullif(payload->>'category_id', '')::uuid;
    recipe_id := nullif(payload->>'recipe_id', '')::uuid;
    direct_inventory_item_id := nullif(payload->>'direct_inventory_item_id', '')::uuid;
    station_id := nullif(payload->>'kitchen_station_id', '')::uuid;
    price := (payload->>'price')::numeric;
    preparation_time := nullif(payload->>'preparation_time_minutes', '')::integer;
    calories := nullif(payload->>'calories', '')::integer;
    protein_g := nullif(payload->>'protein_g', '')::numeric;
    carbohydrates_g := nullif(payload->>'carbohydrates_g', '')::numeric;
    fat_g := nullif(payload->>'fat_g', '')::numeric;
    fiber_g := nullif(payload->>'fiber_g', '')::numeric;
    sugar_g := nullif(payload->>'sugar_g', '')::numeric;
    sodium_mg := nullif(payload->>'sodium_mg', '')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Menu item creation payload contains an invalid value.';
  end;

  if normalized_name = '' or char_length(normalized_name) < 2 then
    raise exception 'Item name must be at least 2 characters.';
  end if;
  if price is null or price <= 0 then
    raise exception 'Price must be greater than zero.';
  end if;
  if preparation_time is not null and preparation_time < 0 then
    raise exception 'Preparation time cannot be negative.';
  end if;
  if calories is not null and calories < 0
     or protein_g is not null and protein_g < 0
     or carbohydrates_g is not null and carbohydrates_g < 0
     or fat_g is not null and fat_g < 0
     or fiber_g is not null and fiber_g < 0
     or sugar_g is not null and sugar_g < 0
     or sodium_mg is not null and sodium_mg < 0 then
    raise exception 'Nutrition values cannot be negative.';
  end if;
  if tracking_mode not in ('no_tracking', 'recipe', 'direct_inventory') then
    raise exception 'Inventory tracking mode is invalid.';
  end if;
  if tracking_mode = 'no_tracking' and (recipe_id is not null or direct_inventory_item_id is not null)
     or tracking_mode = 'recipe' and direct_inventory_item_id is not null
     or tracking_mode = 'direct_inventory' and (recipe_id is not null or direct_inventory_item_id is null) then
    raise exception 'Inventory tracking selection is invalid.';
  end if;
  if normalized_category_name is null and category_id is null then
    raise exception 'Choose a category or create a new one.';
  end if;
  if photo_content_type is not null then
    photo_extension := case photo_content_type
      when 'image/jpeg' then 'jpg'
      when 'image/png' then 'png'
      when 'image/webp' then 'webp'
      when 'image/gif' then 'gif'
      else null
    end;
    if photo_extension is null then
      raise exception 'Menu photo type is not supported.';
    end if;
  end if;
  if payload ? 'ingredients' and jsonb_typeof(payload->'ingredients') <> 'array' then
    raise exception 'Menu item ingredients are invalid.';
  end if;
  select coalesce(array_agg(value order by ordinal), array[]::text[])
  into ingredients
  from (
    select btrim(element.value) value, element.ordinality ordinal
    from jsonb_array_elements_text(coalesce(payload->'ingredients', '[]'::jsonb))
      with ordinality element(value, ordinality)
    where btrim(element.value) <> ''
  ) cleaned;
  initially_available := coalesce((payload->>'available')::boolean, true);

  normalized_payload := jsonb_strip_nulls(jsonb_build_object(
    'name', normalized_name,
    'description', normalized_description,
    'price', price,
    'category_id', case when normalized_category_name is null then category_id else null end,
    'new_category_name', case when normalized_category_name is null then null else lower(normalized_category_name) end,
    'tracking_mode', tracking_mode,
    'recipe_id', recipe_id,
    'direct_inventory_item_id', direct_inventory_item_id,
    'kitchen_station_id', station_id,
    'available', initially_available,
    'ingredients', to_jsonb(ingredients),
    'preparation_time_minutes', preparation_time,
    'calories', calories,
    'protein_g', protein_g,
    'carbohydrates_g', carbohydrates_g,
    'fat_g', fat_g,
    'fiber_g', fiber_g,
    'sugar_g', sugar_g,
    'sodium_mg', sodium_mg,
    'photo_content_type', photo_content_type
  ));
  fingerprint := encode(extensions.digest(convert_to(normalized_payload::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended(target_restaurant_id::text || ':owner-menu-create:' || target_request_id::text, 0)
  );
  select operation.* into existing
  from public.menu_item_creation_operations operation
  where operation.restaurant_id = target_restaurant_id
    and operation.request_id = target_request_id;
  if found then
    if existing.actor_user_id <> actor_id or existing.request_fingerprint <> fingerprint then
      raise exception 'Menu item creation request was already used with different details.';
    end if;
    return jsonb_set(existing.result, '{replayed}', 'true'::jsonb, true);
  end if;

  if normalized_category_name is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(target_restaurant_id::text || ':menu-category:' || lower(normalized_category_name), 0)
    );
    select category.id into category_id
    from public.categories category
    where category.restaurant_id = target_restaurant_id
      and lower(btrim(category.name)) = lower(normalized_category_name)
    order by category.created_at, category.id
    limit 1;
    if category_id is null then
      insert into public.categories(restaurant_id, name)
      values (target_restaurant_id, normalized_category_name)
      returning id into category_id;
    end if;
  elsif not exists (
    select 1 from public.categories category
    where category.restaurant_id = target_restaurant_id and category.id = category_id
  ) then
    raise exception 'Category is invalid for this restaurant.';
  end if;

  if tracking_mode = 'recipe' then
    if recipe_id is null then
      created_recipe := public.manage_recipe('create', jsonb_build_object(
        'restaurant_id', target_restaurant_id,
        'name', normalized_name,
        'description', null,
        'category_id', null,
        'preparation_time_minutes', coalesce(preparation_time, 0),
        'yield_quantity', 1,
        'yield_unit', 'serving',
        'status', 'active'
      ));
      recipe_id := (created_recipe->>'id')::uuid;
      auto_created_recipe := true;
    elsif not exists (
      select 1 from public.recipes recipe
      where recipe.restaurant_id = target_restaurant_id and recipe.id = recipe_id
        and recipe.status = 'active' and recipe.deleted_at is null
    ) then
      raise exception 'Recipe is invalid for this restaurant.';
    end if;
  else
    recipe_id := null;
  end if;

  if tracking_mode = 'direct_inventory' then
    if not exists (
      select 1 from public.inventory_items item
      where item.restaurant_id = target_restaurant_id
        and item.id = direct_inventory_item_id
        and item.status = 'active' and item.active = true
    ) then
      raise exception 'Direct inventory item is invalid for this restaurant.';
    end if;
  else
    direct_inventory_item_id := null;
  end if;

  if station_id is not null and not exists (
    select 1
    from public.kitchen_stations station
    where station.restaurant_id = target_restaurant_id
      and station.id = station_id
      and station.active = true
      and station.archived_at is null
  ) then
    raise exception 'Kitchen station is invalid for this restaurant.';
  end if;

  insert into public.menu_items(
    restaurant_id, name, description, preparation_time_minutes, price,
    category_id, kitchen_station_id, available, image_url, ingredients,
    calories, protein_g, carbohydrates_g, fat_g, fiber_g, sugar_g, sodium_mg,
    recipe_id, direct_inventory_item_id
  ) values (
    target_restaurant_id, normalized_name, normalized_description, preparation_time, price,
    category_id, station_id, initially_available, null, nullif(ingredients, array[]::text[]),
    calories, protein_g, carbohydrates_g, fat_g, fiber_g, sugar_g, sodium_mg,
    recipe_id, direct_inventory_item_id
  ) returning * into saved;

  if photo_extension is not null then
    expected_photo_path := target_restaurant_id::text || '/' || saved.id::text || '/'
      || target_request_id::text || '.' || photo_extension;
  end if;
  result := jsonb_build_object(
    'request_id', target_request_id,
    'replayed', false,
    'menu_item', jsonb_build_object(
      'id', saved.id,
      'restaurant_id', saved.restaurant_id,
      'name', saved.name,
      'description', saved.description,
      'preparation_time_minutes', saved.preparation_time_minutes,
      'price', saved.price,
      'category_id', saved.category_id,
      'kitchen_station_id', saved.kitchen_station_id,
      'available', saved.available,
      'image_url', saved.image_url,
      'ingredients', saved.ingredients,
      'calories', saved.calories,
      'protein_g', saved.protein_g,
      'carbohydrates_g', saved.carbohydrates_g,
      'fat_g', saved.fat_g,
      'fiber_g', saved.fiber_g,
      'sugar_g', saved.sugar_g,
      'sodium_mg', saved.sodium_mg,
      'recipe_id', saved.recipe_id,
      'direct_inventory_item_id', saved.direct_inventory_item_id
    ),
    'category', jsonb_build_object('id', category_id),
    'tracking_mode', tracking_mode,
    'auto_created_recipe', auto_created_recipe,
    'recipe_id', recipe_id,
    'photo_state', case when expected_photo_path is null then 'none' else 'pending' end,
    'photo_object_path', expected_photo_path
  );

  insert into public.menu_item_creation_operations(
    restaurant_id, request_id, actor_user_id, request_fingerprint,
    menu_item_id, result, photo_state, expected_photo_path
  ) values (
    target_restaurant_id, target_request_id, actor_id, fingerprint,
    saved.id, result,
    case when expected_photo_path is null then 'none' else 'pending' end,
    expected_photo_path
  );
  return result;
end;
$function$;

create or replace function public.finalize_owner_menu_item_photo_v1(
  target_restaurant_id uuid,
  target_request_id uuid,
  target_menu_item_id uuid,
  target_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor_id uuid := auth.uid();
  operation public.menu_item_creation_operations;
  trusted_project_url text;
  public_url text;
  updated_result jsonb;
begin
  if actor_id is null
     or target_restaurant_id is null
     or not public.has_staff_role(
       target_restaurant_id,
       array['owner']::public.restaurant_staff_role[]
     ) then
    raise exception 'Owner menu photo access denied.';
  end if;
  if target_request_id is null or target_menu_item_id is null then
    raise exception 'Menu photo operation identity is required.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_restaurant_id::text || ':owner-menu-create:' || target_request_id::text, 0)
  );
  select candidate.* into operation
  from public.menu_item_creation_operations candidate
  where candidate.restaurant_id = target_restaurant_id
    and candidate.request_id = target_request_id
  for update;
  if operation.request_id is null
     or operation.actor_user_id <> actor_id
     or operation.menu_item_id <> target_menu_item_id then
    raise exception 'Menu photo operation is invalid.';
  end if;
  if operation.expected_photo_path is null
     or target_object_path is distinct from operation.expected_photo_path then
    raise exception 'Menu photo object path is invalid.';
  end if;
  if operation.photo_state = 'attached' then
    return jsonb_build_object(
      'request_id', target_request_id,
      'menu_item_id', target_menu_item_id,
      'photo_state', 'attached',
      'image_url', operation.attached_photo_url,
      'replayed', true
    );
  end if;
  if not exists (
    select 1 from public.menu_items item
    where item.restaurant_id = target_restaurant_id and item.id = target_menu_item_id
  ) then
    raise exception 'Menu item is unavailable for photo attachment.';
  end if;
  if not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'menu-photos'
      and object.name = target_object_path
  ) then
    raise exception 'Menu photo upload is unavailable for attachment.';
  end if;

  trusted_project_url := regexp_replace(
    coalesce(auth.jwt()->>'iss', ''),
    '/auth/v1/?$',
    ''
  );
  if trusted_project_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Trusted menu photo origin is unavailable.';
  end if;
  public_url := trusted_project_url || '/storage/v1/object/public/menu-photos/' || target_object_path;

  update public.menu_items
  set image_url = public_url
  where restaurant_id = target_restaurant_id and id = target_menu_item_id;
  updated_result := jsonb_set(
    jsonb_set(operation.result, '{photo_state}', '"attached"'::jsonb, true),
    '{menu_item,image_url}', to_jsonb(public_url), true
  );
  update public.menu_item_creation_operations
  set photo_state = 'attached', attached_photo_url = public_url,
      result = updated_result, updated_at = clock_timestamp()
  where restaurant_id = target_restaurant_id and request_id = target_request_id;

  return jsonb_build_object(
    'request_id', target_request_id,
    'menu_item_id', target_menu_item_id,
    'photo_state', 'attached',
    'image_url', public_url,
    'replayed', false
  );
end;
$function$;

revoke all on function public.create_owner_menu_item_v1(uuid, uuid, jsonb) from public, anon;
revoke all on function public.finalize_owner_menu_item_photo_v1(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.create_owner_menu_item_v1(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.finalize_owner_menu_item_photo_v1(uuid, uuid, uuid, text) to authenticated, service_role;

comment on table public.menu_item_creation_operations is
  'Internal durable idempotency and photo recovery state for Owner Add Item operations.';
comment on function public.create_owner_menu_item_v1(uuid, uuid, jsonb) is
  'Owner-only atomic menu item creation. Storage upload occurs after this transaction.';
comment on function public.finalize_owner_menu_item_photo_v1(uuid, uuid, uuid, text) is
  'Owner-only idempotent attachment of the exact operation-scoped public menu photo path.';
