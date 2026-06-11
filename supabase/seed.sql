-- SERVEFLOW deterministic demo seed.
-- Applies a public QR menu at /r/demo.
--
-- This seed intentionally refreshes demo-owned order, category, and menu rows
-- only for the restaurant with slug "demo" so repeated runs produce the same
-- demo menu.

begin;

insert into public.restaurants (id, name, slug)
values (
  '11111111-1111-4111-8111-111111111111',
  'ServeFlow Demo Kitchen',
  'demo'
)
on conflict (slug) do update
set name = excluded.name;

delete from public.order_items
where restaurant_id = (
  select id
  from public.restaurants
  where slug = 'demo'
);

delete from public.orders
where restaurant_id = (
  select id
  from public.restaurants
  where slug = 'demo'
);

delete from public.menu_items
where restaurant_id = (
  select id
  from public.restaurants
  where slug = 'demo'
);

delete from public.categories
where restaurant_id = (
  select id
  from public.restaurants
  where slug = 'demo'
);

insert into public.categories (id, restaurant_id, name)
values
  (
    '22222222-2222-4222-8222-222222222201',
    (select id from public.restaurants where slug = 'demo'),
    'Breakfast'
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    (select id from public.restaurants where slug = 'demo'),
    'Mains'
  ),
  (
    '22222222-2222-4222-8222-222222222203',
    (select id from public.restaurants where slug = 'demo'),
    'Drinks'
  ),
  (
    '22222222-2222-4222-8222-222222222204',
    (select id from public.restaurants where slug = 'demo'),
    'Desserts'
  );

insert into public.menu_items (
  id,
  restaurant_id,
  category_id,
  name,
  price,
  image_url,
  available
)
values
  (
    '33333333-3333-4333-8333-333333333301',
    (select id from public.restaurants where slug = 'demo'),
    '22222222-2222-4222-8222-222222222201',
    'Sunrise Breakfast Plate',
    12.50,
    'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333302',
    (select id from public.restaurants where slug = 'demo'),
    '22222222-2222-4222-8222-222222222201',
    'Honey Oat Pancakes',
    9.75,
    'https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333303',
    (select id from public.restaurants where slug = 'demo'),
    '22222222-2222-4222-8222-222222222202',
    'Grilled Chicken Bowl',
    15.00,
    'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333304',
    (select id from public.restaurants where slug = 'demo'),
    '22222222-2222-4222-8222-222222222202',
    'Garden Pasta',
    13.25,
    'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333305',
    (select id from public.restaurants where slug = 'demo'),
    '22222222-2222-4222-8222-222222222203',
    'Iced Citrus Tea',
    4.50,
    'https://images.unsplash.com/photo-1499638673689-79a0b5115d87?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333306',
    (select id from public.restaurants where slug = 'demo'),
    '22222222-2222-4222-8222-222222222203',
    'House Coffee',
    3.75,
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333307',
    (select id from public.restaurants where slug = 'demo'),
    '22222222-2222-4222-8222-222222222204',
    'Chocolate Layer Cake',
    7.00,
    'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=900&q=80',
    true
  ),
  (
    '33333333-3333-4333-8333-333333333308',
    (select id from public.restaurants where slug = 'demo'),
    '22222222-2222-4222-8222-222222222204',
    'Berry Yogurt Parfait',
    6.25,
    'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=900&q=80',
    true
  );

commit;
