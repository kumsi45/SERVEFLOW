-- SERVEFLOW Phase 4D Restaurant Starter Kits.
-- System-owned menu templates copied into restaurant-owned menu rows during setup.

alter table public.categories
  add column if not exists description text,
  add column if not exists display_order integer not null default 0;

alter table public.menu_items
  add column if not exists description text,
  add column if not exists preparation_time_minutes integer,
  add column if not exists display_order integer not null default 0;

alter table public.menu_items
  drop constraint if exists menu_items_preparation_time_non_negative,
  add constraint menu_items_preparation_time_non_negative
    check (preparation_time_minutes is null or preparation_time_minutes >= 0);

create table if not exists public.restaurant_starter_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  restaurant_type text not null,
  name text not null,
  description text not null default '',
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_starter_templates_key_not_blank check (length(btrim(template_key)) > 0),
  constraint restaurant_starter_templates_type_not_blank check (length(btrim(restaurant_type)) > 0),
  constraint restaurant_starter_templates_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.restaurant_starter_template_categories (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.restaurant_starter_templates(id) on delete cascade,
  name text not null,
  description text not null default '',
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint restaurant_starter_template_categories_name_not_blank check (length(btrim(name)) > 0)
);

create table if not exists public.restaurant_starter_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.restaurant_starter_templates(id) on delete cascade,
  template_category_id uuid not null references public.restaurant_starter_template_categories(id) on delete cascade,
  name text not null,
  description text not null default '',
  preparation_time_minutes integer not null default 10,
  suggested_station text not null default 'main',
  available boolean not null default true,
  price numeric(12, 2) not null default 0,
  image_url text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint restaurant_starter_template_items_name_not_blank check (length(btrim(name)) > 0),
  constraint restaurant_starter_template_items_station_valid check (suggested_station in ('main', 'beverage')),
  constraint restaurant_starter_template_items_price_zero check (price = 0),
  constraint restaurant_starter_template_items_preparation_non_negative check (preparation_time_minutes >= 0)
);

create table if not exists public.restaurant_starter_template_imports (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  template_id uuid not null references public.restaurant_starter_templates(id) on delete restrict,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  category_count integer not null default 0,
  item_count integer not null default 0,
  unique (restaurant_id, template_id)
);

create index if not exists restaurant_starter_templates_type_idx
on public.restaurant_starter_templates (restaurant_type, display_order, name)
where active = true;

create unique index if not exists restaurant_starter_template_categories_unique
on public.restaurant_starter_template_categories (template_id, lower(btrim(name)));

create index if not exists restaurant_starter_template_items_category_sort_idx
on public.restaurant_starter_template_items (template_category_id, display_order, name);

create index if not exists restaurant_starter_template_imports_restaurant_idx
on public.restaurant_starter_template_imports (restaurant_id, imported_at desc);

alter table public.restaurant_starter_templates enable row level security;
alter table public.restaurant_starter_template_categories enable row level security;
alter table public.restaurant_starter_template_items enable row level security;
alter table public.restaurant_starter_template_imports enable row level security;

revoke all on public.restaurant_starter_templates from anon, authenticated;
revoke all on public.restaurant_starter_template_categories from anon, authenticated;
revoke all on public.restaurant_starter_template_items from anon, authenticated;
revoke all on public.restaurant_starter_template_imports from anon, authenticated;

grant select on public.restaurant_starter_templates to authenticated;
grant select on public.restaurant_starter_template_categories to authenticated;
grant select on public.restaurant_starter_template_items to authenticated;
grant select on public.restaurant_starter_template_imports to authenticated;

drop policy if exists restaurant_starter_templates_read_authenticated on public.restaurant_starter_templates;
create policy restaurant_starter_templates_read_authenticated
on public.restaurant_starter_templates
for select
to authenticated
using (active = true);

drop policy if exists restaurant_starter_template_categories_read_authenticated on public.restaurant_starter_template_categories;
create policy restaurant_starter_template_categories_read_authenticated
on public.restaurant_starter_template_categories
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_starter_templates templates
    where templates.id = restaurant_starter_template_categories.template_id
      and templates.active = true
  )
);

drop policy if exists restaurant_starter_template_items_read_authenticated on public.restaurant_starter_template_items;
create policy restaurant_starter_template_items_read_authenticated
on public.restaurant_starter_template_items
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_starter_templates templates
    where templates.id = restaurant_starter_template_items.template_id
      and templates.active = true
  )
);

drop policy if exists restaurant_starter_template_imports_owner_read on public.restaurant_starter_template_imports;
create policy restaurant_starter_template_imports_owner_read
on public.restaurant_starter_template_imports
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

create or replace function public.set_restaurant_starter_templates_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_restaurant_starter_templates_updated_at on public.restaurant_starter_templates;
create trigger set_restaurant_starter_templates_updated_at
before update on public.restaurant_starter_templates
for each row
execute function public.set_restaurant_starter_templates_updated_at();

do $$
declare
  templates_payload jsonb := $json$
[
  {"key":"ethiopian_traditional_foods","type":"Ethiopian Restaurant","name":"Traditional Ethiopian Foods","description":"Essential Ethiopian staples for dine-in service.","order":10,"categories":[
    {"name":"Traditional Foods","description":"Classic stews and staples served with injera.","order":10,"items":[
      {"name":"Shiro","description":"Slow cooked chickpea stew with berbere and house spices.","prep":18,"station":"main","order":10},
      {"name":"Firfir","description":"Torn injera tossed with spiced sauce and clarified butter.","prep":14,"station":"main","order":20},
      {"name":"Doro Wot","description":"Rich chicken stew with berbere, egg, and traditional seasoning.","prep":28,"station":"main","order":30}
    ]},
    {"name":"Tibs","description":"Sauteed meat dishes served hot from the pan.","order":20,"items":[
      {"name":"Beef Tibs","description":"Tender beef sauteed with onion, pepper, rosemary, and spices.","prep":20,"station":"main","order":10},
      {"name":"Awaze Tibs","description":"Beef tibs finished with a bold awaze sauce.","prep":22,"station":"main","order":20}
    ]},
    {"name":"Kitfo","description":"Minced beef preparations with mitmita and spiced butter.","order":30,"items":[
      {"name":"Special Kitfo","description":"Finely minced beef seasoned with mitmita and niter kibbeh.","prep":16,"station":"main","order":10},
      {"name":"Gored Gored","description":"Cubed beef tossed with awaze and clarified butter.","prep":15,"station":"main","order":20}
    ]},
    {"name":"Beyaynet","description":"Combination platters for shared Ethiopian meals.","order":40,"items":[
      {"name":"Vegetarian Beyaynet","description":"Assorted lentils, greens, shiro, and vegetables on injera.","prep":18,"station":"main","order":10},
      {"name":"Meat Combination","description":"Mixed meat stews and tibs arranged for sharing.","prep":25,"station":"main","order":20}
    ]}
  ]},
  {"key":"ethiopian_breakfast","type":"Ethiopian Restaurant","name":"Ethiopian Breakfast","description":"Morning dishes for cafes and traditional restaurants.","order":20,"categories":[
    {"name":"Breakfast","description":"Comforting breakfast plates and porridges.","order":10,"items":[
      {"name":"Chechebsa","description":"Pan torn flatbread tossed with spiced butter and berbere.","prep":12,"station":"main","order":10},
      {"name":"Ful","description":"Warm fava beans with tomato, onion, chili, and bread.","prep":12,"station":"main","order":20},
      {"name":"Kinche","description":"Cracked wheat porridge finished with spiced butter.","prep":14,"station":"main","order":30}
    ]}
  ]},
  {"key":"coffee_tea","type":"Cafe","name":"Coffee & Tea","description":"Core hot beverage menu for daily service.","order":10,"categories":[
    {"name":"Coffee","description":"Espresso drinks and Ethiopian coffee service.","order":10,"items":[
      {"name":"Espresso","description":"Single concentrated coffee shot served hot.","prep":4,"station":"beverage","order":10},
      {"name":"Macchiato","description":"Espresso topped with steamed milk foam.","prep":5,"station":"beverage","order":20},
      {"name":"Latte","description":"Espresso with steamed milk and a smooth finish.","prep":6,"station":"beverage","order":30},
      {"name":"Mocha","description":"Espresso with chocolate and steamed milk.","prep":7,"station":"beverage","order":40},
      {"name":"Cappuccino","description":"Espresso with steamed milk and thick foam.","prep":6,"station":"beverage","order":50}
    ]},
    {"name":"Tea","description":"Hot teas and infusions.","order":20,"items":[
      {"name":"Black Tea","description":"Fresh brewed black tea served hot.","prep":5,"station":"beverage","order":10},
      {"name":"Spiced Tea","description":"Black tea brewed with cinnamon and warming spices.","prep":7,"station":"beverage","order":20}
    ]}
  ]},
  {"key":"fresh_juices","type":"Juice Bar","name":"Fresh Juices","description":"Fresh blended fruit drinks and smoothies.","order":10,"categories":[
    {"name":"Fresh Juice","description":"Made to order fruit juices.","order":10,"items":[
      {"name":"Mango Juice","description":"Fresh mango blended smooth and served chilled.","prep":7,"station":"beverage","order":10},
      {"name":"Avocado Juice","description":"Creamy avocado juice with a light citrus finish.","prep":8,"station":"beverage","order":20},
      {"name":"Mixed Juice","description":"Layered seasonal fruit juice blend.","prep":9,"station":"beverage","order":30}
    ]},
    {"name":"Smoothie","description":"Cold blended smoothies.","order":20,"items":[
      {"name":"Banana Smoothie","description":"Banana blended with milk for a creamy drink.","prep":7,"station":"beverage","order":10},
      {"name":"Berry Smoothie","description":"Mixed berries blended into a chilled smoothie.","prep":8,"station":"beverage","order":20}
    ]}
  ]},
  {"key":"international_pizza_pasta","type":"International Restaurant","name":"Pizza & Pasta","description":"Popular international comfort dishes.","order":10,"categories":[
    {"name":"Pizza","description":"Classic pizzas baked to order.","order":10,"items":[
      {"name":"Margherita Pizza","description":"Tomato sauce, mozzarella, and basil.","prep":18,"station":"main","order":10},
      {"name":"Pepperoni Pizza","description":"Tomato sauce, mozzarella, and pepperoni slices.","prep":20,"station":"main","order":20},
      {"name":"Vegetarian Pizza","description":"Seasonal vegetables with mozzarella and tomato sauce.","prep":20,"station":"main","order":30},
      {"name":"Seafood Pizza","description":"Seafood topping with mozzarella and herbs.","prep":22,"station":"main","order":40}
    ]},
    {"name":"Pasta","description":"Sauced pasta dishes for lunch and dinner.","order":20,"items":[
      {"name":"Spaghetti Bolognese","description":"Spaghetti with slow cooked beef tomato sauce.","prep":20,"station":"main","order":10},
      {"name":"Penne Alfredo","description":"Penne tossed in creamy parmesan sauce.","prep":18,"station":"main","order":20},
      {"name":"Vegetable Pasta","description":"Pasta with sauteed vegetables and tomato sauce.","prep":18,"station":"main","order":30}
    ]}
  ]},
  {"key":"burgers_fast_food","type":"Fast Food","name":"Burgers & Fast Food","description":"Quick service burgers and fried favorites.","order":10,"categories":[
    {"name":"Burger","description":"House burgers prepared to order.","order":10,"items":[
      {"name":"Classic Burger","description":"Beef patty with lettuce, tomato, onion, and house sauce.","prep":15,"station":"main","order":10},
      {"name":"Cheese Burger","description":"Classic burger topped with melted cheese.","prep":16,"station":"main","order":20},
      {"name":"Chicken Burger","description":"Grilled chicken breast with crisp vegetables.","prep":16,"station":"main","order":30},
      {"name":"BBQ Burger","description":"Beef patty with barbecue sauce and caramelized onion.","prep":17,"station":"main","order":40}
    ]},
    {"name":"Chicken","description":"Fast casual chicken plates.","order":20,"items":[
      {"name":"Fried Chicken","description":"Crispy seasoned chicken served hot.","prep":18,"station":"main","order":10},
      {"name":"Chicken Wings","description":"Wings tossed with house sauce.","prep":16,"station":"main","order":20}
    ]}
  ]},
  {"key":"bakery_desserts","type":"Bakery","name":"Bakery & Desserts","description":"Baked goods, cakes, and sweet plates.","order":10,"categories":[
    {"name":"Bakery","description":"Fresh breads and pastries.","order":10,"items":[
      {"name":"Croissant","description":"Flaky butter croissant served fresh.","prep":5,"station":"main","order":10},
      {"name":"Cinnamon Roll","description":"Soft rolled pastry with cinnamon glaze.","prep":6,"station":"main","order":20},
      {"name":"Chocolate Muffin","description":"Moist muffin with chocolate pieces.","prep":5,"station":"main","order":30}
    ]},
    {"name":"Desserts","description":"Cake slices and plated sweets.","order":20,"items":[
      {"name":"Chocolate Cake","description":"Rich chocolate cake slice with frosting.","prep":6,"station":"main","order":10},
      {"name":"Cheesecake","description":"Creamy cheesecake slice with biscuit base.","prep":6,"station":"main","order":20},
      {"name":"Fruit Tart","description":"Pastry tart topped with seasonal fruit.","prep":7,"station":"main","order":30}
    ]}
  ]},
  {"key":"hotel_restaurant_all_day","type":"Hotel Restaurant","name":"Hotel All-Day Dining","description":"Breakfast, grill, and beverage basics for hotel service.","order":10,"categories":[
    {"name":"Breakfast","description":"Hotel breakfast standards.","order":10,"items":[
      {"name":"Omelette","description":"Three egg omelette with selected fillings.","prep":10,"station":"main","order":10},
      {"name":"Pancakes","description":"Stacked pancakes served with syrup.","prep":12,"station":"main","order":20}
    ]},
    {"name":"Fish","description":"Seafood and fish plates.","order":20,"items":[
      {"name":"Grilled Fish","description":"Seasoned fish fillet grilled with lemon butter.","prep":22,"station":"main","order":10},
      {"name":"Fish and Chips","description":"Crispy fish served with fries.","prep":20,"station":"main","order":20}
    ]},
    {"name":"Soft Drinks","description":"Bottled and canned cold drinks.","order":30,"items":[
      {"name":"Cola","description":"Chilled carbonated soft drink.","prep":2,"station":"beverage","order":10},
      {"name":"Sparkling Water","description":"Chilled sparkling water bottle.","prep":2,"station":"beverage","order":20}
    ]}
  ]},
  {"key":"fine_dining_core","type":"Fine Dining","name":"Fine Dining Core","description":"Starter, main course, dessert, and beverage foundation.","order":10,"categories":[
    {"name":"Starters","description":"Small plates to begin the meal.","order":10,"items":[
      {"name":"Soup of the Day","description":"Chef prepared seasonal soup.","prep":10,"station":"main","order":10},
      {"name":"Garden Salad","description":"Fresh greens with house dressing.","prep":8,"station":"main","order":20}
    ]},
    {"name":"Fish","description":"Refined fish and seafood dishes.","order":20,"items":[
      {"name":"Pan Seared Fish","description":"Fish fillet with seasonal vegetables.","prep":24,"station":"main","order":10},
      {"name":"Seafood Plate","description":"Mixed seafood with herb butter sauce.","prep":28,"station":"main","order":20}
    ]},
    {"name":"Desserts","description":"Plated desserts for table service.","order":30,"items":[
      {"name":"Tiramisu","description":"Coffee soaked layered dessert with mascarpone.","prep":7,"station":"main","order":10},
      {"name":"Creme Caramel","description":"Set custard with caramel sauce.","prep":7,"station":"main","order":20}
    ]}
  ]},
  {"key":"mixed_restaurant_starter","type":"Mixed Restaurant","name":"Mixed Restaurant Starter","description":"Broad starter menu across Ethiopian, international, and beverage service.","order":10,"categories":[
    {"name":"Traditional Foods","description":"Popular Ethiopian dishes.","order":10,"items":[
      {"name":"Shiro","description":"Chickpea stew with berbere and house spices.","prep":18,"station":"main","order":10},
      {"name":"Beef Tibs","description":"Sauteed beef with onion and pepper.","prep":20,"station":"main","order":20}
    ]},
    {"name":"Pizza","description":"Common pizza options.","order":20,"items":[
      {"name":"Margherita Pizza","description":"Tomato sauce, mozzarella, and basil.","prep":18,"station":"main","order":10},
      {"name":"Vegetarian Pizza","description":"Vegetable pizza with mozzarella.","prep":20,"station":"main","order":20}
    ]},
    {"name":"Burger","description":"Casual burger plates.","order":30,"items":[
      {"name":"Classic Burger","description":"Beef burger with lettuce, tomato, and house sauce.","prep":15,"station":"main","order":10},
      {"name":"Chicken Burger","description":"Chicken burger with crisp vegetables.","prep":16,"station":"main","order":20}
    ]},
    {"name":"Coffee","description":"Hot coffee drinks.","order":40,"items":[
      {"name":"Macchiato","description":"Espresso topped with steamed milk foam.","prep":5,"station":"beverage","order":10},
      {"name":"Latte","description":"Espresso with steamed milk.","prep":6,"station":"beverage","order":20}
    ]}
  ]},
  {"key":"cafe_breakfast_dessert","type":"Cafe","name":"Cafe Breakfast & Desserts","description":"Simple food menu for cafe service.","order":20,"categories":[
    {"name":"Breakfast","description":"Light breakfast dishes.","order":10,"items":[
      {"name":"Omelette","description":"Fresh egg omelette with herbs.","prep":10,"station":"main","order":10},
      {"name":"Toast Plate","description":"Toast served with eggs and sides.","prep":9,"station":"main","order":20}
    ]},
    {"name":"Desserts","description":"Cafe sweets and cakes.","order":20,"items":[
      {"name":"Chocolate Cake","description":"Rich chocolate cake slice.","prep":6,"station":"main","order":10},
      {"name":"Cheesecake","description":"Creamy cheesecake slice.","prep":6,"station":"main","order":20}
    ]}
  ]},
  {"key":"juice_bar_snacks","type":"Juice Bar","name":"Juice Bar Snacks","description":"Light snacks and bottled drinks for juice bars.","order":20,"categories":[
    {"name":"Water","description":"Still and sparkling water.","order":10,"items":[
      {"name":"Still Water","description":"Chilled bottled still water.","prep":2,"station":"beverage","order":10},
      {"name":"Sparkling Water","description":"Chilled sparkling water.","prep":2,"station":"beverage","order":20}
    ]},
    {"name":"Healthy Snacks","description":"Simple light food options.","order":20,"items":[
      {"name":"Fruit Bowl","description":"Seasonal fruit served chilled.","prep":6,"station":"main","order":10},
      {"name":"Granola Cup","description":"Granola with yogurt and fruit.","prep":6,"station":"main","order":20}
    ]}
  ]},
  {"key":"drinks_soft_water","type":"International Restaurant","name":"Drinks","description":"Cold beverages for table service.","order":20,"categories":[
    {"name":"Soft Drinks","description":"Chilled soft drinks.","order":10,"items":[
      {"name":"Cola","description":"Chilled carbonated soft drink.","prep":2,"station":"beverage","order":10},
      {"name":"Orange Soda","description":"Chilled orange flavored soft drink.","prep":2,"station":"beverage","order":20}
    ]},
    {"name":"Water","description":"Bottled water options.","order":20,"items":[
      {"name":"Still Water","description":"Chilled bottled still water.","prep":2,"station":"beverage","order":10},
      {"name":"Sparkling Water","description":"Chilled sparkling water.","prep":2,"station":"beverage","order":20}
    ]}
  ]}
]
$json$::jsonb;
  template_payload jsonb;
  category_payload jsonb;
  item_payload jsonb;
  seeded_template_id uuid;
  seeded_category_id uuid;
begin
  for template_payload in select value from jsonb_array_elements(templates_payload) loop
    insert into public.restaurant_starter_templates (
      template_key,
      restaurant_type,
      name,
      description,
      display_order,
      active
    )
    values (
      template_payload->>'key',
      template_payload->>'type',
      template_payload->>'name',
      coalesce(template_payload->>'description', ''),
      coalesce((template_payload->>'order')::integer, 0),
      true
    )
    on conflict (template_key) do update
    set restaurant_type = excluded.restaurant_type,
        name = excluded.name,
        description = excluded.description,
        display_order = excluded.display_order,
        active = true
    returning id into seeded_template_id;

    delete from public.restaurant_starter_template_categories
    where restaurant_starter_template_categories.template_id = seeded_template_id;

    for category_payload in select value from jsonb_array_elements(template_payload->'categories') loop
      insert into public.restaurant_starter_template_categories (
        template_id,
        name,
        description,
        display_order
      )
      values (
        seeded_template_id,
        category_payload->>'name',
        coalesce(category_payload->>'description', ''),
        coalesce((category_payload->>'order')::integer, 0)
      )
      returning id into seeded_category_id;

      for item_payload in select value from jsonb_array_elements(category_payload->'items') loop
        insert into public.restaurant_starter_template_items (
          template_id,
          template_category_id,
          name,
          description,
          preparation_time_minutes,
          suggested_station,
          available,
          price,
          image_url,
          display_order
        )
        values (
          seeded_template_id,
          seeded_category_id,
          item_payload->>'name',
          coalesce(item_payload->>'description', ''),
          coalesce((item_payload->>'prep')::integer, 10),
          coalesce(item_payload->>'station', 'main'),
          true,
          0,
          null,
          coalesce((item_payload->>'order')::integer, 0)
        );
      end loop;
    end loop;
  end loop;
end;
$$;

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
                  'preparation_time_minutes', items.preparation_time_minutes,
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
          price,
          image_url,
          available,
          kitchen_station_id,
          preparation_time_minutes,
          display_order
        )
        values (
          target_restaurant_id,
          copied_category_id,
          item_record.name,
          item_record.description,
          0,
          null,
          true,
          selected_station_id,
          item_record.preparation_time_minutes,
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

drop function if exists public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text[]);

create or replace function public.complete_restaurant_setup(
  target_restaurant_id uuid,
  restaurant_info_payload jsonb,
  branding_payload jsonb,
  table_payload jsonb,
  business_hours_payload jsonb,
  kitchen_payload jsonb,
  staff_invitations_payload jsonb,
  starter_template_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  updated_restaurant public.restaurants;
  requested_table_count integer;
  requested_table_count_text text;
  restaurant_name text;
  restaurant_type text;
  currency text;
  timezone_name text;
  allowed_types text[] := array[
    'Ethiopian Restaurant',
    'International Restaurant',
    'Cafe',
    'Hotel Restaurant',
    'Fast Food',
    'Bakery',
    'Juice Bar',
    'Fine Dining',
    'Mixed Restaurant',
    'Restaurant',
    'Juice House',
    'Bar'
  ];
  normalized_branding jsonb;
  normalized_profile jsonb;
  normalized_business_hours jsonb;
  normalized_kitchen_settings jsonb;
  normalized_setup_status jsonb;
  starter_template_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to complete setup.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may complete setup.';
  end if;

  select *
  into target_restaurant
  from public.restaurants
  where id = target_restaurant_id
  for update;

  if target_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  restaurant_name := nullif(trim(coalesce(restaurant_info_payload->>'restaurant_name', target_restaurant.name)), '');
  restaurant_type := nullif(trim(coalesce(restaurant_info_payload->>'restaurant_type', '')), '');
  currency := nullif(trim(coalesce(restaurant_info_payload->>'currency', 'ETB')), '');
  timezone_name := nullif(trim(coalesce(restaurant_info_payload->>'timezone', 'Africa/Nairobi')), '');

  if restaurant_name is null or length(restaurant_name) < 2 then
    raise exception 'Restaurant name must be at least 2 characters.';
  end if;

  if restaurant_type is null or restaurant_type <> all(allowed_types) then
    raise exception 'Restaurant type is not supported.';
  end if;

  if currency is null or length(currency) < 2 or length(currency) > 8 then
    raise exception 'Currency is required.';
  end if;

  if timezone_name is null or length(timezone_name) < 2 or length(timezone_name) > 80 then
    raise exception 'Timezone is required.';
  end if;

  requested_table_count_text := nullif(trim(coalesce(table_payload->>'table_count', '')), '');
  if requested_table_count_text is not null and requested_table_count_text !~ '^[0-9]+$' then
    raise exception 'Table count must be a whole number.';
  end if;

  requested_table_count := coalesce(requested_table_count_text::integer, target_restaurant.table_count, target_restaurant.total_tables, 20);
  requested_table_count := greatest(1, least(500, requested_table_count));

  normalized_profile :=
    coalesce(target_restaurant.profile, '{}'::jsonb)
    || jsonb_build_object(
      'restaurant_type', restaurant_type,
      'currency', currency,
      'timezone', timezone_name,
      'phone', coalesce(restaurant_info_payload->>'phone', target_restaurant.profile->>'phone', ''),
      'address', coalesce(restaurant_info_payload->>'address', target_restaurant.profile->>'address', ''),
      'description', coalesce(restaurant_info_payload->>'description', target_restaurant.profile->>'description', ''),
      'tin_vat', coalesce(branding_payload->>'tin_vat', target_restaurant.profile->>'tin_vat', ''),
      'receipt_footer', coalesce(branding_payload->>'receipt_footer', target_restaurant.profile->>'receipt_footer', ''),
      'social_links', coalesce(branding_payload->'social_links', target_restaurant.profile->'social_links', '{}'::jsonb)
    );

  normalized_branding :=
    coalesce(target_restaurant.branding, '{}'::jsonb)
    || jsonb_build_object(
      'logo_url', coalesce(branding_payload->>'logo_url', target_restaurant.branding->>'logo_url', ''),
      'cover_url', coalesce(branding_payload->>'cover_url', target_restaurant.branding->>'cover_url', '')
    );

  normalized_business_hours := jsonb_build_object(
    'version', 1,
    'opens_at', coalesce(nullif(business_hours_payload->>'opens_at', ''), '08:00'),
    'closes_at', coalesce(nullif(business_hours_payload->>'closes_at', ''), '22:00'),
    'closed_days', coalesce(business_hours_payload->'closed_days', '[]'::jsonb),
    'schedules', jsonb_build_array(jsonb_build_object(
      'name', 'Default',
      'opens_at', coalesce(nullif(business_hours_payload->>'opens_at', ''), '08:00'),
      'closes_at', coalesce(nullif(business_hours_payload->>'closes_at', ''), '22:00'),
      'closed_days', coalesce(business_hours_payload->'closed_days', '[]'::jsonb)
    ))
  );

  normalized_kitchen_settings := jsonb_build_object(
    'mode', coalesce(nullif(kitchen_payload->>'mode', ''), 'single'),
    'skipped', coalesce((kitchen_payload->>'skipped')::boolean, false)
  );

  normalized_setup_status := jsonb_build_object(
    'completed', true,
    'completed_at', coalesce(target_restaurant.setup_status->'completed_at', to_jsonb(now())),
    'completed_by', coalesce(target_restaurant.setup_status->'completed_by', to_jsonb(auth.uid())),
    'version', 1,
    'qr_generated', true,
    'staff_invitations', coalesce(staff_invitations_payload, '[]'::jsonb),
    'staff_invited_count', jsonb_array_length(coalesce(staff_invitations_payload, '[]'::jsonb)),
    'menu_status', case
      when coalesce(array_length(starter_template_keys, 1), 0) > 0 then 'starter_imported'
      else 'not_started'
    end
  );

  update public.restaurants
  set
    name = restaurant_name,
    total_tables = requested_table_count,
    table_count = requested_table_count,
    profile = normalized_profile,
    branding = normalized_branding,
    business_hours = normalized_business_hours,
    kitchen_settings = normalized_kitchen_settings,
    setup_status = normalized_setup_status
  where id = target_restaurant_id
  returning * into updated_restaurant;

  perform public.sync_restaurant_tables(target_restaurant_id, requested_table_count);

  starter_template_result := public.import_restaurant_starter_templates(target_restaurant_id, starter_template_keys);

  select *
  into updated_restaurant
  from public.restaurants
  where id = target_restaurant_id;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', updated_restaurant.id,
      'name', updated_restaurant.name,
      'total_tables', updated_restaurant.total_tables,
      'table_count', updated_restaurant.table_count,
      'profile', updated_restaurant.profile,
      'branding', updated_restaurant.branding,
      'business_hours', updated_restaurant.business_hours,
      'kitchen_settings', updated_restaurant.kitchen_settings,
      'setup_status', updated_restaurant.setup_status
    ),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', rt.id,
        'table_number', rt.table_number,
        'label', rt.label,
        'qr_path', rt.qr_path,
        'qr_url', rt.qr_url,
        'active', rt.active
      ) order by rt.table_number), '[]'::jsonb)
      from public.restaurant_tables rt
      where rt.restaurant_id = target_restaurant_id
        and rt.active = true
    ),
    'starter_templates', starter_template_result
  );
end;
$$;

revoke all on function public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text[]) to authenticated;

create or replace function public.complete_restaurant_setup(
  target_restaurant_id uuid,
  restaurant_info_payload jsonb,
  branding_payload jsonb,
  table_payload jsonb,
  business_hours_payload jsonb,
  kitchen_payload jsonb,
  staff_invitations_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.complete_restaurant_setup(
    target_restaurant_id,
    restaurant_info_payload,
    branding_payload,
    table_payload,
    business_hours_payload,
    kitchen_payload,
    staff_invitations_payload,
    '{}'::text[]
  );
end;
$$;

revoke all on function public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
