-- Centralize restaurant table row synchronization behind sync_restaurant_tables.
-- Owner settings must call this canonical RPC when configured table counts change.

alter type public.staff_activity_action add value if not exists 'tables_created';
alter type public.staff_activity_action add value if not exists 'tables_removed';
alter type public.staff_activity_action add value if not exists 'table_synchronization_performed';

do $$
begin
  if exists (
    select 1
    from public.restaurant_tables
    group by restaurant_id, table_number
    having count(*) > 1
  ) then
    raise exception 'Duplicate restaurant table numbers exist; clean duplicates before applying the safety constraint.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurant_tables_restaurant_id_table_number_key'
      and conrelid = 'public.restaurant_tables'::regclass
  ) then
    alter table public.restaurant_tables
      add constraint restaurant_tables_restaurant_id_table_number_key unique (restaurant_id, table_number);
  end if;
end;
$$;

revoke insert on public.restaurant_tables from authenticated;

drop trigger if exists sync_restaurant_tables_after_restaurant_write on public.restaurants;
drop function if exists public.sync_restaurant_tables_after_restaurant_write();

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

create or replace function public.sync_restaurant_tables(target_restaurant_id uuid, requested_total_tables integer)
returns setof public.restaurant_tables
language plpgsql
security definer
set search_path = public
as $$
declare
  bounded_total integer;
  previous_total integer;
  current_table_count integer;
  actor_staff_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to configure tables.';
  end if;

  if target_restaurant_id is null or requested_total_tables is null then
    raise exception 'Restaurant and table count are required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may configure tables.';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_restaurant_id::text));

  bounded_total := greatest(1, least(500, requested_total_tables));

  select greatest(1, least(500, coalesce(table_count, total_tables, 20)))
  into previous_total
  from public.restaurants
  where id = target_restaurant_id;

  if previous_total is null then
    raise exception 'Restaurant not found.';
  end if;

  select count(*)::integer
  into current_table_count
  from public.restaurant_tables
  where restaurant_id = target_restaurant_id;

  if previous_total = bounded_total and current_table_count = bounded_total then
    return query
    select *
    from public.restaurant_tables
    where restaurant_id = target_restaurant_id
      and active = true
    order by table_number;
    return;
  end if;

  update public.restaurants
  set total_tables = bounded_total,
      table_count = bounded_total
  where id = target_restaurant_id;

  perform public.sync_restaurant_tables_internal(target_restaurant_id);

  select id
  into actor_staff_id
  from public.restaurant_staff
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and active = true
  order by case when role = 'owner' then 0 else 1 end
  limit 1;

  if bounded_total > previous_total then
    insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
    values (
      target_restaurant_id,
      'tables_created'::public.staff_activity_action,
      actor_staff_id,
      jsonb_build_object('from', previous_total, 'to', bounded_total, 'created', bounded_total - previous_total)
    );
  elsif bounded_total < previous_total then
    insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
    values (
      target_restaurant_id,
      'tables_removed'::public.staff_activity_action,
      actor_staff_id,
      jsonb_build_object('from', previous_total, 'to', bounded_total, 'removed', previous_total - bounded_total)
    );
  end if;

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    'table_synchronization_performed'::public.staff_activity_action,
    actor_staff_id,
    jsonb_build_object('from', previous_total, 'to', bounded_total)
  );

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

drop function if exists public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean);

create or replace function public.complete_restaurant_setup(
  target_restaurant_id uuid,
  restaurant_info_payload jsonb,
  branding_payload jsonb,
  table_payload jsonb,
  business_hours_payload jsonb,
  kitchen_payload jsonb,
  staff_invitations_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  updated_restaurant public.restaurants;
  requested_table_count integer;
  requested_table_count_text text;
  restaurant_name text;
  restaurant_type text;
  currency text;
  timezone_name text;
  allowed_types text[] := array['Restaurant', 'Cafe', 'Fast Food', 'Bakery', 'Juice House', 'Hotel Restaurant', 'Bar'];
  normalized_branding jsonb;
  normalized_profile jsonb;
  normalized_business_hours jsonb;
  normalized_kitchen_settings jsonb;
  normalized_setup_status jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to complete setup.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may complete setup.';
  end if;

  select *
  into target_restaurant
  from public.restaurants
  where id = target_restaurant_id;

  if target_restaurant.id is null then
    raise exception 'Restaurant not found.';
  end if;

  restaurant_name := nullif(trim(coalesce(restaurant_info_payload->>'restaurant_name', target_restaurant.name)), '');
  restaurant_type := nullif(trim(coalesce(restaurant_info_payload->>'restaurant_type', '')), '');
  currency := nullif(trim(coalesce(restaurant_info_payload->>'currency', 'ETB')), '');
  timezone_name := nullif(trim(coalesce(restaurant_info_payload->>'timezone', 'Africa/Nairobi')), '');

  if restaurant_name is null or length(restaurant_name) < 2 then
    raise exception 'Restaurant name must be at least 2 characters.';
  end if;

  if restaurant_type is null or restaurant_type <> all(allowed_types) then
    raise exception 'Restaurant type is not supported.';
  end if;

  if currency is null or length(currency) < 2 or length(currency) > 8 then
    raise exception 'Currency is required.';
  end if;

  if timezone_name is null or length(timezone_name) < 2 or length(timezone_name) > 80 then
    raise exception 'Timezone is required.';
  end if;

  requested_table_count_text := nullif(trim(coalesce(table_payload->>'table_count', '')), '');
  if requested_table_count_text is not null and requested_table_count_text !~ '^[0-9]+$' then
    raise exception 'Table count must be a whole number.';
  end if;

  requested_table_count := coalesce(requested_table_count_text::integer, target_restaurant.table_count, target_restaurant.total_tables, 20);
  requested_table_count := greatest(1, least(500, requested_table_count));

  normalized_profile :=
    coalesce(target_restaurant.profile, '{}'::jsonb)
    || jsonb_build_object(
      'restaurant_type', restaurant_type,
      'currency', currency,
      'timezone', timezone_name,
      'phone', coalesce(restaurant_info_payload->>'phone', target_restaurant.profile->>'phone', ''),
      'address', coalesce(restaurant_info_payload->>'address', target_restaurant.profile->>'address', ''),
      'description', coalesce(restaurant_info_payload->>'description', target_restaurant.profile->>'description', ''),
      'tin_vat', coalesce(branding_payload->>'tin_vat', target_restaurant.profile->>'tin_vat', ''),
      'receipt_footer', coalesce(branding_payload->>'receipt_footer', target_restaurant.profile->>'receipt_footer', ''),
      'social_links', coalesce(branding_payload->'social_links', target_restaurant.profile->'social_links', '{}'::jsonb)
    );

  normalized_branding :=
    coalesce(target_restaurant.branding, '{}'::jsonb)
    || jsonb_build_object(
      'logo_url', coalesce(branding_payload->>'logo_url', target_restaurant.branding->>'logo_url', ''),
      'cover_url', coalesce(branding_payload->>'cover_url', target_restaurant.branding->>'cover_url', '')
    );

  normalized_business_hours := jsonb_build_object(
    'version', 1,
    'opens_at', coalesce(nullif(business_hours_payload->>'opens_at', ''), '08:00'),
    'closes_at', coalesce(nullif(business_hours_payload->>'closes_at', ''), '22:00'),
    'closed_days', coalesce(business_hours_payload->'closed_days', '[]'::jsonb),
    'schedules', jsonb_build_array(jsonb_build_object(
      'name', 'Default',
      'opens_at', coalesce(nullif(business_hours_payload->>'opens_at', ''), '08:00'),
      'closes_at', coalesce(nullif(business_hours_payload->>'closes_at', ''), '22:00'),
      'closed_days', coalesce(business_hours_payload->'closed_days', '[]'::jsonb)
    ))
  );

  normalized_kitchen_settings := jsonb_build_object(
    'mode', coalesce(nullif(kitchen_payload->>'mode', ''), 'single'),
    'skipped', coalesce((kitchen_payload->>'skipped')::boolean, false)
  );

  normalized_setup_status := jsonb_build_object(
    'completed', true,
    'completed_at', coalesce(target_restaurant.setup_status->'completed_at', to_jsonb(now())),
    'completed_by', coalesce(target_restaurant.setup_status->'completed_by', to_jsonb(auth.uid())),
    'version', 1,
    'qr_generated', true,
    'staff_invitations', coalesce(staff_invitations_payload, '[]'::jsonb),
    'staff_invited_count', jsonb_array_length(coalesce(staff_invitations_payload, '[]'::jsonb)),
    'menu_status', 'not_started'
  );

  update public.restaurants
  set
    name = restaurant_name,
    total_tables = requested_table_count,
    table_count = requested_table_count,
    profile = normalized_profile,
    branding = normalized_branding,
    business_hours = normalized_business_hours,
    kitchen_settings = normalized_kitchen_settings,
    setup_status = normalized_setup_status
  where id = target_restaurant_id
  returning * into updated_restaurant;

  perform public.sync_restaurant_tables(target_restaurant_id, requested_table_count);

  select *
  into updated_restaurant
  from public.restaurants
  where id = target_restaurant_id;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', updated_restaurant.id,
      'name', updated_restaurant.name,
      'total_tables', updated_restaurant.total_tables,
      'table_count', updated_restaurant.table_count,
      'profile', updated_restaurant.profile,
      'branding', updated_restaurant.branding,
      'business_hours', updated_restaurant.business_hours,
      'kitchen_settings', updated_restaurant.kitchen_settings,
      'setup_status', updated_restaurant.setup_status
    ),
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', rt.id,
        'table_number', rt.table_number,
        'label', rt.label,
        'qr_path', rt.qr_path,
        'qr_url', rt.qr_url,
        'active', rt.active
      ) order by rt.table_number), '[]'::jsonb)
      from public.restaurant_tables rt
      where rt.restaurant_id = target_restaurant_id
        and rt.active = true
    )
  );
end;
$$;

revoke all on function public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

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
  bounded_total integer;
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

  bounded_total := greatest(1, least(500, coalesce(requested_total_tables, target_restaurant.table_count, target_restaurant.total_tables, 20)));

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

  if bounded_total is distinct from greatest(1, least(500, coalesce(target_restaurant.table_count, target_restaurant.total_tables, 20))) then
    perform public.sync_restaurant_tables(target_restaurant_id, bounded_total);
  end if;

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

  return updated_restaurant;
end;
$$;

revoke all on function public.update_restaurant_configuration(uuid, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_restaurant_configuration(uuid, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.restaurants;
    exception
      when duplicate_object then null;
    end;

    begin
      alter publication supabase_realtime add table public.restaurant_tables;
    exception
      when duplicate_object then null;
    end;
  end if;
end;
$$;
