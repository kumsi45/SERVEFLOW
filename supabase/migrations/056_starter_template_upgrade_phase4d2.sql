-- SERVEFLOW Phase 4D.2 Starter Template Upgrade.
-- Enriches system starter-template menu items only. No ordering, payment, AI,
-- cashier, kitchen, receipt, report, analytics, or restaurant workflow changes.

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

do $$
declare
  target_template_id uuid;
  target_category_id uuid;
  ethiopian_payload jsonb := $json$
[
  {"category":"Fish","description":"Ethiopian-style fish dishes for lunch and dinner service.","order":50,"items":[
    {"name":"Asa Tibs","description":"Pan-seared fish pieces tossed with onion, pepper, rosemary, and a mild awaze finish.","prep":22,"station":"main","order":10},
    {"name":"Grilled Nile Perch","description":"Char-grilled fish fillet served with lemon, herbs, and a light tomato salad.","prep":24,"station":"main","order":20}
  ]},
  {"category":"Fresh Juice","description":"Fresh blended juices for traditional restaurants.","order":60,"items":[
    {"name":"Mango Juice","description":"Fresh mango blended smooth and served chilled with a clean fruit finish.","prep":7,"station":"beverage","order":10},
    {"name":"Avocado Juice","description":"Creamy avocado juice blended to order with a gentle citrus note.","prep":8,"station":"beverage","order":20}
  ]},
  {"category":"Tea","description":"Hot Ethiopian tea service and spiced infusions.","order":70,"items":[
    {"name":"Spiced Tea","description":"Fresh black tea brewed with cinnamon, clove, and warming house spices.","prep":7,"station":"beverage","order":10},
    {"name":"Black Tea","description":"Classic hot black tea served clear and fragrant.","prep":5,"station":"beverage","order":20}
  ]},
  {"category":"Coffee","description":"Ethiopian coffee and espresso-based drinks.","order":80,"items":[
    {"name":"Ethiopian Coffee","description":"Traditional brewed Ethiopian coffee served aromatic and bold.","prep":10,"station":"beverage","order":10},
    {"name":"Macchiato","description":"Espresso topped with steamed milk foam for a smooth cafe finish.","prep":5,"station":"beverage","order":20}
  ]}
]
$json$::jsonb;
  category_payload jsonb;
  item_payload jsonb;
begin
  insert into public.restaurant_starter_templates (
    template_key,
    restaurant_type,
    name,
    description,
    display_order,
    active
  )
  values (
    'ethiopian_fish_juice_tea_coffee',
    'Ethiopian Restaurant',
    'Fish, Juice, Tea & Coffee',
    'Essential Ethiopian fish and beverage starters for digital menus.',
    30,
    true
  )
  on conflict (template_key) do update
  set restaurant_type = excluded.restaurant_type,
      name = excluded.name,
      description = excluded.description,
      display_order = excluded.display_order,
      active = true
  returning id into target_template_id;

  delete from public.restaurant_starter_template_categories
  where template_id = target_template_id;

  for category_payload in select value from jsonb_array_elements(ethiopian_payload) loop
    insert into public.restaurant_starter_template_categories (
      template_id,
      name,
      description,
      display_order
    )
    values (
      target_template_id,
      category_payload->>'category',
      category_payload->>'description',
      (category_payload->>'order')::integer
    )
    returning id into target_category_id;

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
        target_template_id,
        target_category_id,
        item_payload->>'name',
        item_payload->>'description',
        (item_payload->>'prep')::integer,
        item_payload->>'station',
        true,
        0,
        null,
        (item_payload->>'order')::integer
      );
    end loop;
  end loop;
end;
$$;

do $$
declare
  target_template_id uuid;
  target_category_id uuid;
begin
  select templates.id
  into target_template_id
  from public.restaurant_starter_templates templates
  where templates.template_key = 'ethiopian_traditional_foods';

  if target_template_id is not null then
    select categories.id
    into target_category_id
    from public.restaurant_starter_template_categories categories
    where categories.template_id = target_template_id
      and lower(btrim(categories.name)) = lower('Beyaynet')
    limit 1;

    if target_category_id is not null and not exists (
      select 1
      from public.restaurant_starter_template_items items
      where items.template_category_id = target_category_id
        and lower(btrim(items.name)) = lower('Beyaynetu')
    ) then
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
        target_template_id,
        target_category_id,
        'Beyaynetu',
        'Colorful vegetarian combination of lentils, greens, shiro, and seasonal sides served on injera.',
        18,
        'main',
        true,
        0,
        null,
        5
      );
    end if;
  end if;
end;
$$;

with metadata(item_name, ingredients, allergens, spice_level, dietary_tags) as (
  values
    ('Shiro', array['chickpea flour','berbere','onion','garlic','tomato','niter kibbeh','injera']::text[], array['gluten','dairy']::text[], 3, array['ethiopian','vegetarian','stew']::text[]),
    ('Firfir', array['injera','berbere sauce','onion','garlic','tomato','niter kibbeh']::text[], array['gluten','dairy']::text[], 3, array['ethiopian','breakfast','spiced']::text[]),
    ('Doro Wot', array['chicken','berbere','onion','garlic','ginger','niter kibbeh','egg','injera']::text[], array['egg','gluten','dairy']::text[], 4, array['ethiopian','signature','spicy']::text[]),
    ('Beef Tibs', array['beef','onion','green pepper','rosemary','garlic','awaze','injera']::text[], array['gluten']::text[], 2, array['ethiopian','grill','meat']::text[]),
    ('Awaze Tibs', array['beef','awaze','berbere','onion','garlic','green pepper','injera']::text[], array['gluten']::text[], 4, array['ethiopian','spicy','meat']::text[]),
    ('Special Kitfo', array['minced beef','mitmita','niter kibbeh','ayib','gomen']::text[], array['dairy']::text[], 4, array['ethiopian','signature','beef']::text[]),
    ('Gored Gored', array['cubed beef','awaze','mitmita','niter kibbeh']::text[], array['dairy']::text[], 4, array['ethiopian','beef','spicy']::text[]),
    ('Beyaynetu', array['injera','lentils','split peas','shiro','gomen','beets','cabbage']::text[], array['gluten']::text[], 2, array['ethiopian','vegetarian','combination']::text[]),
    ('Vegetarian Beyaynet', array['injera','lentils','split peas','shiro','gomen','beets','cabbage']::text[], array['gluten']::text[], 2, array['ethiopian','vegetarian','combination']::text[]),
    ('Meat Combination', array['injera','beef tibs','doro wot','shiro','gomen','lentils']::text[], array['gluten','egg','dairy']::text[], 3, array['ethiopian','combination','meat']::text[]),
    ('Chechebsa', array['flatbread','berbere','niter kibbeh','honey']::text[], array['gluten','dairy']::text[], 2, array['ethiopian','breakfast','vegetarian']::text[]),
    ('Ful', array['fava beans','tomato','onion','chili','olive oil','bread']::text[], array['gluten']::text[], 2, array['ethiopian','breakfast','vegetarian']::text[]),
    ('Kinche', array['cracked wheat','niter kibbeh','salt']::text[], array['gluten','dairy']::text[], 0, array['ethiopian','breakfast','vegetarian']::text[]),
    ('Asa Tibs', array['fish','onion','green pepper','rosemary','awaze','lemon']::text[], array['fish']::text[], 2, array['ethiopian','fish','grill']::text[]),
    ('Grilled Nile Perch', array['nile perch','lemon','garlic','herbs','tomato salad']::text[], array['fish']::text[], 1, array['ethiopian','fish','grill']::text[]),
    ('Espresso', array['espresso coffee']::text[], array['none declared']::text[], 0, array['coffee','beverage','vegetarian']::text[]),
    ('Macchiato', array['espresso coffee','steamed milk']::text[], array['milk']::text[], 0, array['coffee','beverage','vegetarian']::text[]),
    ('Latte', array['espresso coffee','steamed milk','milk foam']::text[], array['milk']::text[], 0, array['coffee','beverage','vegetarian']::text[]),
    ('Mocha', array['espresso coffee','steamed milk','cocoa','chocolate syrup']::text[], array['milk']::text[], 0, array['coffee','beverage','vegetarian']::text[]),
    ('Cappuccino', array['espresso coffee','steamed milk','milk foam']::text[], array['milk']::text[], 0, array['coffee','beverage','vegetarian']::text[]),
    ('Ethiopian Coffee', array['ethiopian coffee','water']::text[], array['none declared']::text[], 0, array['coffee','ethiopian','beverage','vegetarian']::text[]),
    ('Black Tea', array['black tea','water']::text[], array['none declared']::text[], 0, array['tea','beverage','vegetarian']::text[]),
    ('Spiced Tea', array['black tea','cinnamon','clove','ginger','water']::text[], array['none declared']::text[], 1, array['tea','spiced','beverage','vegetarian']::text[]),
    ('Mango Juice', array['mango','water','ice']::text[], array['none declared']::text[], 0, array['juice','beverage','vegan']::text[]),
    ('Avocado Juice', array['avocado','water','lime','ice']::text[], array['none declared']::text[], 0, array['juice','beverage','vegan']::text[]),
    ('Mixed Juice', array['mango','avocado','papaya','water','ice']::text[], array['none declared']::text[], 0, array['juice','beverage','vegan']::text[]),
    ('Banana Smoothie', array['banana','milk','ice']::text[], array['milk']::text[], 0, array['smoothie','beverage','vegetarian']::text[]),
    ('Berry Smoothie', array['mixed berries','milk','ice']::text[], array['milk']::text[], 0, array['smoothie','beverage','vegetarian']::text[]),
    ('Margherita Pizza', array['pizza dough','tomato sauce','mozzarella','basil','olive oil']::text[], array['gluten','milk']::text[], 0, array['pizza','vegetarian','italian']::text[]),
    ('Pepperoni Pizza', array['pizza dough','tomato sauce','mozzarella','pepperoni']::text[], array['gluten','milk']::text[], 1, array['pizza','italian','meat']::text[]),
    ('Vegetarian Pizza', array['pizza dough','tomato sauce','mozzarella','bell pepper','mushroom','onion','olive']::text[], array['gluten','milk']::text[], 0, array['pizza','vegetarian','italian']::text[]),
    ('Seafood Pizza', array['pizza dough','tomato sauce','mozzarella','shrimp','fish','herbs']::text[], array['gluten','milk','shellfish','fish']::text[], 1, array['pizza','seafood','italian']::text[]),
    ('Spaghetti Bolognese', array['spaghetti','beef ragu','tomato','onion','garlic','parmesan']::text[], array['gluten','milk']::text[], 0, array['pasta','italian','meat']::text[]),
    ('Penne Alfredo', array['penne pasta','cream','parmesan','butter','black pepper']::text[], array['gluten','milk']::text[], 0, array['pasta','italian','vegetarian']::text[]),
    ('Vegetable Pasta', array['pasta','tomato sauce','zucchini','bell pepper','mushroom','herbs']::text[], array['gluten']::text[], 0, array['pasta','vegetarian','italian']::text[]),
    ('Classic Burger', array['beef patty','burger bun','lettuce','tomato','onion','house sauce']::text[], array['gluten','egg']::text[], 0, array['burger','beef','fast-food']::text[]),
    ('Cheese Burger', array['beef patty','burger bun','cheddar','lettuce','tomato','house sauce']::text[], array['gluten','milk','egg']::text[], 0, array['burger','beef','fast-food']::text[]),
    ('Chicken Burger', array['chicken breast','burger bun','lettuce','tomato','garlic mayo']::text[], array['gluten','egg']::text[], 0, array['burger','chicken','fast-food']::text[]),
    ('BBQ Burger', array['beef patty','burger bun','barbecue sauce','caramelized onion','lettuce']::text[], array['gluten']::text[], 1, array['burger','beef','fast-food']::text[]),
    ('Fried Chicken', array['chicken','seasoned flour','buttermilk','spices']::text[], array['gluten','milk']::text[], 1, array['chicken','fast-food']::text[]),
    ('Chicken Wings', array['chicken wings','house sauce','garlic','spices']::text[], array['none declared']::text[], 2, array['chicken','fast-food','shareable']::text[]),
    ('Croissant', array['wheat flour','butter','yeast','milk']::text[], array['gluten','milk']::text[], 0, array['bakery','vegetarian','pastry']::text[]),
    ('Cinnamon Roll', array['wheat flour','cinnamon','sugar','butter','cream glaze']::text[], array['gluten','milk']::text[], 0, array['bakery','dessert','vegetarian']::text[]),
    ('Chocolate Muffin', array['wheat flour','cocoa','chocolate chips','egg','milk']::text[], array['gluten','egg','milk']::text[], 0, array['bakery','dessert','vegetarian']::text[]),
    ('Chocolate Cake', array['cocoa','wheat flour','egg','milk','sugar','butter']::text[], array['gluten','egg','milk']::text[], 0, array['dessert','cake','vegetarian']::text[]),
    ('Cheesecake', array['cream cheese','biscuit base','egg','sugar','vanilla']::text[], array['gluten','egg','milk']::text[], 0, array['dessert','cake','vegetarian']::text[]),
    ('Fruit Tart', array['pastry shell','custard','seasonal fruit']::text[], array['gluten','egg','milk']::text[], 0, array['dessert','fruit','vegetarian']::text[]),
    ('Omelette', array['egg','herbs','butter','seasonal filling']::text[], array['egg','milk']::text[], 0, array['breakfast','vegetarian']::text[]),
    ('Pancakes', array['wheat flour','egg','milk','butter','syrup']::text[], array['gluten','egg','milk']::text[], 0, array['breakfast','vegetarian']::text[]),
    ('Grilled Fish', array['fish fillet','lemon','garlic','butter','herbs']::text[], array['fish','milk']::text[], 0, array['fish','grill']::text[]),
    ('Fish and Chips', array['fish fillet','batter','potato fries','tartar sauce']::text[], array['fish','gluten','egg']::text[], 0, array['fish','fried']::text[]),
    ('Cola', array['carbonated soft drink']::text[], array['none declared']::text[], 0, array['soft-drink','beverage','vegan']::text[]),
    ('Orange Soda', array['orange soft drink']::text[], array['none declared']::text[], 0, array['soft-drink','beverage','vegan']::text[]),
    ('Sparkling Water', array['sparkling water']::text[], array['none declared']::text[], 0, array['water','beverage','vegan']::text[]),
    ('Still Water', array['still water']::text[], array['none declared']::text[], 0, array['water','beverage','vegan']::text[]),
    ('Soup of the Day', array['seasonal vegetables','stock','herbs','olive oil']::text[], array['none declared']::text[], 0, array['starter','soup']::text[]),
    ('Garden Salad', array['mixed greens','tomato','cucumber','carrot','house dressing']::text[], array['none declared']::text[], 0, array['starter','salad','vegetarian']::text[]),
    ('Pan Seared Fish', array['fish fillet','seasonal vegetables','lemon butter','herbs']::text[], array['fish','milk']::text[], 0, array['fish','fine-dining']::text[]),
    ('Seafood Plate', array['shrimp','fish','seafood selection','herb butter','seasonal vegetables']::text[], array['shellfish','fish','milk']::text[], 0, array['seafood','fine-dining']::text[]),
    ('Tiramisu', array['espresso','mascarpone','ladyfinger biscuit','cocoa']::text[], array['gluten','egg','milk']::text[], 0, array['dessert','coffee','vegetarian']::text[]),
    ('Creme Caramel', array['egg','milk','sugar','vanilla','caramel']::text[], array['egg','milk']::text[], 0, array['dessert','custard','vegetarian']::text[]),
    ('Toast Plate', array['toast','egg','butter','seasonal sides']::text[], array['gluten','egg','milk']::text[], 0, array['breakfast','cafe']::text[]),
    ('Fruit Bowl', array['seasonal fruit','lime']::text[], array['none declared']::text[], 0, array['snack','fruit','vegan']::text[]),
    ('Granola Cup', array['granola','yogurt','seasonal fruit','honey']::text[], array['gluten','milk']::text[], 0, array['snack','breakfast','vegetarian']::text[])
)
update public.restaurant_starter_template_items items
set ingredients = coalesce(
      (
        select metadata.ingredients
        from metadata
        where lower(metadata.item_name) = lower(items.name)
        limit 1
      ),
      case
        when lower(categories.name) like '%coffee%' then array['coffee','water']::text[]
        when lower(categories.name) like '%tea%' then array['tea','water']::text[]
        when lower(categories.name) like '%juice%' then array['seasonal fruit','water','ice']::text[]
        when lower(categories.name) like '%drink%' or lower(categories.name) like '%water%' then array['beverage']::text[]
        else array['chef-selected ingredients','house seasoning']::text[]
      end),
    allergens = coalesce(
      (
        select metadata.allergens
        from metadata
        where lower(metadata.item_name) = lower(items.name)
        limit 1
      ),
      array['ask staff']::text[]
    ),
    spice_level = coalesce(
      (
        select metadata.spice_level
        from metadata
        where lower(metadata.item_name) = lower(items.name)
        limit 1
      ),
      case
        when lower(categories.name) in ('traditional foods','tibs','kitfo','beyaynet') then 2
        else 0
      end),
    dietary_tags = coalesce(
      (
        select metadata.dietary_tags
        from metadata
        where lower(metadata.item_name) = lower(items.name)
        limit 1
      ),
      case
        when lower(categories.name) like '%coffee%' or lower(categories.name) like '%tea%' or lower(categories.name) like '%juice%' then array['beverage','vegetarian']::text[]
        when lower(categories.name) like '%dessert%' or lower(categories.name) like '%bakery%' then array['dessert','vegetarian']::text[]
        else array['starter-template']::text[]
      end),
    description = case
      when nullif(btrim(items.description), '') is null then 'Professionally prepared starter menu item ready for owner customization.'
      else items.description
    end,
    calories = null,
    protein_g = null,
    carbohydrates_g = null,
    fat_g = null,
    fiber_g = null,
    sugar_g = null,
    sodium_mg = null
from public.restaurant_starter_template_categories categories
where categories.id = items.template_category_id;
