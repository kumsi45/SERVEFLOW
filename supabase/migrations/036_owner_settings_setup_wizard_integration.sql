-- Extends the existing owner settings update path to cover setup wizard fields.

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
  blocked_tables text;
begin
  select slug, greatest(1, least(500, coalesce(table_count, total_tables, 20)))
  into restaurant_slug, bounded_total
  from public.restaurants
  where id = target_restaurant_id;

  if restaurant_slug is null then
    raise exception 'Restaurant not found.';
  end if;

  select string_agg(distinct rt.table_number::text, ', ' order by rt.table_number::text)
  into blocked_tables
  from public.restaurant_tables rt
  where rt.restaurant_id = target_restaurant_id
    and rt.table_number > bounded_total
    and (
      exists (
        select 1
        from public.orders o
        where o.restaurant_id = target_restaurant_id
          and o.table_number = rt.table_number::text
      )
      or exists (
        select 1
        from public.restaurant_table_qr_scans qs
        where qs.restaurant_id = target_restaurant_id
          and qs.table_id = rt.id
      )
    );

  if blocked_tables is not null then
    raise exception 'Cannot reduce table count. Table(s) % have historical usage and cannot be deleted.', blocked_tables;
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

  delete from public.restaurant_tables
  where restaurant_id = target_restaurant_id
    and table_number > bounded_total;
end;
$$;

revoke all on function public.sync_restaurant_tables_internal(uuid) from public, anon, authenticated;
grant execute on function public.sync_restaurant_tables_internal(uuid) to service_role;

drop function if exists public.update_restaurant_configuration(uuid, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);

create or replace function public.update_restaurant_configuration(
  target_restaurant_id uuid,
  restaurant_name text,
  requested_total_tables integer,
  profile_payload jsonb,
  business_hours_payload jsonb,
  kitchen_settings_payload jsonb,
  ordering_settings_payload jsonb,
  branding_payload jsonb,
  notification_settings_payload jsonb,
  security_settings_payload jsonb
)
returns public.restaurants
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  updated_restaurant public.restaurants;
  normalized_business_hours jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to update settings.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may update settings.';
  end if;

  if restaurant_name is null or length(trim(restaurant_name)) < 2 then
    raise exception 'Restaurant name must be at least 2 characters.';
  end if;

  select *
  into target_restaurant
  from public.restaurants
  where id = target_restaurant_id;

  if target_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  normalized_business_hours :=
    coalesce(target_restaurant.business_hours, '{}'::jsonb)
    || coalesce(business_hours_payload, '{}'::jsonb)
    || jsonb_build_object(
      'opens_at', coalesce(nullif(business_hours_payload->>'opens_at', ''), target_restaurant.business_hours->>'opens_at', '08:00'),
      'closes_at', coalesce(nullif(business_hours_payload->>'closes_at', ''), target_restaurant.business_hours->>'closes_at', '22:00'),
      'closed_days', coalesce(business_hours_payload->'closed_days', target_restaurant.business_hours->'closed_days', '[]'::jsonb),
      'schedules', coalesce(
        business_hours_payload->'schedules',
        target_restaurant.business_hours->'schedules',
        jsonb_build_array(jsonb_build_object(
          'name', 'Default',
          'opens_at', coalesce(nullif(business_hours_payload->>'opens_at', ''), target_restaurant.business_hours->>'opens_at', '08:00'),
          'closes_at', coalesce(nullif(business_hours_payload->>'closes_at', ''), target_restaurant.business_hours->>'closes_at', '22:00'),
          'closed_days', coalesce(business_hours_payload->'closed_days', target_restaurant.business_hours->'closed_days', '[]'::jsonb)
        ))
      )
    );

  update public.restaurants
  set
    name = trim(restaurant_name),
    profile = coalesce(target_restaurant.profile, '{}'::jsonb) || coalesce(profile_payload, '{}'::jsonb),
    business_hours = normalized_business_hours,
    kitchen_settings = coalesce(target_restaurant.kitchen_settings, '{}'::jsonb) || coalesce(kitchen_settings_payload, '{}'::jsonb),
    ordering_settings = coalesce(target_restaurant.ordering_settings, '{}'::jsonb) || coalesce(ordering_settings_payload, '{}'::jsonb),
    branding = coalesce(target_restaurant.branding, '{}'::jsonb) || coalesce(branding_payload, '{}'::jsonb),
    notification_settings = coalesce(target_restaurant.notification_settings, '{}'::jsonb) || coalesce(notification_settings_payload, '{}'::jsonb),
    security_settings = coalesce(target_restaurant.security_settings, '{}'::jsonb) || coalesce(security_settings_payload, '{}'::jsonb)
  where id = target_restaurant_id
  returning * into updated_restaurant;

  perform public.sync_restaurant_tables(target_restaurant_id, requested_total_tables);

  select * into updated_restaurant
  from public.restaurants
  where id = target_restaurant_id;

  return updated_restaurant;
end;
$$;

revoke all on function public.update_restaurant_configuration(uuid, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_restaurant_configuration(uuid, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
