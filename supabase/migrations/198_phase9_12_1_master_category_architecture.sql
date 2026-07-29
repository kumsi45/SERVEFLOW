begin;

-- Phase 9.12.1 owns categories only. The former seeded item layer is intentionally retired.
drop table if exists public.serveflow_smart_menu_items;
drop table if exists public.serveflow_smart_menu_categories;

create table public.serveflow_master_menu_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  icon text not null,
  display_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(name)) between 1 and 120),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  check (length(btrim(icon)) between 1 and 80),
  check (display_order > 0)
);

create table public.serveflow_smart_menu_library_categories (
  library_id uuid not null references public.serveflow_smart_menu_libraries(id) on delete cascade,
  category_id uuid not null references public.serveflow_master_menu_categories(id) on delete restrict,
  display_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (library_id, category_id),
  unique (library_id, display_order),
  check (display_order > 0)
);

create index serveflow_smart_menu_library_categories_category_idx
  on public.serveflow_smart_menu_library_categories(category_id);

create trigger serveflow_master_menu_categories_set_updated_at
before update on public.serveflow_master_menu_categories
for each row execute function public.set_updated_at();

alter table public.serveflow_master_menu_categories enable row level security;
alter table public.serveflow_smart_menu_library_categories enable row level security;

revoke all on public.serveflow_master_menu_categories from public, anon;
revoke all on public.serveflow_smart_menu_library_categories from public, anon;
grant select on public.serveflow_master_menu_categories to authenticated;
grant select on public.serveflow_smart_menu_library_categories to authenticated;

create policy serveflow_master_menu_categories_read
on public.serveflow_master_menu_categories
for select to authenticated using (active);

create policy serveflow_smart_menu_library_categories_read
on public.serveflow_smart_menu_library_categories
for select to authenticated using (
  active and exists (
    select 1
    from public.serveflow_smart_menu_libraries library
    where library.id = library_id and library.active
  )
);

insert into public.serveflow_master_menu_categories
  (name, slug, icon, display_order, active)
values
  ('Breakfast', 'breakfast', 'sunrise', 1, true),
  ('Ethiopian Traditional Dishes', 'ethiopian-traditional-dishes', 'utensils', 2, true),
  ('Chicken', 'chicken', 'drumstick', 3, true),
  ('Fish & Seafood', 'fish-seafood', 'fish', 4, true),
  ('Salads', 'salads', 'salad', 5, true),
  ('Soups', 'soups', 'soup', 6, true),
  ('Wraps', 'wraps', 'sandwich', 7, true),
  ('Pasta', 'pasta', 'utensils-crossed', 8, true),
  ('Pizza', 'pizza', 'pizza', 9, true),
  ('Burgers', 'burgers', 'sandwich', 10, true),
  ('Sandwiches', 'sandwiches', 'sandwich', 11, true),
  ('Rice Dishes', 'rice-dishes', 'bowl-steam', 12, true),
  ('Snacks & Fast Food', 'snacks-fast-food', 'popcorn', 13, true),
  ('Bakery', 'bakery', 'croissant', 14, true),
  ('Desserts', 'desserts', 'cake-slice', 15, true),
  ('Coffee', 'coffee', 'coffee', 16, true),
  ('Tea & Hot Drinks', 'tea-hot-drinks', 'cup-soda', 17, true),
  ('Fresh Juice', 'fresh-juice', 'citrus', 18, true),
  ('Smoothies & Milkshakes', 'smoothies-milkshakes', 'milk', 19, true),
  ('Soft Drinks', 'soft-drinks', 'cup-soda', 20, true),
  ('Alcoholic Drinks', 'alcoholic-drinks', 'wine', 21, true);

with category_mapping (restaurant_type, category_name, display_order) as (
  values
    ('Restaurant', 'Breakfast', 1),
    ('Restaurant', 'Ethiopian Traditional Dishes', 2),
    ('Restaurant', 'Chicken', 3),
    ('Restaurant', 'Fish & Seafood', 4),
    ('Restaurant', 'Salads', 5),
    ('Restaurant', 'Soups', 6),
    ('Restaurant', 'Pasta', 7),
    ('Restaurant', 'Rice Dishes', 8),
    ('Restaurant', 'Desserts', 9),
    ('Restaurant', 'Fresh Juice', 10),
    ('Restaurant', 'Coffee', 11),
    ('Restaurant', 'Soft Drinks', 12),
    ('Hotel', 'Breakfast', 1),
    ('Hotel', 'Ethiopian Traditional Dishes', 2),
    ('Hotel', 'Soups', 3),
    ('Hotel', 'Salads', 4),
    ('Hotel', 'Chicken', 5),
    ('Hotel', 'Fish & Seafood', 6),
    ('Hotel', 'Pasta', 7),
    ('Hotel', 'Pizza', 8),
    ('Hotel', 'Desserts', 9),
    ('Hotel', 'Fresh Juice', 10),
    ('Hotel', 'Coffee', 11),
    ('Hotel', 'Tea & Hot Drinks', 12),
    ('Hotel', 'Soft Drinks', 13),
    ('Cafe', 'Breakfast', 1),
    ('Cafe', 'Sandwiches', 2),
    ('Cafe', 'Desserts', 3),
    ('Cafe', 'Fresh Juice', 4),
    ('Cafe', 'Smoothies & Milkshakes', 5),
    ('Cafe', 'Coffee', 6),
    ('Cafe', 'Tea & Hot Drinks', 7),
    ('Cafe', 'Soft Drinks', 8),
    ('Fast Food', 'Burgers', 1),
    ('Fast Food', 'Chicken', 2),
    ('Fast Food', 'Wraps', 3),
    ('Fast Food', 'Pizza', 4),
    ('Fast Food', 'Sandwiches', 5),
    ('Fast Food', 'Snacks & Fast Food', 6),
    ('Fast Food', 'Soft Drinks', 7),
    ('Bar & Lounge', 'Snacks & Fast Food', 1),
    ('Bar & Lounge', 'Burgers', 2),
    ('Bar & Lounge', 'Chicken', 3),
    ('Bar & Lounge', 'Salads', 4),
    ('Bar & Lounge', 'Fresh Juice', 5),
    ('Bar & Lounge', 'Soft Drinks', 6),
    ('Bar & Lounge', 'Alcoholic Drinks', 7),
    ('Bakery', 'Breakfast', 1),
    ('Bakery', 'Bakery', 2),
    ('Bakery', 'Sandwiches', 3),
    ('Bakery', 'Desserts', 4),
    ('Bakery', 'Coffee', 5),
    ('Bakery', 'Tea & Hot Drinks', 6)
)
insert into public.serveflow_smart_menu_library_categories
  (library_id, category_id, display_order, active)
select library.id, category.id, mapping.display_order, true
from category_mapping mapping
join public.serveflow_smart_menu_libraries library
  on library.restaurant_type = mapping.restaurant_type
join public.serveflow_master_menu_categories category
  on category.name = mapping.category_name;

comment on table public.serveflow_master_menu_categories is
  'Canonical ServeFlow-owned menu categories. Each category exists exactly once.';
comment on table public.serveflow_smart_menu_library_categories is
  'Many-to-many mapping from restaurant-type libraries to canonical master categories.';

commit;
