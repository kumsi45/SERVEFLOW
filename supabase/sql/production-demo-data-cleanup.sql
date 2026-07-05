-- ServeFlow production demo data cleanup.
-- Data only: preserves schema, migrations, RLS, RPCs, triggers, enums,
-- constraints, indexes, storage buckets, and auth.users.
--
-- Targets only explicitly identified demo/test/presentation restaurants:
-- - slugs containing demo, test, sample, or mock
-- - deterministic demo seed IDs
-- - Hora Cafe presentation seed data

begin;

create temporary table cleanup_demo_restaurants (
  id uuid primary key,
  slug text not null,
  name text not null
) on commit drop;

insert into cleanup_demo_restaurants (id, slug, name)
select id, slug, name
from public.restaurants
where slug ~* '(demo|test|sample|mock)'
   or id in (
     '11111111-1111-4111-8111-111111111111'::uuid,
     '11111111-1111-4111-8111-1111111111aa'::uuid
   )
   or slug = 'hora-cafe';

create temporary table cleanup_deleted_rows (
  table_name text primary key,
  deleted_rows bigint not null
) on commit drop;

with deleted as (
  delete from public.shift_activity_logs logs
  using cleanup_demo_restaurants demo
  where logs.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.shift_activity_logs', count(*) from deleted;

alter table public.cash_reconciliations disable trigger cash_reconciliations_immutable_delete;
with deleted as (
  delete from public.cash_reconciliations reconciliations
  using cleanup_demo_restaurants demo
  where reconciliations.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.cash_reconciliations', count(*) from deleted;
alter table public.cash_reconciliations enable trigger cash_reconciliations_immutable_delete;

with deleted as (
  delete from public.cashier_shifts shifts
  using cleanup_demo_restaurants demo
  where shifts.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.cashier_shifts', count(*) from deleted;

with deleted as (
  delete from public.restaurant_table_qr_scans scans
  using cleanup_demo_restaurants demo
  where scans.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.restaurant_table_qr_scans', count(*) from deleted;

with deleted as (
  delete from public.staff_activity_log logs
  using cleanup_demo_restaurants demo
  where logs.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.staff_activity_log', count(*) from deleted;

with deleted as (
  delete from public.order_items items
  using cleanup_demo_restaurants demo
  where items.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.order_items', count(*) from deleted;

with deleted as (
  delete from public.orders orders
  using cleanup_demo_restaurants demo
  where orders.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.orders', count(*) from deleted;

with deleted as (
  delete from public.menu_uploads uploads
  using cleanup_demo_restaurants demo
  where uploads.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.menu_uploads', count(*) from deleted;

with deleted as (
  delete from public.menu_items items
  using cleanup_demo_restaurants demo
  where items.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.menu_items', count(*) from deleted;

with deleted as (
  delete from public.categories categories
  using cleanup_demo_restaurants demo
  where categories.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.categories', count(*) from deleted;

with deleted as (
  delete from public.restaurant_tables tables
  using cleanup_demo_restaurants demo
  where tables.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.restaurant_tables', count(*) from deleted;

with deleted as (
  delete from public.restaurant_staff staff
  using cleanup_demo_restaurants demo
  where staff.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.restaurant_staff', count(*) from deleted;

with deleted as (
  delete from public.users users
  using cleanup_demo_restaurants demo
  where users.restaurant_id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.users', count(*) from deleted;

with deleted as (
  delete from public.restaurants restaurants
  using cleanup_demo_restaurants demo
  where restaurants.id = demo.id
  returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.restaurants', count(*) from deleted;

select table_name, deleted_rows
from cleanup_deleted_rows
order by table_name;

-- Verification result sets should all return zero rows.
select id, name, slug
from public.restaurants
where slug ~* '(demo|test|sample|mock)'
   or slug = 'hora-cafe'
   or id in (
     '11111111-1111-4111-8111-111111111111'::uuid,
     '11111111-1111-4111-8111-1111111111aa'::uuid
   );

select items.id, items.restaurant_id
from public.menu_items items
left join public.restaurants restaurants on restaurants.id = items.restaurant_id
where restaurants.id is null;

select categories.id, categories.restaurant_id
from public.categories categories
left join public.restaurants restaurants on restaurants.id = categories.restaurant_id
where restaurants.id is null;

commit;
