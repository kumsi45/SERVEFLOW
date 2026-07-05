-- One-time ServeFlow development data cleanup.
-- Data only: preserves schema, migrations, RLS, RPCs, triggers, enums, constraints, indexes, storage buckets, and auth.users.
-- Run only against the linked development database before onboarding real restaurants.

begin;

create temporary table cleanup_deleted_rows (
  table_name text primary key,
  deleted_rows bigint not null
) on commit drop;

-- Storage assets are deleted separately through the Supabase Storage API.
-- Direct SQL deletion from storage.objects is intentionally blocked by Supabase.

-- Child/audit tables first.
with deleted as (
  delete from public.shift_activity_logs returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.shift_activity_logs', count(*) from deleted;

-- The immutable reconciliation trigger is a production guardrail. It is re-enabled before commit.
alter table public.cash_reconciliations disable trigger cash_reconciliations_immutable_delete;
with deleted as (
  delete from public.cash_reconciliations returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.cash_reconciliations', count(*) from deleted;
alter table public.cash_reconciliations enable trigger cash_reconciliations_immutable_delete;

with deleted as (
  delete from public.restaurant_table_qr_scans returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.restaurant_table_qr_scans', count(*) from deleted;

with deleted as (
  delete from public.staff_activity_log returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.staff_activity_log', count(*) from deleted;

with deleted as (
  delete from public.order_items returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.order_items', count(*) from deleted;

-- Operational parent rows after their child logs/items.
with deleted as (
  delete from public.cashier_shifts returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.cashier_shifts', count(*) from deleted;

with deleted as (
  delete from public.orders returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.orders', count(*) from deleted;

-- Restaurant-owned content and profiles.
with deleted as (
  delete from public.menu_uploads returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.menu_uploads', count(*) from deleted;

with deleted as (
  delete from public.menu_items returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.menu_items', count(*) from deleted;

with deleted as (
  delete from public.categories returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.categories', count(*) from deleted;

with deleted as (
  delete from public.restaurant_tables returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.restaurant_tables', count(*) from deleted;

with deleted as (
  delete from public.restaurant_staff returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.restaurant_staff', count(*) from deleted;

-- Public app users are tenant data. Supabase auth.users is intentionally untouched.
with deleted as (
  delete from public.users returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.users', count(*) from deleted;

with deleted as (
  delete from public.restaurants returning 1
)
insert into cleanup_deleted_rows(table_name, deleted_rows)
select 'public.restaurants', count(*) from deleted;

select table_name, deleted_rows
from cleanup_deleted_rows
order by table_name;

commit;
