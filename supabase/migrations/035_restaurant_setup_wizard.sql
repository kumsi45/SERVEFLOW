-- Phase A: Restaurant Setup Wizard foundation.
-- Adds onboarding state without changing existing dashboard, ordering, or staff flows.

alter table public.restaurants
  add column if not exists setup_status jsonb not null default '{"completed": true, "legacy_completed": true}'::jsonb,
  add column if not exists kitchen_settings jsonb not null default '{}'::jsonb;

alter table public.restaurants
  alter column setup_status set default '{"completed": false}'::jsonb;

create or replace function public.complete_restaurant_setup(
  target_restaurant_id uuid,
  restaurant_info_payload jsonb,
  branding_payload jsonb,
  table_payload jsonb,
  business_hours_payload jsonb,
  kitchen_payload jsonb,
  staff_invitations_payload jsonb,
  should_generate_qr boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
  updated_restaurant public.restaurants;
  existing_table_count integer;
  requested_table_count integer;
  requested_table_count_text text;
  final_table_count integer;
  table_strategy text;
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

  table_strategy := coalesce(nullif(trim(table_payload->>'strategy'), ''), 'replace');
  if table_strategy not in ('keep_existing', 'replace') then
    raise exception 'Table setup strategy is invalid.';
  end if;

  requested_table_count_text := nullif(trim(coalesce(table_payload->>'table_count', '')), '');
  if requested_table_count_text is not null and requested_table_count_text !~ '^[0-9]+$' then
    raise exception 'Table count must be a whole number.';
  end if;

  requested_table_count := coalesce(requested_table_count_text::integer, target_restaurant.total_tables, target_restaurant.table_count, 20);
  requested_table_count := greatest(1, least(500, requested_table_count));

  select count(*)::integer
  into existing_table_count
  from public.restaurant_tables
  where restaurant_id = target_restaurant_id;

  if existing_table_count > 0 and table_strategy = 'keep_existing' then
    final_table_count := greatest(1, least(500, coalesce(target_restaurant.total_tables, target_restaurant.table_count, existing_table_count)));
  else
    final_table_count := requested_table_count;
  end if;

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
    'table_strategy', table_strategy,
    'qr_generated', coalesce(should_generate_qr, true),
    'staff_invitations', coalesce(staff_invitations_payload, '[]'::jsonb),
    'staff_invited_count', jsonb_array_length(coalesce(staff_invitations_payload, '[]'::jsonb)),
    'menu_status', 'not_started'
  );

  update public.restaurants
  set
    name = restaurant_name,
    total_tables = final_table_count,
    table_count = final_table_count,
    profile = normalized_profile,
    branding = normalized_branding,
    business_hours = normalized_business_hours,
    kitchen_settings = normalized_kitchen_settings,
    setup_status = normalized_setup_status
  where id = target_restaurant_id
    and (
      name,
      total_tables,
      table_count,
      profile,
      branding,
      business_hours,
      kitchen_settings,
      setup_status
    ) is distinct from (
      restaurant_name,
      final_table_count,
      final_table_count,
      normalized_profile,
      normalized_branding,
      normalized_business_hours,
      normalized_kitchen_settings,
      normalized_setup_status
    )
  returning * into updated_restaurant;

  if updated_restaurant.id is null then
    select *
    into updated_restaurant
    from public.restaurants
    where id = target_restaurant_id;
  end if;

  if coalesce(should_generate_qr, true) then
    perform public.sync_restaurant_tables(target_restaurant_id, final_table_count);
  end if;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', updated_restaurant.id,
      'name', updated_restaurant.name,
      'total_tables', updated_restaurant.total_tables,
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

revoke all on function public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.complete_restaurant_setup(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to authenticated;
