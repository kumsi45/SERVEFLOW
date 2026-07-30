begin;

do $$
declare
  descriptions jsonb := $descriptions$
  {
    "Americano": "Espresso diluted with hot water for a smooth, full-bodied black coffee.",
    "Apple Pie": "Buttery pastry filled with sliced apples, cinnamon, and sugar, baked until golden.",
    "Asa Tibs": "Ethiopian-style fish pieces sautéed with onions, peppers, garlic, and aromatic spices.",
    "Avocado Juice": "Fresh avocado blended with milk and a touch of sugar until thick and smooth.",
    "Banana Milkshake": "Ripe banana blended with chilled milk and ice cream until creamy.",
    "Beef Burger": "Grilled seasoned beef patty served in a toasted bun with lettuce, tomato, and house sauce.",
    "Beef Pizza": "Baked pizza topped with seasoned beef, tomato sauce, cheese, onions, and peppers.",
    "Beef Rice": "Seasoned beef served with aromatic rice and sautéed vegetables.",
    "Beef Sandwich": "Sliced seasoned beef layered in bread with lettuce, tomato, onions, and sauce.",
    "Beef Wrap": "Seasoned beef wrapped in soft flatbread with fresh vegetables and house sauce.",
    "Beer": "Chilled malt beer served by the bottle or glass according to selection.",
    "Beyaynetu": "A selection of Ethiopian vegetable and pulse stews arranged on injera for sharing.",
    "Birthday Cake": "Celebration sponge cake layered with cream and finished with custom decoration.",
    "Black Forest Cake": "Chocolate sponge layered with whipped cream and cherries, finished with chocolate shavings.",
    "Black Tea": "Black tea leaves steeped in hot water and served plain or with sugar and lemon.",
    "Bottled Beer": "Factory-sealed beer served chilled in its original bottle.",
    "Brown Bread": "Whole-grain wheat loaf baked for a soft crumb and lightly nutty flavor.",
    "Brownie": "Dense baked chocolate square with a moist center and lightly crisp top.",
    "Butter Cookie": "Crisp baked cookie made with butter, flour, and sugar for a tender crumb.",
    "Caesar Salad": "Romaine lettuce tossed with Caesar dressing, croutons, and grated Parmesan.",
    "Cake": "Soft sponge cake layered or topped with smooth cream according to the daily selection.",
    "Cappuccino": "Fresh espresso topped with steamed milk and smooth milk foam.",
    "Cereals": "Breakfast cereal served with chilled or warm milk and optional fresh fruit.",
    "Chechebsa": "Traditional Ethiopian shredded flatbread sautéed with spiced butter and berbere, served warm for breakfast.",
    "Cheese Burger": "Grilled beef patty topped with melted cheese, lettuce, tomato, and sauce in a toasted bun.",
    "Cheese Hot Dog": "Grilled sausage in a soft bun topped with melted cheese and condiments.",
    "Chicken": "Seasoned chicken cooked until tender and served with the accompanying side of the day.",
    "Chicken Breast": "Boneless chicken breast seasoned and grilled or pan-seared until tender.",
    "Chicken Burger": "Seasoned chicken patty served in a toasted bun with lettuce, tomato, and house sauce.",
    "Chicken Cutlet": "Breaded chicken fillet fried until crisp and served with a savory dipping sauce.",
    "Chicken Pie": "Flaky pastry filled with seasoned chicken and vegetables in a savory sauce.",
    "Chicken Pieces": "Bone-in chicken pieces seasoned and fried until crisp outside and tender inside.",
    "Chicken Pizza": "Baked pizza topped with seasoned chicken, tomato sauce, cheese, onions, and peppers.",
    "Chicken Rice": "Seasoned chicken served over aromatic rice with sautéed vegetables.",
    "Chicken Salad": "Tender chicken served with mixed lettuce, tomato, cucumber, and house dressing.",
    "Chicken Sandwich": "Seasoned chicken layered in bread with lettuce, tomato, and house sauce.",
    "Chicken Soup": "Chicken simmered with vegetables, herbs, and light broth until tender.",
    "Chicken Wings": "Seasoned chicken wings fried or baked and coated with the selected sauce.",
    "Chicken Wrap": "Seasoned chicken wrapped in soft flatbread with fresh vegetables and house sauce.",
    "Chocolate Cake": "Soft chocolate sponge layered with rich chocolate cream.",
    "Chocolate Chip Cookie": "Buttery cookie baked with chocolate chips for crisp edges and a soft center.",
    "Chocolate Cupcake": "Individual chocolate sponge topped with smooth chocolate frosting.",
    "Chocolate Donut": "Soft fried dough coated with chocolate glaze and allowed to set.",
    "Chocolate Milkshake": "Chocolate and ice cream blended with chilled milk until thick and smooth.",
    "Classic Hot Dog": "Grilled sausage served in a soft bun with ketchup, mustard, and onions.",
    "Club Sandwich": "Layered toasted bread with chicken, egg, lettuce, tomato, and mayonnaise.",
    "Coca-Cola": "Carbonated cola served chilled over ice or in its sealed container.",
    "Cocktails": "A mixed alcoholic drink prepared to order from spirits, mixers, and fresh garnishes.",
    "Coffee": "Freshly roasted Ethiopian coffee brewed and served hot in the selected style.",
    "Continental Breakfast": "Bread and pastries served with butter, preserves, fruit, and a hot beverage.",
    "Cookies": "Assorted small-batch cookies baked until crisp or tender according to selection.",
    "Cosmopolitan": "Vodka shaken with orange liqueur, cranberry juice, and fresh lime, served chilled.",
    "Croissant": "Laminated butter pastry baked until flaky, airy, and golden.",
    "Danish Pastry": "Layered butter pastry baked with a fruit, custard, or cheese filling.",
    "Donut": "Soft yeast-raised dough fried until golden and finished with sugar or glaze.",
    "Doro Wot": "Chicken and boiled egg slow-cooked in berbere sauce with onions and niter kibbeh, served with injera.",
    "Double Burger": "Two grilled beef patties stacked in a toasted bun with vegetables and house sauce.",
    "Draft Beer": "Beer poured fresh from the tap and served chilled with a clean foam head.",
    "Drumsticks": "Seasoned chicken drumsticks fried or roasted until browned and tender.",
    "Dulet": "Finely chopped beef, liver, and tripe sautéed with onions, mitmita, and niter kibbeh.",
    "Energy Drink": "Chilled carbonated energy beverage served in its original sealed container.",
    "Espresso": "Finely ground coffee extracted under pressure into a concentrated aromatic shot.",
    "Ethiopian Breakfast": "A traditional breakfast selection with injera or flatbread, eggs, and a warm Ethiopian accompaniment.",
    "Fanta": "Fruit-flavored carbonated soft drink served chilled over ice or in its sealed container.",
    "Fetira": "Layered Ethiopian flatbread pan-cooked until golden and served with honey or a savory accompaniment.",
    "Filled Donut": "Soft fried dough filled with cream, custard, or fruit preserve and dusted with sugar.",
    "Firfir": "Torn injera sautéed in a seasoned berbere sauce with onions and spiced butter.",
    "Fish": "Fresh fish seasoned and grilled, fried, or pan-cooked according to the selected preparation.",
    "Fish Cutlet": "Seasoned fish fillet coated in crumbs and fried until crisp and flaky.",
    "Fish Soup": "Fish simmered gently with vegetables, herbs, and a light seasoned broth.",
    "French Bread": "Lean wheat loaf baked with a crisp crust and soft, open crumb.",
    "French Fries": "Potato strips fried until golden and crisp, then lightly seasoned.",
    "Fresh Fruits": "A seasonal selection of fresh fruit, washed, cut, and served chilled.",
    "Fresh Juice": "Seasonal fruit pressed or blended to order and served chilled without carbonation.",
    "Fried Chicken": "Marinated chicken coated in seasoned flour and fried until crisp and tender.",
    "Fried Fish": "Seasoned fish fried until the exterior is crisp and the center remains flaky.",
    "Fried Rice": "Cooked rice stir-fried with vegetables, egg, and light savory seasoning.",
    "Fruit Punch": "Mixed fruit juices shaken with citrus and served chilled over ice.",
    "Fruit Salad": "Seasonal fresh fruits cut into bite-sized pieces and served chilled.",
    "Ful": "Slow-cooked fava beans seasoned with cumin, onions, tomato, and chili, served warm with bread.",
    "Garden Salad": "Fresh lettuce, tomato, cucumber, carrots, and onions served with house dressing.",
    "Gin": "A measured serving of juniper-led gin offered neat, over ice, or with a selected mixer.",
    "Glazed Donut": "Yeast-raised donut fried until golden and coated with a thin sugar glaze.",
    "Gored Gored": "Cubed raw beef seasoned with awaze, mitmita, and melted niter kibbeh, served with injera.",
    "Greek Salad": "Tomato, cucumber, onion, olives, and feta cheese dressed with olive oil and herbs.",
    "Green Salad": "Crisp lettuce, cucumber, tomato, and green pepper tossed with a light dressing.",
    "Green Tea": "Green tea leaves gently steeped in hot water for a clean, lightly vegetal cup.",
    "Grilled Chicken": "Marinated chicken grilled over high heat until browned and tender.",
    "Grilled Fish": "Seasoned fish grilled until lightly charred outside and flaky at the center.",
    "Hot Dog": "Grilled sausage served in a soft bun with onions and classic condiments.",
    "Ice Cream": "Churned frozen dairy dessert served by the scoop in the selected flavor.",
    "Jack Daniel's": "Tennessee whiskey served neat, over ice, or with a selected mixer.",
    "Jameson": "Blended Irish whiskey served neat, over ice, or with a selected mixer.",
    "Johnnie Walker": "Blended Scotch whisky served neat, over ice, or with a selected mixer.",
    "Juice": "Prepared fruit juice served chilled by the glass or in its sealed container.",
    "Key Wot": "Tender beef slow-cooked with berbere, onions, garlic, and niter kibbeh, served with injera.",
    "Kinche": "Cracked wheat simmered until tender and finished with niter kibbeh and mild seasoning.",
    "Kitfo": "Finely minced premium beef seasoned with spiced butter and mitmita, served raw, rare, or lightly cooked.",
    "Latte": "Fresh espresso combined with steamed milk and finished with a light layer of foam.",
    "Lemon Mint": "Fresh lemon juice blended with mint, sugar, and ice until cold and smooth.",
    "Loaded Fries": "Crisp fries topped with melted cheese, savory sauce, and selected seasoned toppings.",
    "Local Beer": "Ethiopian-brewed beer served chilled in its original bottle or by the glass.",
    "Long Island Iced Tea": "Vodka, gin, rum, and tequila shaken with citrus and cola, served over ice.",
    "Macaroni": "Macaroni pasta cooked until tender and tossed with seasoned tomato sauce and vegetables.",
    "Macchiato": "Espresso marked with a small amount of steamed milk and milk foam.",
    "Mango Juice": "Ripe mango blended with water and a touch of sugar, then served chilled.",
    "Mango Milkshake": "Ripe mango and ice cream blended with chilled milk until creamy.",
    "Margarita": "Tequila shaken with orange liqueur and fresh lime, served chilled with a salted rim.",
    "Margherita Pizza": "Baked pizza topped with tomato sauce, mozzarella, and basil.",
    "Martini": "Gin or vodka stirred with dry vermouth and served chilled with an olive or lemon twist.",
    "Meat Pie": "Flaky pastry filled with seasoned minced meat, onions, and vegetables.",
    "Milk": "Pasteurized milk served chilled or warmed according to preference.",
    "Milk Bread": "Soft enriched bread baked with milk for a tender crumb and lightly sweet finish.",
    "Milk Tea": "Black tea brewed with milk and lightly sweetened, served hot.",
    "Milkshake": "Ice cream blended with chilled milk and the selected flavor until thick and smooth.",
    "Mini Pizza": "Individual baked pizza topped with tomato sauce, cheese, and selected toppings.",
    "Misir Wot": "Red lentils slow-cooked with berbere, onions, garlic, and niter kibbeh, served with injera.",
    "Mixed Juice": "Layers or a blend of seasonal fruit juices prepared fresh and served chilled.",
    "Mixed Salad": "Lettuce, tomato, cucumber, carrots, cabbage, and onions tossed with house dressing.",
    "Mocha": "Espresso blended with chocolate and steamed milk, finished with milk foam.",
    "Mojito": "White rum muddled with fresh mint and lime, topped with soda water and served over ice.",
    "Muffin": "Individual quick bread baked with a soft crumb in the selected flavor.",
    "Mushroom Soup": "Mushrooms simmered with onions, herbs, and stock, then finished to a smooth consistency.",
    "Nachos": "Crisp corn chips topped with melted cheese, salsa, and selected savory toppings.",
    "Nuggets": "Bite-sized breaded chicken pieces fried until crisp and served with dipping sauce.",
    "Oat Cookie": "Baked oat cookie with a chewy center, lightly crisp edges, and warm spice.",
    "Omelette": "Beaten eggs pan-cooked until tender with selected vegetables, cheese, or meat.",
    "Orange Juice": "Fresh oranges pressed to order and served chilled without added carbonation.",
    "Pancake": "Soft griddle-cooked pancakes served warm with butter and syrup or honey.",
    "Pasta": "Pasta cooked until tender and tossed with the selected house sauce and seasoning.",
    "Pasta Alfredo": "Pasta tossed in a creamy sauce made with butter, cream, and Parmesan cheese.",
    "Pasta with Beef": "Pasta tossed with tender seasoned beef, vegetables, and savory tomato sauce.",
    "Pasta with Chicken": "Pasta tossed with seasoned chicken, vegetables, and a savory house sauce.",
    "Peanuts": "Roasted peanuts lightly salted and served as a simple bar snack.",
    "Pepperoni Pizza": "Baked pizza topped with tomato sauce, mozzarella, and sliced pepperoni.",
    "Pepsi": "Pepsi cola served cold over ice or directly from its chilled sealed container.",
    "Pineapple Juice": "Fresh pineapple blended or pressed and served chilled with its natural pulp.",
    "Pizza": "Hand-stretched dough baked with tomato sauce, cheese, and selected toppings.",
    "Pizza Slice": "A baked slice of pizza with tomato sauce, cheese, and the selected topping.",
    "Popcorn": "Corn kernels popped until light and crisp, then seasoned with salt.",
    "Potato Wedges": "Skin-on potato wedges seasoned and fried or baked until crisp outside and soft inside.",
    "Puff Pastry": "Layered butter pastry baked until crisp, flaky, and golden.",
    "Red Velvet Cake": "Cocoa sponge with a soft red crumb, layered with smooth cream cheese frosting.",
    "Red Wine": "Red wine poured by the glass or bottle and served at a suitable cellar temperature.",
    "Rice": "Steamed long-grain rice cooked until fluffy and served as a side or base for a main dish.",
    "Scrambled Eggs": "Eggs gently cooked with butter until soft, seasoned, and served warm.",
    "Shekla Tibs": "Marinated beef sizzling in a traditional clay pot with onions, peppers, rosemary, and spices.",
    "Shiro": "Slow-cooked chickpea stew blended with Ethiopian spices and served with fresh injera.",
    "Soda Water": "Plain carbonated water served chilled over ice with optional lemon or lime.",
    "Soft Drinks": "A chilled carbonated beverage served by the bottle, can, or glass according to selection.",
    "Spaghetti": "Spaghetti cooked until tender and tossed with seasoned tomato sauce and herbs.",
    "Sparkling Wine": "Effervescent wine served well chilled by the glass or bottle.",
    "Sprite": "Lemon-lime carbonated soft drink served chilled over ice or in its sealed container.",
    "Steak": "Seasoned beef steak grilled to the requested doneness and rested before serving.",
    "Strawberry Cupcake": "Individual strawberry sponge topped with smooth strawberry frosting.",
    "Strawberry Milkshake": "Strawberries and ice cream blended with chilled milk until creamy.",
    "Sundae": "Scoops of ice cream topped with sauce, whipped cream, and selected garnishes.",
    "Tea": "Tea leaves steeped in hot water and served plain or with milk, sugar, or lemon.",
    "Tegabino": "Thick, clay-pot shiro simmered with chickpea flour, onions, spices, and niter kibbeh, served bubbling hot.",
    "Tibs": "Tender beef sautéed with onions, peppers, rosemary, and Ethiopian spices, served with injera.",
    "Toast": "Sliced bread toasted until golden and served with butter and preserves.",
    "Tomato Soup": "Tomatoes simmered with onions, herbs, and stock, then blended until smooth.",
    "Tuna Pizza": "Baked pizza topped with tomato sauce, cheese, tuna, onions, and peppers.",
    "Tuna Salad": "Tuna served with lettuce, tomato, cucumber, onions, and a light dressing.",
    "Tuna Sandwich": "Tuna mixed with light dressing and layered in bread with lettuce and tomato.",
    "Vanilla Cupcake": "Individual vanilla sponge topped with smooth vanilla frosting.",
    "Vanilla Milkshake": "Vanilla ice cream blended with chilled milk until thick and smooth.",
    "Vegetable Pizza": "Baked pizza topped with tomato sauce, cheese, peppers, onions, mushrooms, and olives.",
    "Vegetable Rice": "Aromatic rice cooked with mixed vegetables, herbs, and mild seasoning.",
    "Vegetable Sandwich": "Fresh and grilled vegetables layered in bread with cheese and house spread.",
    "Vegetable Soup": "Seasonal vegetables simmered with herbs and stock until tender.",
    "Vegetable Wrap": "Seasoned vegetables wrapped in soft flatbread with fresh greens and house sauce.",
    "Virgin Mojito": "Fresh mint and lime muddled with sugar, topped with soda water and served over ice.",
    "Vodka": "A measured serving of vodka offered neat, over ice, or with a selected mixer.",
    "Water": "Sealed still or sparkling drinking water served chilled or at room temperature.",
    "Whisky": "A measured serving of whisky offered neat, over ice, or with a selected mixer.",
    "White Bread": "Classic wheat loaf baked with a soft, even crumb and light golden crust.",
    "White Forest Cake": "Vanilla sponge layered with whipped cream and cherries, finished with white chocolate.",
    "White Wine": "White wine poured by the glass or bottle and served properly chilled.",
    "Wine": "Selected wine served by the glass or bottle at the appropriate temperature."
  }
  $descriptions$::jsonb;
  expected_count integer;
  updated_count integer;
begin
  select count(*) into expected_count
  from public.serveflow_master_menu_items;

  if expected_count <> 180 then
    raise exception 'Expected exactly 180 master menu items, found %.', expected_count;
  end if;

  if (select count(*) from jsonb_each_text(descriptions)) <> 180 then
    raise exception 'Expected exactly 180 authored descriptions, found %.', (select count(*) from jsonb_each_text(descriptions));
  end if;

  if exists (
    select 1
    from jsonb_each_text(descriptions) authored
    left join public.serveflow_master_menu_items item on item.name = authored.key
    where item.id is null
  ) or exists (
    select 1
    from public.serveflow_master_menu_items item
    where not descriptions ? item.name
  ) then
    raise exception 'The authored description names do not exactly match the master menu item names.';
  end if;

  if exists (
    select 1 from jsonb_each_text(descriptions)
    where length(btrim(value)) = 0
       or length(value) > 160
       or value ~* '(lorem ipsum|carefully prepared|satisfying dining experience|refreshing drink|amazing|fantastic|best|delicious|wonderful)'
  ) then
    raise exception 'An authored description violates the content rules.';
  end if;

  if (select count(distinct lower(btrim(value))) from jsonb_each_text(descriptions)) <> 180 then
    raise exception 'Every authored description must be unique.';
  end if;

  update public.serveflow_master_menu_items item
  set default_description = descriptions->>item.name
  where item.default_description is distinct from descriptions->>item.name;
  get diagnostics updated_count = row_count;

  if updated_count <> 180 then
    raise exception 'Expected to replace 180 descriptions, replaced %.', updated_count;
  end if;

  if exists (
    select 1 from public.serveflow_master_menu_items
    where length(default_description) > 160
       or length(btrim(default_description)) = 0
  ) or (
    select count(distinct lower(btrim(default_description)))
    from public.serveflow_master_menu_items
  ) <> 180 then
    raise exception 'Post-update master description validation failed.';
  end if;
end;
$$;

commit;
