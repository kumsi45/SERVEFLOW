-- Permanent application URL configuration for table QR generation.

create table if not exists public.application_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

alter table public.application_settings enable row level security;

revoke all on public.application_settings from public, anon;
grant select on public.application_settings to authenticated;
grant select, insert, update on public.application_settings to service_role;

drop policy if exists application_settings_select_owner on public.application_settings;
create policy application_settings_select_owner
on public.application_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff staff
    where staff.user_id = auth.uid()
      and staff.role = 'owner'
      and staff.active = true
  )
);

create or replace function public.normalize_app_url(requested_app_url text)
returns text
language plpgsql
immutable
as $$
declare
  raw_value text;
  normalized_value text;
begin
  raw_value := btrim(coalesce(requested_app_url, ''));

  if raw_value = '' then
    raise exception 'Application URL is required.';
  end if;

  normalized_value := regexp_replace(raw_value, '^(https?://[^/]+).*$'::text, '\1', 'i');
  normalized_value := regexp_replace(normalized_value, '/+$', '');

  if normalized_value !~* '^https?://[^[:space:]/]+(:[0-9]+)?$' then
    raise exception 'Application URL must start with http:// or https:// and include a host.';
  end if;

  return normalized_value;
end;
$$;

create or replace function public.get_app_url()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from public.application_settings where key = 'app_url'),
    'http://localhost:5173'
  );
$$;

create or replace function public.build_public_order_path(
  restaurant_slug text,
  table_number integer,
  qr_token uuid
)
returns text
language sql
immutable
as $$
  select '/r/' || restaurant_slug || '/order?t=' || table_number || '&qr=' || qr_token;
$$;

create or replace function public.build_public_order_url(
  restaurant_slug text,
  table_number integer,
  qr_token uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.get_app_url() || public.build_public_order_path(restaurant_slug, table_number, qr_token);
$$;

insert into public.application_settings (key, value)
values ('app_url', 'http://localhost:5173')
on conflict (key) do nothing;

create or replace function public.regenerate_all_restaurant_table_qr(target_restaurant_id uuid)
returns setof public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to regenerate table QR codes.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may manage table QR codes.';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_restaurant_id::text));

  update public.restaurant_tables tables
  set
    qr_path = public.build_public_order_path(restaurants.slug, tables.table_number, tables.qr_token),
    qr_url = public.build_public_order_url(restaurants.slug, tables.table_number, tables.qr_token),
    qr_regenerated_at = now(),
    updated_at = now()
  from public.restaurants restaurants
  where restaurants.id = target_restaurant_id
    and tables.restaurant_id = restaurants.id;

  return query
  select *
  from public.restaurant_tables
  where restaurant_id = target_restaurant_id
  order by table_number;
end;
$$;

create or replace function public.set_app_url(requested_app_url text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_url text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update the application URL.';
  end if;

  if not exists (
    select 1
    from public.restaurant_staff staff
    where staff.user_id = auth.uid()
      and staff.role = 'owner'
      and staff.active = true
  ) then
    raise exception 'Only restaurant owners may update the application URL.';
  end if;

  normalized_url := public.normalize_app_url(requested_app_url);

  insert into public.application_settings (key, value, updated_at, updated_by)
  values ('app_url', normalized_url, now(), auth.uid())
  on conflict (key) do update set
    value = excluded.value,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by;

  update public.restaurant_tables tables
  set
    qr_path = public.build_public_order_path(restaurants.slug, tables.table_number, tables.qr_token),
    qr_url = public.build_public_order_url(restaurants.slug, tables.table_number, tables.qr_token),
    qr_regenerated_at = now(),
    updated_at = now()
  from public.restaurants restaurants
  where tables.restaurant_id = restaurants.id;

  return normalized_url;
end;
$$;

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
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to regenerate table QR codes.';
  end if;

  if target_restaurant_id is null or target_table_id is null then
    raise exception 'Restaurant and table are required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may manage table QR codes.';
  end if;

  update public.restaurant_tables tables
  set
    qr_path = public.build_public_order_path(restaurants.slug, tables.table_number, tables.qr_token),
    qr_url = public.build_public_order_url(restaurants.slug, tables.table_number, tables.qr_token),
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

  return target_table;
end;
$$;

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
  blocked_table_number integer;
  blocked_table_status text;
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

  select rt.table_number, o.status::text
  into blocked_table_number, blocked_table_status
  from public.restaurant_tables rt
  join public.orders o
    on o.restaurant_id = target_restaurant_id
   and o.table_number = rt.table_number::text
   and o.status::text in ('pending', 'pending_payment', 'paid', 'preparing', 'ready')
  where rt.restaurant_id = target_restaurant_id
    and rt.table_number > bounded_total
  order by rt.table_number
  limit 1;

  if blocked_table_number is not null then
    raise exception 'Cannot reduce restaurant to % tables because Table % currently has an active order (%). Complete or close the order first.',
      bounded_total,
      blocked_table_number,
      blocked_table_status;
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

  delete from public.restaurant_tables
  where restaurant_id = target_restaurant_id
    and table_number > bounded_total;
end;
$$;

revoke all on function public.normalize_app_url(text) from public, anon, authenticated;
revoke all on function public.build_public_order_path(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.build_public_order_url(text, integer, uuid) from public, anon, authenticated;
revoke all on function public.sync_restaurant_tables_internal(uuid) from public, anon, authenticated;
grant execute on function public.sync_restaurant_tables_internal(uuid) to service_role;

revoke all on function public.get_app_url() from public;
grant execute on function public.get_app_url() to authenticated;

revoke all on function public.set_app_url(text) from public, anon;
grant execute on function public.set_app_url(text) to authenticated;

revoke all on function public.regenerate_all_restaurant_table_qr(uuid) from public, anon;
grant execute on function public.regenerate_all_restaurant_table_qr(uuid) to authenticated;

revoke all on function public.regenerate_restaurant_table_qr(uuid, uuid) from public, anon;
grant execute on function public.regenerate_restaurant_table_qr(uuid, uuid) to authenticated;
