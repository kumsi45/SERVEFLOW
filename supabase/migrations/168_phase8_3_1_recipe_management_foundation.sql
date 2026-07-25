-- ServeFlow Phase 8.3.1: independent Recipe Management Foundation.
-- No ingredient, inventory, menu, kitchen, ordering, purchasing, or report links.

create table if not exists public.recipe_code_counters (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  last_value bigint not null default 0 check (last_value >= 0)
);

create table if not exists public.recipe_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  archived_at timestamptz,
  created_by_staff_id uuid references public.restaurant_staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id)
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  recipe_code text not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text check (description is null or char_length(description) <= 2000),
  category_id uuid,
  preparation_time_minutes integer not null default 0
    check (preparation_time_minutes between 0 and 10080),
  yield_quantity numeric(12,3) not null default 1 check (yield_quantity > 0),
  yield_unit text not null check (char_length(btrim(yield_unit)) between 1 and 40),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_by_staff_id uuid references public.restaurant_staff(id),
  updated_by_staff_id uuid references public.restaurant_staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  constraint recipes_category_same_restaurant foreign key (restaurant_id, category_id)
    references public.recipe_categories(restaurant_id, id) on delete restrict
);

create unique index if not exists recipes_restaurant_code_unique
  on public.recipes(restaurant_id, recipe_code);
create unique index if not exists recipe_categories_restaurant_name_unique
  on public.recipe_categories(restaurant_id, lower(btrim(name)))
  where archived_at is null;
create index if not exists recipes_search_idx
  on public.recipes(restaurant_id, status, category_id, preparation_time_minutes, created_at desc)
  where deleted_at is null;
create index if not exists recipes_name_idx
  on public.recipes(restaurant_id, lower(name)) where deleted_at is null;

alter table public.recipe_code_counters enable row level security;
alter table public.recipe_categories enable row level security;
alter table public.recipes enable row level security;

create or replace function public.recipe_can_read(target_restaurant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_staff_role(target_restaurant_id,
    array['owner','manager','inventory_officer']::public.restaurant_staff_role[])
$$;

create or replace function public.recipe_can_manage(target_restaurant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_staff_role(target_restaurant_id,
    array['owner','manager']::public.restaurant_staff_role[])
$$;

create or replace function public.recipe_actor(target_restaurant_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select staff.id from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid() and staff.active
    and staff.role::text in ('owner','manager')
  order by case when staff.role::text = 'owner' then 0 else 1 end, staff.created_at
  limit 1
$$;

drop policy if exists recipe_categories_read on public.recipe_categories;
drop policy if exists recipe_categories_manage on public.recipe_categories;
create policy recipe_categories_read on public.recipe_categories for select to authenticated
  using (public.recipe_can_read(restaurant_id));
create policy recipe_categories_manage on public.recipe_categories for all to authenticated
  using (public.recipe_can_manage(restaurant_id))
  with check (public.recipe_can_manage(restaurant_id));

drop policy if exists recipes_read on public.recipes;
drop policy if exists recipes_manage on public.recipes;
create policy recipes_read on public.recipes for select to authenticated
  using (public.recipe_can_read(restaurant_id));
create policy recipes_manage on public.recipes for all to authenticated
  using (public.recipe_can_manage(restaurant_id))
  with check (public.recipe_can_manage(restaurant_id));

-- Counters are internal only; SECURITY DEFINER mutation functions own access.
revoke all on public.recipe_code_counters from public, anon, authenticated;

create or replace function public.next_recipe_code(target_restaurant_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare next_value bigint;
begin
  if not public.recipe_can_manage(target_restaurant_id) then
    raise exception 'Only owners and managers may create recipes.';
  end if;
  insert into public.recipe_code_counters(restaurant_id, last_value)
  values (target_restaurant_id, 1)
  on conflict (restaurant_id) do update
    set last_value = recipe_code_counters.last_value + 1
  returning last_value into next_value;
  return 'REC-' || lpad(next_value::text, 6, '0');
end;
$$;

create or replace function public.recipe_normalize_row()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.yield_unit := btrim(new.yield_unit);
  if new.category_id is not null and not exists (
    select 1 from public.recipe_categories category
    where category.id = new.category_id
      and category.restaurant_id = new.restaurant_id
      and category.archived_at is null
  ) then raise exception 'Recipe category is invalid for this restaurant.'; end if;
  if tg_op = 'INSERT' then
    new.recipe_code := public.next_recipe_code(new.restaurant_id);
    new.created_by_staff_id := public.recipe_actor(new.restaurant_id);
  elsif new.recipe_code is distinct from old.recipe_code then
    raise exception 'Recipe code is immutable.';
  end if;
  new.updated_by_staff_id := public.recipe_actor(new.restaurant_id);
  new.updated_at := clock_timestamp();
  new.archived_at := case when new.status = 'archived'
    then coalesce(new.archived_at, clock_timestamp()) else null end;
  return new;
end;
$$;

drop trigger if exists recipe_normalize_trigger on public.recipes;
create trigger recipe_normalize_trigger before insert or update on public.recipes
for each row execute function public.recipe_normalize_row();

create or replace function public.recipe_category_normalize_row()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if tg_op = 'INSERT' then new.created_by_staff_id := public.recipe_actor(new.restaurant_id); end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists recipe_category_normalize_trigger on public.recipe_categories;
create trigger recipe_category_normalize_trigger before insert or update on public.recipe_categories
for each row execute function public.recipe_category_normalize_row();

create or replace function public.manage_recipe(recipe_action text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_restaurant_id uuid := nullif(payload->>'restaurant_id','')::uuid;
  target_id uuid := nullif(payload->>'recipe_id','')::uuid;
  source public.recipes;
  saved public.recipes;
  action text := lower(btrim(recipe_action));
begin
  if target_restaurant_id is null or not public.recipe_can_manage(target_restaurant_id) then
    raise exception 'Only owners and managers may manage recipes.';
  end if;
  if action in ('create','update') then
    if nullif(btrim(payload->>'name'),'') is null then raise exception 'Recipe name is required.'; end if;
    if nullif(btrim(payload->>'yield_unit'),'') is null then raise exception 'Yield unit is required.'; end if;
    if coalesce((payload->>'yield_quantity')::numeric, 0) <= 0 then raise exception 'Yield quantity must be greater than zero.'; end if;
    if action = 'create' then
      insert into public.recipes(restaurant_id, recipe_code, name, description, category_id,
        preparation_time_minutes, yield_quantity, yield_unit, status)
      values(target_restaurant_id, 'GENERATED', payload->>'name', payload->>'description',
        nullif(payload->>'category_id','')::uuid, coalesce((payload->>'preparation_time_minutes')::integer,0),
        (payload->>'yield_quantity')::numeric, payload->>'yield_unit',
        coalesce(nullif(payload->>'status',''),'draft')) returning * into saved;
    else
      update public.recipes set name=payload->>'name', description=payload->>'description',
        category_id=nullif(payload->>'category_id','')::uuid,
        preparation_time_minutes=coalesce((payload->>'preparation_time_minutes')::integer,0),
        yield_quantity=(payload->>'yield_quantity')::numeric, yield_unit=payload->>'yield_unit',
        status=coalesce(nullif(payload->>'status',''),status)
      where id=target_id and recipes.restaurant_id=target_restaurant_id and deleted_at is null
      returning * into saved;
    end if;
  elsif action = 'duplicate' then
    select * into source from public.recipes where id=target_id and recipes.restaurant_id=target_restaurant_id and deleted_at is null;
    if source.id is null then raise exception 'Recipe not found.'; end if;
    insert into public.recipes(restaurant_id,recipe_code,name,description,category_id,
      preparation_time_minutes,yield_quantity,yield_unit,status)
    values(target_restaurant_id,'GENERATED',left(source.name || ' Copy',160),source.description,source.category_id,
      source.preparation_time_minutes,source.yield_quantity,source.yield_unit,'draft') returning * into saved;
  elsif action in ('archive','restore','delete') then
    update public.recipes set
      status=case when action='archive' then 'archived' when action='restore' then 'draft' else status end,
      deleted_at=case when action='delete' then clock_timestamp() when action='restore' then null else deleted_at end
    where id=target_id and recipes.restaurant_id=target_restaurant_id
      and (action='restore' or deleted_at is null) returning * into saved;
  else raise exception 'Unsupported recipe action.'; end if;
  if saved.id is null then raise exception 'Recipe not found.'; end if;
  return to_jsonb(saved);
exception when unique_violation then raise exception 'Recipe name or code already exists.';
end;
$$;

create or replace function public.list_recipes(
  target_restaurant_id uuid, search_text text default null,
  category_filter uuid default null, status_filter text default null,
  preparation_filter text default null, sort_order text default 'newest',
  page_number integer default 1, page_size integer default 12
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.recipe_can_read(target_restaurant_id) then raise exception 'Recipe access denied.'; end if;
  if page_number < 1 or page_size not between 1 and 100 then raise exception 'Invalid pagination.'; end if;
  with filtered as (
    select recipes.*, categories.name category_name, creator.display_name created_by,
      count(*) over() total_count
    from public.recipes recipes
    left join public.recipe_categories categories on categories.id=recipes.category_id and categories.restaurant_id=recipes.restaurant_id
    left join public.restaurant_staff creator on creator.id=recipes.created_by_staff_id and creator.restaurant_id=recipes.restaurant_id
    where recipes.restaurant_id=target_restaurant_id and recipes.deleted_at is null
      and (nullif(btrim(search_text),'') is null or recipes.name ilike '%'||btrim(search_text)||'%'
        or recipes.recipe_code ilike '%'||btrim(search_text)||'%'
        or categories.name ilike '%'||btrim(search_text)||'%'
        or recipes.status ilike '%'||btrim(search_text)||'%')
      and (category_filter is null or recipes.category_id=category_filter)
      and (nullif(status_filter,'') is null or status_filter='all' or recipes.status=status_filter)
      and (nullif(preparation_filter,'') is null or preparation_filter='all'
        or preparation_filter='quick' and recipes.preparation_time_minutes<=15
        or preparation_filter='medium' and recipes.preparation_time_minutes between 16 and 45
        or preparation_filter='long' and recipes.preparation_time_minutes>45)
  ), paged as (
    select * from filtered order by
      case when sort_order='oldest' then created_at end asc,
      case when sort_order<>'oldest' then created_at end desc, id
    limit page_size offset (page_number-1)*page_size
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(to_jsonb(paged)-'total_count'),'[]'::jsonb),
    'total',coalesce(max(total_count),0),'page',page_number,'page_size',page_size
  ) into result from paged;
  return result;
end;
$$;

revoke all on public.recipe_categories, public.recipes from public, anon;
grant select on public.recipe_categories, public.recipes to authenticated;
grant insert, update on public.recipe_categories, public.recipes to authenticated;
revoke all on function public.recipe_can_read(uuid), public.recipe_can_manage(uuid), public.recipe_actor(uuid),
  public.next_recipe_code(uuid), public.manage_recipe(text,jsonb),
  public.list_recipes(uuid,text,uuid,text,text,text,integer,integer) from public, anon;
grant execute on function public.recipe_can_read(uuid), public.recipe_can_manage(uuid), public.recipe_actor(uuid),
  public.next_recipe_code(uuid), public.manage_recipe(text,jsonb),
  public.list_recipes(uuid,text,uuid,text,text,text,integer,integer) to authenticated, service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='recipes')
  then alter publication supabase_realtime add table public.recipes; end if;
end $$;
