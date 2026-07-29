begin;

create table public.serveflow_master_menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.serveflow_master_menu_categories(id) on delete restrict,
  name text not null,
  default_description text not null,
  default_image_reference text not null,
  display_order integer not null,
  keywords text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(name)) between 1 and 160),
  check (length(btrim(default_description)) between 1 and 240),
  check (length(btrim(default_image_reference)) between 1 and 500),
  check (display_order > 0),
  unique (category_id, display_order)
);

create unique index serveflow_master_menu_items_name_unique_idx
  on public.serveflow_master_menu_items(lower(btrim(name)));
create index serveflow_master_menu_items_category_idx
  on public.serveflow_master_menu_items(category_id, display_order);

create table public.serveflow_smart_menu_library_items (
  library_id uuid not null references public.serveflow_smart_menu_libraries(id) on delete cascade,
  item_id uuid not null references public.serveflow_master_menu_items(id) on delete restrict,
  display_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (library_id, item_id),
  unique (library_id, display_order),
  check (display_order > 0)
);

create index serveflow_smart_menu_library_items_item_idx
  on public.serveflow_smart_menu_library_items(item_id);

create trigger serveflow_master_menu_items_set_updated_at
before update on public.serveflow_master_menu_items
for each row execute function public.set_updated_at();

alter table public.serveflow_master_menu_items enable row level security;
alter table public.serveflow_smart_menu_library_items enable row level security;
revoke all on public.serveflow_master_menu_items from public, anon;
revoke all on public.serveflow_smart_menu_library_items from public, anon;
grant select on public.serveflow_master_menu_items to authenticated;
grant select on public.serveflow_smart_menu_library_items to authenticated;

create policy serveflow_master_menu_items_read
on public.serveflow_master_menu_items for select to authenticated using (active);
create policy serveflow_smart_menu_library_items_read
on public.serveflow_smart_menu_library_items for select to authenticated using (
  active and exists (
    select 1 from public.serveflow_smart_menu_libraries library
    where library.id = library_id and library.active
  )
);

do $$
declare
  specification jsonb := $library$
  [
    {"type":"Restaurant","sections":[
      {"name":"Breakfast","items":["Chechebsa","Firfir","Ful","Fetira","Omelette","Scrambled Eggs","Kinche","Dulet"]},
      {"name":"Traditional Ethiopian Dishes","items":["Kitfo","Tibs","Shekla Tibs","Doro Wot","Key Wot","Gored Gored","Shiro","Misir Wot","Beyaynetu","Tegabino"]},
      {"name":"Chicken","items":["Grilled Chicken","Fried Chicken","Chicken Cutlet","Chicken Breast","Chicken Wings"]},
      {"name":"Fish & Seafood","items":["Asa Tibs","Grilled Fish","Fried Fish","Fish Cutlet"]},
      {"name":"Pasta","items":["Spaghetti","Pasta Alfredo","Macaroni","Pasta with Chicken","Pasta with Beef"]},
      {"name":"Pizza","items":["Margherita Pizza","Beef Pizza","Chicken Pizza","Vegetable Pizza","Tuna Pizza"]},
      {"name":"Burgers","items":["Beef Burger","Chicken Burger","Cheese Burger","Double Burger"]},
      {"name":"Sandwiches","items":["Club Sandwich","Chicken Sandwich","Tuna Sandwich","Beef Sandwich","Vegetable Sandwich"]},
      {"name":"Rice Dishes","items":["Chicken Rice","Beef Rice","Vegetable Rice","Fried Rice"]},
      {"name":"Salads","items":["Green Salad","Mixed Salad","Tuna Salad","Chicken Salad"]},
      {"name":"Soups","items":["Tomato Soup","Chicken Soup","Vegetable Soup","Fish Soup"]},
      {"name":"Snacks & Fast Food","items":["French Fries","Nuggets","Hot Dog","Chicken Wings"]},
      {"name":"Desserts","items":["Ice Cream","Cake","Fruit Salad"]},
      {"name":"Drinks","items":["Coffee","Tea","Fresh Juice","Soft Drinks","Milkshake"]}
    ]},
    {"type":"Hotel","sections":[
      {"name":"Breakfast","items":["Continental Breakfast","Ethiopian Breakfast","Omelette","Pancake","Toast","Cereals","Fresh Fruits"]},
      {"name":"Main Course","items":["Steak","Chicken","Fish","Pasta","Pizza","Rice","Tibs","Kitfo"]},
      {"name":"Salads","items":["Caesar Salad","Greek Salad","Garden Salad"]},
      {"name":"Soups","items":["Chicken Soup","Mushroom Soup","Vegetable Soup"]},
      {"name":"Desserts","items":["Cake","Ice Cream","Fruit Salad"]},
      {"name":"Hot Drinks","items":["Coffee","Espresso","Cappuccino","Tea"]},
      {"name":"Cold Drinks","items":["Juice","Water","Soft Drinks","Energy Drink"]},
      {"name":"Bar","items":["Beer","Wine","Whisky","Vodka","Gin","Cocktails"]}
    ]},
    {"type":"Cafe","sections":[
      {"name":"Coffee","items":["Espresso","Macchiato","Latte","Cappuccino","Americano","Mocha"]},
      {"name":"Tea","items":["Black Tea","Green Tea","Milk Tea"]},
      {"name":"Fresh Juice","items":["Mango Juice","Avocado Juice","Orange Juice","Pineapple Juice","Mixed Juice"]},
      {"name":"Milkshakes","items":["Chocolate Milkshake","Strawberry Milkshake","Vanilla Milkshake","Banana Milkshake","Mango Milkshake"]},
      {"name":"Sandwiches","items":["Chicken Sandwich","Tuna Sandwich","Club Sandwich","Vegetable Sandwich"]},
      {"name":"Bakery","items":["Croissant","Muffin","Donut","Cake","Cookies","Brownie"]},
      {"name":"Snacks","items":["Pizza Slice","French Fries","Nuggets"]}
    ]},
    {"type":"Fast Food","sections":[
      {"name":"Burgers","items":["Beef Burger","Chicken Burger","Cheese Burger","Double Burger"]},
      {"name":"Fries","items":["French Fries","Loaded Fries","Potato Wedges"]},
      {"name":"Hot Dogs","items":["Classic Hot Dog","Cheese Hot Dog"]},
      {"name":"Fried Chicken","items":["Chicken Wings","Drumsticks","Chicken Pieces"]},
      {"name":"Pizza","items":["Mini Pizza","Pepperoni Pizza","Chicken Pizza"]},
      {"name":"Wraps","items":["Chicken Wrap","Beef Wrap","Vegetable Wrap"]},
      {"name":"Drinks","items":["Coca-Cola","Pepsi","Sprite","Fanta","Juice"]},
      {"name":"Desserts","items":["Ice Cream","Sundae"]}
    ]},
    {"type":"Bar & Lounge","sections":[
      {"name":"Beer","items":["Draft Beer","Bottled Beer","Local Beer"]},
      {"name":"Wine","items":["Red Wine","White Wine","Sparkling Wine"]},
      {"name":"Whisky","items":["Johnnie Walker","Jameson","Jack Daniel's"]},
      {"name":"Cocktails","items":["Mojito","Margarita","Cosmopolitan","Martini","Long Island Iced Tea"]},
      {"name":"Mocktails","items":["Virgin Mojito","Fruit Punch","Lemon Mint"]},
      {"name":"Soft Drinks","items":["Coca-Cola","Sprite","Soda Water","Energy Drink"]},
      {"name":"Bar Snacks","items":["Chicken Wings","French Fries","Pizza","Nachos","Popcorn","Peanuts"]}
    ]},
    {"type":"Bakery","sections":[
      {"name":"Bread","items":["White Bread","Brown Bread","French Bread","Milk Bread"]},
      {"name":"Pastries","items":["Croissant","Danish Pastry","Puff Pastry"]},
      {"name":"Cakes","items":["Chocolate Cake","Black Forest Cake","White Forest Cake","Red Velvet Cake","Birthday Cake"]},
      {"name":"Donuts","items":["Glazed Donut","Chocolate Donut","Filled Donut"]},
      {"name":"Cupcakes","items":["Vanilla Cupcake","Chocolate Cupcake","Strawberry Cupcake"]},
      {"name":"Cookies","items":["Chocolate Chip Cookie","Butter Cookie","Oat Cookie"]},
      {"name":"Pies","items":["Apple Pie","Chicken Pie","Meat Pie"]},
      {"name":"Drinks","items":["Coffee","Tea","Milk","Juice"]}
    ]}
  ]
  $library$::jsonb;
  template_json jsonb;
  section_json jsonb;
  item_value text;
  canonical_category text;
  category_record record;
  library_record record;
  item_id_value uuid;
  item_order integer;
  category_order integer;
  master_order integer;
  description_value text;
  keyword_values text[];
begin
  delete from public.serveflow_smart_menu_library_items;
  delete from public.serveflow_master_menu_items;
  delete from public.serveflow_smart_menu_library_categories;

  for template_json in select value from jsonb_array_elements(specification)
  loop
    select * into strict library_record
    from public.serveflow_smart_menu_libraries
    where restaurant_type = template_json->>'type';
    item_order := 0;
    category_order := 0;

    for section_json in select value from jsonb_array_elements(template_json->'sections')
    loop
      for item_value in select value #>> '{}' from jsonb_array_elements(section_json->'items')
      loop
        canonical_category := case
          when item_value in ('Chicken Wings','Drumsticks','Chicken Pieces','Chicken','Grilled Chicken','Fried Chicken','Chicken Cutlet','Chicken Breast') then 'Chicken'
          when item_value in ('Fish','Asa Tibs','Grilled Fish','Fried Fish','Fish Cutlet') then 'Fish & Seafood'
          when item_value in ('Tibs','Kitfo','Shekla Tibs','Doro Wot','Key Wot','Gored Gored','Shiro','Misir Wot','Beyaynetu','Tegabino') then 'Ethiopian Traditional Dishes'
          when item_value in ('Pasta','Spaghetti','Pasta Alfredo','Macaroni','Pasta with Chicken','Pasta with Beef') then 'Pasta'
          when item_value = 'Rice' or section_json->>'name' = 'Rice Dishes' then 'Rice Dishes'
          when item_value = 'Pizza' or section_json->>'name' = 'Pizza' then 'Pizza'
          when section_json->>'name' in ('Burgers') then 'Burgers'
          when section_json->>'name' in ('Sandwiches') then 'Sandwiches'
          when section_json->>'name' in ('Salads') then 'Salads'
          when section_json->>'name' in ('Soups') then 'Soups'
          when section_json->>'name' in ('Wraps') then 'Wraps'
          when section_json->>'name' in ('Desserts','Cakes','Donuts','Cupcakes','Cookies','Pies') or item_value in ('Cake','Ice Cream','Fruit Salad','Sundae','Brownie') then 'Desserts'
          when section_json->>'name' in ('Bakery','Bread','Pastries') then 'Bakery'
          when section_json->>'name' = 'Coffee' or item_value in ('Coffee','Espresso','Macchiato','Latte','Cappuccino','Americano','Mocha') then 'Coffee'
          when section_json->>'name' in ('Tea','Hot Drinks') or item_value = 'Tea' then 'Tea & Hot Drinks'
          when section_json->>'name' in ('Fresh Juice','Mocktails') or item_value in ('Fresh Juice','Juice') then 'Fresh Juice'
          when section_json->>'name' = 'Milkshakes' or item_value in ('Milkshake','Milk') then 'Smoothies & Milkshakes'
          when section_json->>'name' in ('Beer','Wine','Whisky','Cocktails','Bar') then 'Alcoholic Drinks'
          when section_json->>'name' in ('Drinks','Cold Drinks','Soft Drinks') then 'Soft Drinks'
          when section_json->>'name' in ('Breakfast') then 'Breakfast'
          when section_json->>'name' in ('Traditional Ethiopian Dishes') then 'Ethiopian Traditional Dishes'
          else 'Snacks & Fast Food'
        end;

        select * into strict category_record
        from public.serveflow_master_menu_categories
        where name = canonical_category;

        if not exists (
          select 1 from public.serveflow_smart_menu_library_categories
          where library_id = library_record.id and category_id = category_record.id
        ) then
          category_order := category_order + 1;
          insert into public.serveflow_smart_menu_library_categories
            (library_id, category_id, display_order, active)
          values (library_record.id, category_record.id, category_order, true);
        end if;

        select id into item_id_value
        from public.serveflow_master_menu_items
        where lower(btrim(name)) = lower(btrim(item_value));

        if item_id_value is null then
          select coalesce(max(display_order), 0) + 1 into master_order
          from public.serveflow_master_menu_items
          where category_id = category_record.id;

          description_value := case
            when canonical_category = 'Coffee' then 'Freshly prepared ' || item_value || ' with a smooth, aromatic finish.'
            when canonical_category = 'Tea & Hot Drinks' then 'A warming serving of ' || item_value || ', prepared fresh and served with care.'
            when canonical_category in ('Fresh Juice','Smoothies & Milkshakes','Soft Drinks') then 'A refreshing ' || item_value || ' served chilled for a bright, satisfying finish.'
            when canonical_category = 'Alcoholic Drinks' then item_value || ' served with care for a polished bar and lounge experience.'
            when canonical_category in ('Bakery','Desserts') then item_value || ' presented fresh as a satisfying sweet or savory treat.'
            else item_value || ' carefully prepared and served fresh for a satisfying dining experience.'
          end;
          keyword_values := array(
            select distinct keyword
            from unnest(regexp_split_to_array(lower(item_value || ' ' || canonical_category), '[^a-z0-9]+')) keyword
            where keyword <> ''
          );

          insert into public.serveflow_master_menu_items (
            category_id, name, default_description, default_image_reference,
            display_order, keywords, active
          ) values (
            category_record.id,
            item_value,
            description_value,
            'serveflow://smart-menu/v1/' || category_record.slug || '/' ||
              regexp_replace(lower(item_value), '[^a-z0-9]+', '-', 'g'),
            master_order,
            keyword_values,
            true
          ) returning id into item_id_value;
        end if;

        if not exists (
          select 1 from public.serveflow_smart_menu_library_items
          where library_id = library_record.id and item_id = item_id_value
        ) then
          item_order := item_order + 1;
          insert into public.serveflow_smart_menu_library_items
            (library_id, item_id, display_order, active)
          values (library_record.id, item_id_value, item_order, true);
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

comment on table public.serveflow_master_menu_items is
  'ServeFlow Smart Menu Library v1 canonical items. Contains no prices or operational fields.';
comment on table public.serveflow_smart_menu_library_items is
  'Reusable restaurant-type mappings to canonical ServeFlow Smart Menu items.';

commit;
