-- Owner Tables Phase 1: canonical occupancy-adjacent reads, safe table-count
-- reduction, QR capability least privilege, trustworthy activity metrics, and
-- server-authoritative audit events. No dining-session or release semantics change.

alter type public.staff_activity_action
  add value if not exists 'restaurant_table_qr_regenerated';
alter type public.staff_activity_action
  add value if not exists 'restaurant_table_disabled';
alter type public.staff_activity_action
  add value if not exists 'restaurant_table_enabled';

-- A QR token is a bearer capability. Public clients use the guarded RPCs and
-- must not enumerate table capabilities through direct relation reads.
drop policy if exists restaurant_tables_select_public_active
  on public.restaurant_tables;
drop policy if exists restaurant_tables_select_staff_same_restaurant
  on public.restaurant_tables;

create policy restaurant_tables_select_staff_same_restaurant
on public.restaurant_tables
for select
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array[
      'owner',
      'manager',
      'cashier',
      'kitchen',
      'waiter',
      'reception',
      'inventory',
      'inventory_officer'
    ]::public.restaurant_staff_role[]
  )
);

revoke all on public.restaurant_tables from anon;
grant select on public.restaurant_tables to authenticated;
grant select, insert, update, delete on public.restaurant_tables to service_role;

-- The public menu historically returned qr_path for every active table. Since
-- qr_path contains the bearer token, retain only non-secret table presentation.
do $$
begin
  if to_regprocedure('public.get_public_qr_menu_phase260_base(text)') is null
    and to_regprocedure('public.get_public_qr_menu(text)') is not null
  then
    alter function public.get_public_qr_menu(text)
      rename to get_public_qr_menu_phase260_base;
  end if;
end;
$$;

revoke all on function public.get_public_qr_menu_phase260_base(text)
from public, anon, authenticated;
grant execute on function public.get_public_qr_menu_phase260_base(text)
to service_role;

create or replace function public.get_public_qr_menu(
  target_restaurant_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  payload jsonb;
  safe_tables jsonb;
begin
  payload := public.get_public_qr_menu_phase260_base(target_restaurant_slug);
  if payload is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(table_entry - 'qr_token' - 'qr_url' - 'qr_path'),
    '[]'::jsonb
  )
  into safe_tables
  from jsonb_array_elements(coalesce(payload->'tables', '[]'::jsonb)) table_entry;

  return jsonb_set(payload, '{tables}', safe_tables, true);
end;
$$;

revoke all on function public.get_public_qr_menu(text) from public;
grant execute on function public.get_public_qr_menu(text) to anon, authenticated;

comment on function public.get_public_qr_menu(text) is
  'Public menu projection. Table entries intentionally exclude QR bearer capabilities; legitimate scanned URLs supply their own token to guarded RPCs.';

-- The existing composite table FK used ON DELETE SET NULL for both key
-- columns. Removing a released table therefore attempted to erase the order's
-- tenant identity and re-entered table synchronization through the order bounds
-- trigger. Preserve restaurant_id and detach only the deleted immutable table
-- reference so historical orders survive a permitted count reduction.
alter table public.orders
  drop constraint if exists orders_table_same_restaurant,
  add constraint orders_table_same_restaurant
    foreign key (restaurant_id, table_id)
    references public.restaurant_tables (restaurant_id, id)
    on delete set null (table_id);

create or replace function public.sync_restaurant_tables_internal(
  target_restaurant_id uuid
)
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
  blocked_table_number integer;
begin
  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_restaurant_id::text));

  select slug, greatest(1, least(500, coalesce(table_count, total_tables, 20)))
  into restaurant_slug, bounded_total
  from public.restaurants
  where id = target_restaurant_id;

  if restaurant_slug is null then
    raise exception 'Restaurant not found.';
  end if;

  select tables.table_number
  into blocked_table_number
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant_id
    and tables.table_number > bounded_total
    and exists (
      select 1
      from public.orders sessions
      where sessions.restaurant_id = tables.restaurant_id
        and sessions.table_id = tables.id
        and sessions.dining_session_status = 'open'
        and sessions.table_released_at is null
    )
  order by tables.table_number
  limit 1;

  if blocked_table_number is not null then
    raise exception 'Cannot reduce restaurant to % tables because Table % has an open, unreleased dining session. Settle and release the table first.',
      bounded_total,
      blocked_table_number;
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
      public.build_public_order_path(restaurant_slug, table_no, existing_token),
      existing_token,
      public.build_public_order_url(restaurant_slug, table_no, existing_token),
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

  delete from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant_id
    and tables.table_number > bounded_total;
end;
$$;

revoke all on function public.sync_restaurant_tables_internal(uuid)
from public, anon, authenticated;
grant execute on function public.sync_restaurant_tables_internal(uuid)
to service_role;

create or replace function public.get_owner_table_qr_stats(
  target_restaurant_id uuid
)
returns table (
  table_id uuid,
  table_number integer,
  orders_today integer,
  last_scan_at timestamptz,
  last_order_at timestamptz,
  scan_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  restaurant_timezone text;
  today_start timestamptz;
  tomorrow_start timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view QR statistics.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not public.has_staff_role(
    target_restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  ) then
    raise exception 'Only restaurant owners may view QR statistics.';
  end if;

  select coalesce(nullif(btrim(restaurants.profile->>'timezone'), ''), 'Africa/Nairobi')
  into restaurant_timezone
  from public.restaurants restaurants
  where restaurants.id = target_restaurant_id;

  if restaurant_timezone is null then
    raise exception 'Restaurant not found.';
  end if;

  begin
    today_start := date_trunc('day', timezone(restaurant_timezone, now()))
      at time zone restaurant_timezone;
    tomorrow_start := (date_trunc('day', timezone(restaurant_timezone, now())) + interval '1 day')
      at time zone restaurant_timezone;
  exception
    when invalid_parameter_value then
      raise exception 'Restaurant timezone configuration is invalid.';
  end;

  return query
  select
    tables.id,
    tables.table_number,
    coalesce(count(distinct orders.id) filter (
      where orders.created_at >= today_start
        and orders.created_at < tomorrow_start
    ), 0)::integer,
    max(scans.scanned_at),
    max(orders.created_at),
    coalesce(count(distinct scans.id), 0)::integer
  from public.restaurant_tables tables
  left join public.orders orders
    on orders.restaurant_id = tables.restaurant_id
   and orders.table_id = tables.id
  left join public.restaurant_table_qr_scans scans
    on scans.restaurant_id = tables.restaurant_id
   and scans.table_id = tables.id
  where tables.restaurant_id = target_restaurant_id
  group by tables.id, tables.table_number
  order by tables.table_number;
end;
$$;

revoke all on function public.get_owner_table_qr_stats(uuid)
from public, anon;
grant execute on function public.get_owner_table_qr_stats(uuid)
to authenticated;

comment on function public.get_owner_table_qr_stats(uuid) is
  'Owner-only table activity. Orders Today and Last Order use immutable table_id; Today uses the restaurant profile timezone. Legacy orders without table_id are intentionally unattributed. Scan fields count only canonical logged scan events.';

create or replace function public.regenerate_all_restaurant_table_qr(
  target_restaurant_id uuid
)
returns setof public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.restaurant_staff;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to regenerate table QR codes.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  select staff.*
  into actor
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role = 'owner'
  limit 1;

  if actor.id is null then
    raise exception 'Only restaurant owners may manage table QR codes.';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_restaurant_id::text));

  with regenerated as (
    select tables.id, gen_random_uuid() as new_token
    from public.restaurant_tables tables
    where tables.restaurant_id = target_restaurant_id
  )
  update public.restaurant_tables tables
  set
    qr_token = regenerated.new_token,
    qr_path = public.build_public_order_path(restaurants.slug, tables.table_number, regenerated.new_token),
    qr_url = public.build_public_order_url(restaurants.slug, tables.table_number, regenerated.new_token),
    qr_regenerated_at = now(),
    updated_at = now()
  from public.restaurants restaurants,
       regenerated
  where restaurants.id = target_restaurant_id
    and tables.restaurant_id = restaurants.id
    and tables.id = regenerated.id;

  insert into public.staff_activity_log (
    restaurant_id,
    action,
    performed_by_staff_id,
    details
  )
  select
    tables.restaurant_id,
    'restaurant_table_qr_regenerated'::public.staff_activity_action,
    actor.id,
    jsonb_build_object(
      'table_id', tables.id,
      'table_number', tables.table_number,
      'bulk_action', true
    )
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant_id;

  return query
  select *
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant_id
  order by tables.table_number;
end;
$$;

revoke all on function public.regenerate_all_restaurant_table_qr(uuid)
from public, anon;
grant execute on function public.regenerate_all_restaurant_table_qr(uuid)
to authenticated;

create or replace function public.regenerate_restaurant_table_qr(
  target_restaurant_id uuid,
  target_table_id uuid
)
returns public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  target_table public.restaurant_tables;
  actor public.restaurant_staff;
  new_token uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to regenerate table QR codes.';
  end if;

  if target_restaurant_id is null or target_table_id is null then
    raise exception 'Restaurant and table are required.';
  end if;

  select staff.*
  into actor
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role = 'owner'
  limit 1;

  if actor.id is null then
    raise exception 'Only restaurant owners may manage table QR codes.';
  end if;

  update public.restaurant_tables tables
  set
    qr_token = new_token,
    qr_path = public.build_public_order_path(restaurants.slug, tables.table_number, new_token),
    qr_url = public.build_public_order_url(restaurants.slug, tables.table_number, new_token),
    qr_regenerated_at = now(),
    updated_at = now()
  from public.restaurants restaurants
  where tables.id = target_table_id
    and tables.restaurant_id = target_restaurant_id
    and restaurants.id = tables.restaurant_id
  returning tables.* into target_table;

  if target_table.id is null then
    raise exception 'Table not found.';
  end if;

  insert into public.staff_activity_log (
    restaurant_id,
    action,
    performed_by_staff_id,
    details
  ) values (
    target_restaurant_id,
    'restaurant_table_qr_regenerated'::public.staff_activity_action,
    actor.id,
    jsonb_build_object(
      'table_id', target_table.id,
      'table_number', target_table.table_number
    )
  );

  return target_table;
end;
$$;

revoke all on function public.regenerate_restaurant_table_qr(uuid, uuid)
from public, anon;
grant execute on function public.regenerate_restaurant_table_qr(uuid, uuid)
to authenticated;

create or replace function public.set_restaurant_table_active(
  target_restaurant_id uuid,
  target_table_id uuid,
  requested_active boolean
)
returns public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  target_table public.restaurant_tables;
  actor public.restaurant_staff;
  previous_active boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to manage table QR codes.';
  end if;

  if target_restaurant_id is null or target_table_id is null or requested_active is null then
    raise exception 'Restaurant, table, and active state are required.';
  end if;

  select staff.*
  into actor
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role = 'owner'
  limit 1;

  if actor.id is null then
    raise exception 'Only restaurant owners may manage table QR codes.';
  end if;

  select tables.active
  into previous_active
  from public.restaurant_tables tables
  where tables.id = target_table_id
    and tables.restaurant_id = target_restaurant_id
  for update;

  if previous_active is null then
    raise exception 'Table not found.';
  end if;

  update public.restaurant_tables tables
  set active = requested_active,
      updated_at = now()
  where tables.id = target_table_id
    and tables.restaurant_id = target_restaurant_id
  returning tables.* into target_table;

  if previous_active is distinct from requested_active then
    insert into public.staff_activity_log (
      restaurant_id,
      action,
      performed_by_staff_id,
      details
    ) values (
      target_restaurant_id,
      case when requested_active
        then 'restaurant_table_enabled'::public.staff_activity_action
        else 'restaurant_table_disabled'::public.staff_activity_action
      end,
      actor.id,
      jsonb_build_object(
        'table_id', target_table.id,
        'table_number', target_table.table_number,
        'previous_active', previous_active,
        'new_active', requested_active
      )
    );
  end if;

  return target_table;
end;
$$;

revoke all on function public.set_restaurant_table_active(uuid, uuid, boolean)
from public, anon;
grant execute on function public.set_restaurant_table_active(uuid, uuid, boolean)
to authenticated;
