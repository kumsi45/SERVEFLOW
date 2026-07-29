-- ServeFlow Phase 9.12: global, reusable Smart Menu Library.
-- Library records are platform-owned and are copied only into private Review
-- Studio drafts. Production menu and publishing architecture are unchanged.

create table if not exists public.serveflow_smart_menu_libraries (
  id uuid primary key default gen_random_uuid(),
  restaurant_type text not null unique,
  name text not null,
  description text not null default '',
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (restaurant_type in ('Restaurant', 'Hotel', 'Cafe', 'Fast Food', 'Bar & Lounge', 'Bakery')),
  check (length(btrim(name)) between 1 and 120)
);

create table if not exists public.serveflow_smart_menu_categories (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.serveflow_smart_menu_libraries(id) on delete cascade,
  name text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (library_id, name),
  check (length(btrim(name)) between 1 and 120)
);

create table if not exists public.serveflow_smart_menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.serveflow_smart_menu_categories(id) on delete cascade,
  name text not null,
  default_description text not null,
  default_image_reference text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, name),
  check (length(btrim(name)) between 1 and 160),
  check (length(btrim(default_description)) between 1 and 240),
  check (length(btrim(default_image_reference)) between 1 and 500)
);

create trigger serveflow_smart_menu_libraries_set_updated_at
before update on public.serveflow_smart_menu_libraries
for each row execute function public.set_updated_at();

create trigger serveflow_smart_menu_items_set_updated_at
before update on public.serveflow_smart_menu_items
for each row execute function public.set_updated_at();

alter table public.serveflow_smart_menu_libraries enable row level security;
alter table public.serveflow_smart_menu_categories enable row level security;
alter table public.serveflow_smart_menu_items enable row level security;

revoke all on public.serveflow_smart_menu_libraries from public, anon;
revoke all on public.serveflow_smart_menu_categories from public, anon;
revoke all on public.serveflow_smart_menu_items from public, anon;
grant select on public.serveflow_smart_menu_libraries to authenticated;
grant select on public.serveflow_smart_menu_categories to authenticated;
grant select on public.serveflow_smart_menu_items to authenticated;

create policy serveflow_smart_menu_libraries_read
on public.serveflow_smart_menu_libraries for select to authenticated using (active);

create policy serveflow_smart_menu_categories_read
on public.serveflow_smart_menu_categories for select to authenticated using (
  exists (select 1 from public.serveflow_smart_menu_libraries library where library.id = library_id and library.active)
);

create policy serveflow_smart_menu_items_read
on public.serveflow_smart_menu_items for select to authenticated using (
  exists (
    select 1 from public.serveflow_smart_menu_categories category
    join public.serveflow_smart_menu_libraries library on library.id = category.library_id
    where category.id = category_id and library.active
  )
);

alter table public.ai_menu_import_drafts
  drop constraint if exists ai_menu_import_drafts_source_kind_check;
alter table public.ai_menu_import_drafts
  add constraint ai_menu_import_drafts_source_kind_check
  check (source_kind in ('upload', 'starter', 'manual', 'smart_library'));
alter table public.ai_menu_import_drafts
  drop constraint if exists ai_menu_import_drafts_source_identity_check;
alter table public.ai_menu_import_drafts
  add constraint ai_menu_import_drafts_source_identity_check
  check (
    (source_kind = 'upload' and source_draft_id is not null)
    or
    (source_kind in ('starter', 'manual', 'smart_library') and source_draft_id is null)
  );

do $$
declare
  library_record record;
  category_record record;
  library_json jsonb;
  category_json jsonb;
  item_json jsonb;
  category_order integer;
  item_order integer;
begin
  for library_json in select value from jsonb_array_elements($library$
  [
    {"type":"Restaurant","name":"ServeFlow Restaurant Menu","description":"A balanced all-day restaurant foundation.","order":10,"categories":[
      {"name":"Breakfast","items":[["Full Breakfast","Eggs, toast, breakfast potatoes and fresh seasonal accompaniments."],["Chechebsa","Traditional torn flatbread gently tossed with spiced butter and berbere."]]},
      {"name":"Ethiopian Traditional Dishes","items":[["Doro Wot","Slow-cooked chicken stew with berbere, spiced butter and a boiled egg."],["Vegetarian Beyaynet","A colorful selection of traditional vegetable and pulse dishes served together."]]},
      {"name":"Chicken","items":[["Grilled Chicken","Tender grilled chicken served with seasonal vegetables."],["Crispy Chicken","Golden crisp chicken with a light house dipping sauce."]]},
      {"name":"Fish & Seafood","items":[["Grilled Fish Fillet","Seasoned fish fillet grilled until tender and finished with fresh lemon."],["Fish Curry","Fresh fish simmered in a gently spiced aromatic sauce."]]},
      {"name":"Salads","items":[["Garden Salad","Crisp lettuce, tomato, cucumber and onion with a light house dressing."],["Chicken Caesar Salad","Grilled chicken, crisp lettuce, parmesan and toasted croutons."]]},
      {"name":"Soups","items":[["Tomato Soup","Smooth tomato soup finished with herbs and a touch of cream."],["Chicken Soup","Comforting chicken broth with vegetables and herbs."]]},
      {"name":"Pasta","items":[["Spaghetti Bolognese","Spaghetti served with a rich slow-cooked beef and tomato sauce."],["Penne Arrabbiata","Penne in a lively tomato, garlic and chilli sauce."]]},
      {"name":"Rice Dishes","items":[["Chicken Fried Rice","Wok-tossed rice with chicken, vegetables and aromatic seasoning."],["Vegetable Rice","Fragrant rice prepared with a colorful selection of vegetables."]]},
      {"name":"Desserts","items":[["Chocolate Cake","Moist chocolate cake with a smooth chocolate finish."],["Seasonal Fruit Plate","A refreshing selection of freshly cut seasonal fruit."]]},
      {"name":"Fresh Juice","items":[["Mango Juice","Fresh ripe mango blended until smooth and refreshing."],["Avocado Juice","Creamy avocado blended fresh to order."]]},
      {"name":"Coffee","items":[["Ethiopian Coffee","Traditionally prepared Ethiopian coffee with a rich aroma."],["Cappuccino","Espresso balanced with steamed milk and a soft layer of foam."]]},
      {"name":"Soft Drinks","items":[["Coca-Cola","Chilled classic Coca-Cola."],["Sparkling Water","Refreshing chilled sparkling water."]]}
    ]},
    {"type":"Hotel","name":"ServeFlow Hotel Menu","description":"All-day hotel dining for local and international guests.","order":20,"categories":[
      {"name":"Breakfast","items":[["Continental Breakfast","Pastries, toast, fresh fruit, juice and a hot beverage."],["Hotel Breakfast","Eggs prepared to order with potatoes, toast and seasonal accompaniments."]]},
      {"name":"Ethiopian Traditional Dishes","items":[["Special Tibs","Tender sautéed beef with onion, pepper and traditional seasoning."],["Shiro","Smooth chickpea stew prepared with aromatic spices."]]},
      {"name":"Soups","items":[["Soup of the Day","The chef's freshly prepared seasonal soup."],["Mushroom Soup","Creamy mushroom soup finished with herbs."]]},
      {"name":"Salads","items":[["Hotel Garden Salad","Fresh seasonal vegetables with the hotel house dressing."],["Greek Salad","Tomato, cucumber, olives and feta with oregano dressing."]]},
      {"name":"Chicken","items":[["Herb Grilled Chicken","Herb-marinated chicken grilled and served with seasonal sides."],["Chicken Curry","Tender chicken simmered in an aromatic curry sauce."]]},
      {"name":"Fish & Seafood","items":[["Pan-Seared Fish","Fresh fish seared and finished with lemon herb butter."],["Seafood Pasta","Pasta tossed with mixed seafood in a light tomato sauce."]]},
      {"name":"Pasta","items":[["Penne Alfredo","Penne coated in a creamy parmesan sauce."],["Spaghetti Pomodoro","Spaghetti with tomato, basil and extra virgin olive oil."]]},
      {"name":"Pizza","items":[["Margherita Pizza","Tomato, mozzarella and basil on a freshly baked crust."],["Chicken Pizza","Seasoned chicken, mozzarella, peppers and tomato sauce."]]},
      {"name":"Desserts","items":[["Cheesecake","Creamy cheesecake served with a seasonal fruit garnish."],["Chocolate Mousse","Light chocolate mousse with a rich cocoa finish."]]},
      {"name":"Fresh Juice","items":[["Orange Juice","Fresh oranges pressed to order."],["Mixed Fruit Juice","A refreshing blend of seasonal fruits."]]},
      {"name":"Coffee","items":[["Americano","Espresso lengthened with hot water for a smooth finish."],["Cafe Latte","Espresso with silky steamed milk."]]},
      {"name":"Tea & Hot Drinks","items":[["Ethiopian Tea","Fragrant black tea served hot."],["Hot Chocolate","Warm chocolate drink finished with steamed milk."]]},
      {"name":"Soft Drinks","items":[["Assorted Soft Drink","Your choice of chilled bottled soft drink."],["Still Water","Chilled bottled still water."]]}
    ]},
    {"type":"Cafe","name":"ServeFlow Cafe Menu","description":"Coffee, breakfast, bakery and refreshing drinks.","order":30,"categories":[
      {"name":"Breakfast","items":[["Avocado Toast","Toasted bread topped with seasoned avocado and fresh tomato."],["French Toast","Golden French toast served with fruit and a light syrup."]]},
      {"name":"Sandwiches","items":[["Chicken Club Sandwich","Layered chicken, lettuce and tomato on toasted bread."],["Grilled Vegetable Sandwich","Grilled seasonal vegetables with a light herb spread."]]},
      {"name":"Desserts","items":[["Chocolate Brownie","Rich chocolate brownie with a soft center."],["Carrot Cake","Moist spiced carrot cake with a smooth cream finish."]]},
      {"name":"Fresh Juice","items":[["Orange Juice","Fresh oranges pressed to order."],["Pineapple Juice","Fresh pineapple blended and served chilled."]]},
      {"name":"Smoothies & Milkshakes","items":[["Berry Smoothie","Mixed berries blended with yogurt until smooth."],["Chocolate Milkshake","Creamy chocolate milkshake blended to order."]]},
      {"name":"Coffee","items":[["Espresso","A concentrated shot with a rich aroma and crema."],["Cappuccino","Espresso, steamed milk and velvety foam."],["Macchiato","Espresso marked with a small amount of milk foam."]]},
      {"name":"Tea & Hot Drinks","items":[["Spiced Tea","Black tea infused with warming aromatic spices."],["Hot Chocolate","Rich chocolate blended with steamed milk."]]},
      {"name":"Soft Drinks","items":[["Iced Tea","Freshly brewed tea served chilled over ice."],["Lemon Soda","Sparkling lemon drink served chilled."]]}
    ]},
    {"type":"Fast Food","name":"ServeFlow Fast Food Menu","description":"Popular quick-service favorites ready for customization.","order":40,"categories":[
      {"name":"Burgers","items":[["Classic Beef Burger","Grilled beef patty with lettuce, tomato and house sauce."],["Crispy Chicken Burger","Crispy chicken with lettuce and creamy house sauce."],["Vegetable Burger","Seasoned vegetable patty with fresh salad and house sauce."]]},
      {"name":"Chicken","items":[["Fried Chicken","Crispy seasoned chicken cooked until golden."],["Chicken Wings","Crisp chicken wings tossed in your choice of sauce."]]},
      {"name":"Wraps","items":[["Chicken Wrap","Seasoned chicken, fresh salad and sauce in a soft wrap."],["Falafel Wrap","Crisp falafel, vegetables and tahini-style sauce."]]},
      {"name":"Pizza","items":[["Margherita Pizza","Tomato, mozzarella and basil on a crisp crust."],["Pepperoni Pizza","Mozzarella, tomato sauce and sliced pepperoni."]]},
      {"name":"Sandwiches","items":[["Steak Sandwich","Sliced seasoned beef with peppers and onions."],["Chicken Sandwich","Tender chicken with lettuce, tomato and house sauce."]]},
      {"name":"Snacks & Fast Food","items":[["French Fries","Crisp golden fries lightly seasoned."],["Chicken Nuggets","Bite-sized crispy chicken pieces with dipping sauce."]]},
      {"name":"Soft Drinks","items":[["Coca-Cola","Chilled classic Coca-Cola."],["Bottled Water","Chilled bottled water."]]}
    ]},
    {"type":"Bar & Lounge","name":"ServeFlow Bar & Lounge Menu","description":"Shareable food and a focused lounge beverage selection.","order":50,"categories":[
      {"name":"Snacks & Fast Food","items":[["Loaded Fries","Crisp fries topped with cheese, peppers and house sauce."],["Spiced Peanuts","Roasted peanuts tossed with a savory spice blend."]]},
      {"name":"Burgers","items":[["Lounge Beef Burger","Grilled beef patty with cheese, salad and lounge sauce."],["Chicken Burger","Seasoned chicken with lettuce and creamy sauce."]]},
      {"name":"Chicken","items":[["Buffalo Wings","Crisp chicken wings tossed in a lively buffalo sauce."],["Grilled Chicken Bites","Tender grilled chicken pieces with a house dip."]]},
      {"name":"Salads","items":[["Lounge Salad","Crisp vegetables, herbs and a light citrus dressing."],["Chicken Salad","Grilled chicken over fresh mixed salad."]]},
      {"name":"Fresh Juice","items":[["Fresh Lime Juice","Fresh lime blended into a bright chilled drink."],["Pineapple Juice","Fresh pineapple juice served chilled."]]},
      {"name":"Soft Drinks","items":[["Tonic Water","Chilled tonic water served over ice."],["Ginger Ale","Chilled sparkling ginger ale."]]},
      {"name":"Alcoholic Drinks","items":[["House Beer","A chilled bottle of the house-selected beer."],["House Wine","A glass of the selected house red or white wine."],["Classic Gin & Tonic","Gin served with tonic water and fresh citrus."]]}
    ]},
    {"type":"Bakery","name":"ServeFlow Bakery Menu","description":"Fresh bakery favorites, sandwiches and hot drinks.","order":60,"categories":[
      {"name":"Breakfast","items":[["Croissant Breakfast","Fresh croissant served with eggs and a hot beverage."],["Breakfast Roll","Fresh roll filled with egg, cheese and tomato."]]},
      {"name":"Bakery","items":[["Butter Croissant","Flaky all-butter croissant baked until golden."],["Cinnamon Roll","Soft rolled pastry with cinnamon and a light glaze."],["Fresh Bread Loaf","Freshly baked artisan-style bread loaf."]]},
      {"name":"Sandwiches","items":[["Chicken Baguette","Fresh baguette filled with seasoned chicken and salad."],["Cheese & Tomato Sandwich","Cheese, tomato and herbs on fresh bakery bread."]]},
      {"name":"Desserts","items":[["Chocolate Cake Slice","Moist chocolate cake with a rich finish."],["Fruit Tart","Crisp pastry filled with cream and seasonal fruit."]]},
      {"name":"Coffee","items":[["Cafe Latte","Espresso with smooth steamed milk."],["Americano","Espresso with hot water for a clean, balanced cup."]]},
      {"name":"Tea & Hot Drinks","items":[["English Breakfast Tea","Classic black tea served hot."],["Hot Chocolate","Rich chocolate drink made with steamed milk."]]}
    ]}
  ]
  $library$::jsonb)
  loop
    insert into public.serveflow_smart_menu_libraries (
      restaurant_type, name, description, display_order, active
    ) values (
      library_json->>'type', library_json->>'name', library_json->>'description',
      (library_json->>'order')::integer, true
    )
    on conflict (restaurant_type) do update set
      name = excluded.name,
      description = excluded.description,
      display_order = excluded.display_order,
      active = true
    returning * into library_record;

    delete from public.serveflow_smart_menu_categories where library_id = library_record.id;

    category_order := 0;
    for category_json in select value from jsonb_array_elements(library_json->'categories')
    loop
      category_order := category_order + 1;
      insert into public.serveflow_smart_menu_categories (library_id, name, display_order)
      values (library_record.id, category_json->>'name', category_order)
      returning * into category_record;

      item_order := 0;
      for item_json in select value from jsonb_array_elements(category_json->'items')
      loop
        item_order := item_order + 1;
        insert into public.serveflow_smart_menu_items (
          category_id, name, default_description, default_image_reference, display_order
        ) values (
          category_record.id,
          item_json->>0,
          item_json->>1,
          'serveflow://smart-menu/' || lower(replace(library_json->>'type', ' ', '-')) || '/' ||
            lower(replace(category_json->>'name', ' ', '-')) || '/' || lower(replace(item_json->>0, ' ', '-')),
          item_order
        );
      end loop;
    end loop;
  end loop;
end;
$$;

comment on table public.serveflow_smart_menu_libraries is
  'ServeFlow-owned global Smart Menu Library. Never restaurant-specific.';
comment on table public.serveflow_smart_menu_items is
  'Curated menu names, descriptions and image references only. Prices and operational metadata are intentionally absent.';
