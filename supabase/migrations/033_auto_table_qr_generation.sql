-- Automatic restaurant table and QR generation.
-- Keeps existing /r/:slug/order public ordering route and never deletes tables.

alter table public.restaurant_tables
  add column if not exists qr_token uuid not null default gen_random_uuid(),
  add column if not exists qr_url text,
  add column if not exists qr_created_at timestamptz not null default now(),
  add column if not exists qr_regenerated_at timestamptz not null default now();

create unique index if not exists restaurant_tables_qr_token_key
on public.restaurant_tables (qr_token);

create index if not exists restaurant_tables_restaurant_active_table_idx
on public.restaurant_tables (restaurant_id, active, table_number);

update public.restaurant_tables rt
set
  qr_token = coalesce(rt.qr_token, gen_random_uuid()),
  qr_url = coalesce(nullif(trim(rt.qr_url), ''), '/r/' || r.slug || '/order?t=' || rt.table_number || '&qr=' || rt.qr_token),
  qr_created_at = coalesce(rt.qr_created_at, rt.created_at, now()),
  qr_regenerated_at = coalesce(rt.qr_regenerated_at, rt.updated_at, rt.created_at, now()),
  qr_path = coalesce(nullif(trim(rt.qr_path), ''), '/r/' || r.slug || '/order?t=' || rt.table_number || '&qr=' || rt.qr_token)
from public.restaurants r
where rt.restaurant_id = r.id
  and (
    rt.qr_url is null
    or trim(rt.qr_url) = ''
    or rt.qr_path is null
    or trim(rt.qr_path) = ''
  );

alter table public.restaurant_tables
  alter column qr_url set not null;

create or replace function public.normalize_restaurant_table_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_total integer;
begin
  if TG_OP = 'UPDATE' and new.total_tables is distinct from old.total_tables then
    requested_total := new.total_tables;
  elsif TG_OP = 'UPDATE' and new.table_count is distinct from old.table_count then
    requested_total := new.table_count;
  else
    requested_total := coalesce(new.table_count, new.total_tables, 20);
  end if;

  requested_total := greatest(1, least(500, requested_total));

  new.total_tables := requested_total;
  new.table_count := requested_total;

  return new;
end;
$$;

revoke all on function public.normalize_restaurant_table_count() from public, anon, authenticated;
grant execute on function public.normalize_restaurant_table_count() to service_role;

drop trigger if exists normalize_restaurant_table_count_before_write on public.restaurants;

create trigger normalize_restaurant_table_count_before_write
before insert or update of total_tables, table_count on public.restaurants
for each row
execute function public.normalize_restaurant_table_count();

create or replace function public.sync_restaurant_tables_internal(target_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  table_no integer;
  restaurant_slug text;
  bounded_total integer;
  existing_token uuid;
begin
  select slug, greatest(1, least(500, coalesce(table_count, total_tables, 20)))
  into restaurant_slug, bounded_total
  from public.restaurants
  where id = target_restaurant_id;

  if restaurant_slug is null then
    raise exception 'Restaurant not found.';
  end if;

  for table_no in 1..bounded_total loop
    existing_token := null;

    select qr_token
    into existing_token
    from public.restaurant_tables
    where restaurant_id = target_restaurant_id
      and table_number = table_no;

    if existing_token is null then
      existing_token := gen_random_uuid();
    end if;

    insert into public.restaurant_tables (
      restaurant_id,
      table_number,
      label,
      qr_path,
      qr_token,
      qr_url,
      qr_created_at,
      qr_regenerated_at,
      active
    )
    values (
      target_restaurant_id,
      table_no,
      'Table ' || table_no,
      '/r/' || restaurant_slug || '/order?t=' || table_no || '&qr=' || existing_token,
      existing_token,
      '/r/' || restaurant_slug || '/order?t=' || table_no || '&qr=' || existing_token,
      now(),
      now(),
      true
    )
    on conflict (restaurant_id, table_number)
    do update set
      label = coalesce(nullif(trim(public.restaurant_tables.label), ''), excluded.label),
      qr_path = excluded.qr_path,
      qr_url = excluded.qr_url,
      active = true,
      qr_regenerated_at = case
        when public.restaurant_tables.qr_url is distinct from excluded.qr_url
          or public.restaurant_tables.qr_path is distinct from excluded.qr_path
          or public.restaurant_tables.active is distinct from true
        then now()
        else public.restaurant_tables.qr_regenerated_at
      end,
      updated_at = now();
  end loop;

  update public.restaurant_tables
  set active = false,
      updated_at = now()
  where restaurant_id = target_restaurant_id
    and table_number > bounded_total
    and active = true;
end;
$$;

revoke all on function public.sync_restaurant_tables_internal(uuid) from public, anon, authenticated;
grant execute on function public.sync_restaurant_tables_internal(uuid) to service_role;

create or replace function public.sync_restaurant_tables(target_restaurant_id uuid, requested_total_tables integer)
returns setof public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  bounded_total integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to configure tables.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may configure tables.';
  end if;

  if target_restaurant_id is null or requested_total_tables is null then
    raise exception 'Restaurant and table count are required.';
  end if;

  bounded_total := greatest(1, least(500, requested_total_tables));

  update public.restaurants
  set total_tables = bounded_total,
      table_count = bounded_total
  where id = target_restaurant_id;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  perform public.sync_restaurant_tables_internal(target_restaurant_id);

  return query
  select *
  from public.restaurant_tables
  where restaurant_id = target_restaurant_id
    and active = true
  order by table_number;
end;
$$;

revoke all on function public.sync_restaurant_tables(uuid, integer) from public, anon;
grant execute on function public.sync_restaurant_tables(uuid, integer) to authenticated;

create or replace function public.sync_restaurant_tables_after_restaurant_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_restaurant_tables_internal(new.id);
  return new;
end;
$$;

revoke all on function public.sync_restaurant_tables_after_restaurant_write() from public, anon, authenticated;
grant execute on function public.sync_restaurant_tables_after_restaurant_write() to service_role;

drop trigger if exists sync_restaurant_tables_after_restaurant_write on public.restaurants;

create trigger sync_restaurant_tables_after_restaurant_write
after insert or update of total_tables, table_count, slug on public.restaurants
for each row
execute function public.sync_restaurant_tables_after_restaurant_write();

do $$
declare
  restaurant_row record;
begin
  for restaurant_row in select id from public.restaurants loop
    perform public.sync_restaurant_tables_internal(restaurant_row.id);
  end loop;
end;
$$;
