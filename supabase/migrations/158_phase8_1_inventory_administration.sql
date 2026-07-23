-- Phase 8.1: isolated inventory administration master data.
-- Administrative only: no stock movement, kitchen workflow, purchasing, realtime, or reports.

create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  sort_order integer not null default 1000,
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_by_staff_id uuid references public.restaurant_staff(id),
  updated_by_staff_id uuid references public.restaurant_staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  phone text check (phone is null or char_length(phone) <= 60),
  address text check (address is null or char_length(address) <= 500),
  contact_person text check (contact_person is null or char_length(contact_person) <= 120),
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_by_staff_id uuid references public.restaurant_staff(id),
  updated_by_staff_id uuid references public.restaurant_staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_storage_locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 500),
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_by_staff_id uuid references public.restaurant_staff(id),
  updated_by_staff_id uuid references public.restaurant_staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  description text check (description is null or char_length(description) <= 250),
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_by_staff_id uuid references public.restaurant_staff(id),
  updated_by_staff_id uuid references public.restaurant_staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inventory_items add column if not exists category_id uuid references public.inventory_categories(id);
alter table public.inventory_items add column if not exists unit_id uuid references public.inventory_units(id);
alter table public.inventory_items add column if not exists storage_location_id uuid references public.inventory_storage_locations(id);
alter table public.inventory_items add column if not exists preferred_supplier_id uuid references public.inventory_suppliers(id);
alter table public.inventory_items add column if not exists sku text;
alter table public.inventory_items add column if not exists barcode text;
alter table public.inventory_items add column if not exists minimum_stock numeric(12,3) not null default 0 check (minimum_stock >= 0);
alter table public.inventory_items add column if not exists maximum_stock numeric(12,3) check (maximum_stock is null or maximum_stock >= 0);
alter table public.inventory_items add column if not exists description text check (description is null or char_length(description) <= 1000);
alter table public.inventory_items add column if not exists status text not null default 'active' check (status in ('active', 'archived', 'deleted'));
alter table public.inventory_items add column if not exists archived_at timestamptz;
alter table public.inventory_items add column if not exists deleted_at timestamptz;
alter table public.inventory_items add column if not exists created_by_staff_id uuid references public.restaurant_staff(id);
alter table public.inventory_items add column if not exists updated_by_staff_id uuid references public.restaurant_staff(id);

create unique index if not exists inventory_categories_restaurant_name_unique
  on public.inventory_categories(restaurant_id, lower(btrim(name)))
  where status <> 'deleted';
create unique index if not exists inventory_suppliers_restaurant_name_unique
  on public.inventory_suppliers(restaurant_id, lower(btrim(name)))
  where status <> 'deleted';
create unique index if not exists inventory_storage_locations_restaurant_name_unique
  on public.inventory_storage_locations(restaurant_id, lower(btrim(name)))
  where status <> 'deleted';
create unique index if not exists inventory_units_restaurant_name_unique
  on public.inventory_units(restaurant_id, lower(btrim(name)))
  where status <> 'deleted';
create unique index if not exists inventory_items_restaurant_name_admin_unique
  on public.inventory_items(restaurant_id, lower(btrim(name)))
  where status <> 'deleted';
create unique index if not exists inventory_items_restaurant_sku_unique
  on public.inventory_items(restaurant_id, lower(btrim(sku)))
  where nullif(btrim(coalesce(sku, '')), '') is not null and status <> 'deleted';
create unique index if not exists inventory_items_restaurant_barcode_unique
  on public.inventory_items(restaurant_id, lower(btrim(barcode)))
  where nullif(btrim(coalesce(barcode, '')), '') is not null and status <> 'deleted';

create index if not exists inventory_items_admin_lookup_idx
  on public.inventory_items(restaurant_id, status, created_at desc);
create index if not exists inventory_items_admin_category_idx
  on public.inventory_items(restaurant_id, category_id, preferred_supplier_id, storage_location_id);

alter table public.inventory_categories enable row level security;
alter table public.inventory_suppliers enable row level security;
alter table public.inventory_storage_locations enable row level security;
alter table public.inventory_units enable row level security;
alter table public.inventory_items enable row level security;

create or replace function public.inventory_admin_has_access(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.has_staff_role(target_restaurant_id, array['owner','manager']::public.restaurant_staff_role[]);
$$;

create or replace function public.inventory_admin_actor(target_restaurant_id uuid)
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select s.id
  from public.restaurant_staff s
  where s.restaurant_id = target_restaurant_id
    and s.user_id = auth.uid()
    and s.active = true
    and s.role in ('owner','manager')
  order by case when s.role = 'owner' then 0 else 1 end
  limit 1;
$$;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'inventory_categories',
    'inventory_suppliers',
    'inventory_storage_locations',
    'inventory_units'
  ] loop
    execute 'drop policy if exists ' || table_name || '_inventory_admin_select on public.' || table_name;
    execute 'drop policy if exists ' || table_name || '_inventory_admin_insert on public.' || table_name;
    execute 'drop policy if exists ' || table_name || '_inventory_admin_update on public.' || table_name;
    execute 'create policy ' || table_name || '_inventory_admin_select on public.' || table_name || ' for select to authenticated using (public.inventory_admin_has_access(restaurant_id))';
    execute 'create policy ' || table_name || '_inventory_admin_insert on public.' || table_name || ' for insert to authenticated with check (public.inventory_admin_has_access(restaurant_id))';
    execute 'create policy ' || table_name || '_inventory_admin_update on public.' || table_name || ' for update to authenticated using (public.inventory_admin_has_access(restaurant_id)) with check (public.inventory_admin_has_access(restaurant_id))';
  end loop;
end $$;

drop policy if exists inventory_items_inventory_admin_select on public.inventory_items;
drop policy if exists inventory_items_inventory_admin_insert on public.inventory_items;
drop policy if exists inventory_items_inventory_admin_update on public.inventory_items;
create policy inventory_items_inventory_admin_select on public.inventory_items
  for select to authenticated using (public.inventory_admin_has_access(restaurant_id));
create policy inventory_items_inventory_admin_insert on public.inventory_items
  for insert to authenticated with check (public.inventory_admin_has_access(restaurant_id));
create policy inventory_items_inventory_admin_update on public.inventory_items
  for update to authenticated using (public.inventory_admin_has_access(restaurant_id))
  with check (public.inventory_admin_has_access(restaurant_id));

create or replace function public.inventory_admin_normalize_row()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by_staff_id := coalesce(new.created_by_staff_id, public.inventory_admin_actor(new.restaurant_id));
  end if;
  new.updated_by_staff_id := coalesce(public.inventory_admin_actor(new.restaurant_id), new.updated_by_staff_id);
  new.updated_at := now();
  new.archived_at := case when new.status = 'archived' then coalesce(new.archived_at, now()) else null end;
  new.deleted_at := case when new.status = 'deleted' then coalesce(new.deleted_at, now()) else null end;
  return new;
end $$;

create or replace function public.inventory_admin_validate_item()
returns trigger
language plpgsql
set search_path=public
as $$
declare unit_name text;
begin
  new.name := btrim(new.name);
  new.sku := nullif(btrim(coalesce(new.sku, '')), '');
  new.barcode := nullif(btrim(coalesce(new.barcode, '')), '');

  if new.category_id is null then
    raise exception 'Inventory category is required.';
  end if;
  if new.unit_id is null then
    raise exception 'Inventory unit is required.';
  end if;
  if new.storage_location_id is null then
    raise exception 'Inventory storage location is required.';
  end if;
  if new.maximum_stock is not null and new.maximum_stock < new.minimum_stock then
    raise exception 'Maximum stock cannot be less than minimum stock.';
  end if;
  if not exists(select 1 from public.inventory_categories c where c.id = new.category_id and c.restaurant_id = new.restaurant_id and c.status <> 'deleted') then
    raise exception 'Inventory category is invalid.';
  end if;
  select u.name into unit_name from public.inventory_units u where u.id = new.unit_id and u.restaurant_id = new.restaurant_id and u.status <> 'deleted';
  if unit_name is null then
    raise exception 'Inventory unit is invalid.';
  end if;
  if not exists(select 1 from public.inventory_storage_locations l where l.id = new.storage_location_id and l.restaurant_id = new.restaurant_id and l.status <> 'deleted') then
    raise exception 'Inventory storage location is invalid.';
  end if;
  if new.preferred_supplier_id is not null and not exists(select 1 from public.inventory_suppliers s where s.id = new.preferred_supplier_id and s.restaurant_id = new.restaurant_id and s.status <> 'deleted') then
    raise exception 'Preferred supplier is invalid.';
  end if;

  new.unit := unit_name;
  new.active := new.status = 'active';
  if tg_op = 'INSERT' then
    new.created_by_staff_id := coalesce(new.created_by_staff_id, public.inventory_admin_actor(new.restaurant_id));
  end if;
  new.updated_by_staff_id := coalesce(public.inventory_admin_actor(new.restaurant_id), new.updated_by_staff_id);
  new.updated_at := now();
  new.archived_at := case when new.status = 'archived' then coalesce(new.archived_at, now()) else null end;
  new.deleted_at := case when new.status = 'deleted' then coalesce(new.deleted_at, now()) else null end;
  return new;
end $$;

create or replace function public.inventory_admin_prevent_unit_delete_in_use()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status = 'deleted' and old.status <> 'deleted' and exists (
    select 1 from public.inventory_items i
    where i.restaurant_id = new.restaurant_id
      and i.unit_id = new.id
      and i.status <> 'deleted'
  ) then
    raise exception 'Inventory unit is already in use.';
  end if;
  return new;
end $$;

drop trigger if exists inventory_categories_admin_normalize on public.inventory_categories;
create trigger inventory_categories_admin_normalize
  before insert or update on public.inventory_categories
  for each row execute function public.inventory_admin_normalize_row();

drop trigger if exists inventory_suppliers_admin_normalize on public.inventory_suppliers;
create trigger inventory_suppliers_admin_normalize
  before insert or update on public.inventory_suppliers
  for each row execute function public.inventory_admin_normalize_row();

drop trigger if exists inventory_storage_locations_admin_normalize on public.inventory_storage_locations;
create trigger inventory_storage_locations_admin_normalize
  before insert or update on public.inventory_storage_locations
  for each row execute function public.inventory_admin_normalize_row();

drop trigger if exists inventory_units_admin_normalize on public.inventory_units;
create trigger inventory_units_admin_normalize
  before insert or update on public.inventory_units
  for each row execute function public.inventory_admin_normalize_row();

drop trigger if exists inventory_items_admin_validate on public.inventory_items;
create trigger inventory_items_admin_validate
  before insert or update on public.inventory_items
  for each row execute function public.inventory_admin_validate_item();

drop trigger if exists inventory_units_prevent_delete_in_use on public.inventory_units;
create trigger inventory_units_prevent_delete_in_use
  before update on public.inventory_units
  for each row execute function public.inventory_admin_prevent_unit_delete_in_use();

revoke all on public.inventory_categories from public, anon;
revoke all on public.inventory_suppliers from public, anon;
revoke all on public.inventory_storage_locations from public, anon;
revoke all on public.inventory_units from public, anon;
grant select, insert, update on public.inventory_categories to authenticated;
grant select, insert, update on public.inventory_suppliers to authenticated;
grant select, insert, update on public.inventory_storage_locations to authenticated;
grant select, insert, update on public.inventory_units to authenticated;
grant select, insert, update on public.inventory_items to authenticated;

revoke all on function public.inventory_admin_has_access(uuid) from public, anon;
revoke all on function public.inventory_admin_actor(uuid) from public, anon;
grant execute on function public.inventory_admin_has_access(uuid) to authenticated, service_role;
grant execute on function public.inventory_admin_actor(uuid) to authenticated, service_role;
