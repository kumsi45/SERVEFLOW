-- SERVEFLOW Phase 5 owner signup bootstrap hardening.
-- Makes the auth.users trigger idempotent for duplicate execution and validates metadata casts.

create or replace function public.create_owner_restaurant_from_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  metadata jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  owner_name text := nullif(trim(metadata->>'display_name'), '');
  restaurant_name text := nullif(trim(metadata->>'restaurant_name'), '');
  requested_slug text := nullif(trim(metadata->>'restaurant_slug'), '');
  table_count_text text := nullif(trim(metadata->>'table_count'), '');
  base_slug text;
  candidate_slug text;
  suffix integer := 1;
  tables integer;
  new_restaurant_id uuid;
  existing_restaurant_id uuid;
begin
  if metadata->>'signup_kind' is distinct from 'owner' then
    return new;
  end if;

  select users.restaurant_id
  into existing_restaurant_id
  from public.users
  where users.id = new.id
    and users.restaurant_id is not null
  limit 1;

  if existing_restaurant_id is not null then
    return new;
  end if;

  select restaurant_staff.restaurant_id
  into existing_restaurant_id
  from public.restaurant_staff
  where restaurant_staff.user_id = new.id
    and restaurant_staff.role = 'owner'
  order by restaurant_staff.created_at
  limit 1;

  if existing_restaurant_id is not null then
    insert into public.users (id, restaurant_id, role)
    values (new.id, existing_restaurant_id, 'admin')
    on conflict (id) do update
    set restaurant_id = excluded.restaurant_id,
        role = excluded.role;

    return new;
  end if;

  if restaurant_name is null then
    raise exception 'Restaurant name is required for owner signup.';
  end if;

  if owner_name is null then
    owner_name := split_part(new.email, '@', 1);
  end if;

  if table_count_text is not null then
    if table_count_text !~ '^[0-9]+$' then
      raise exception 'Table count must be a whole number.';
    end if;

    tables := greatest(1, least(500, table_count_text::integer));
  end if;

  base_slug := public.slugify_restaurant_name(coalesce(requested_slug, restaurant_name));
  if base_slug = '' then
    base_slug := 'restaurant';
  end if;
  candidate_slug := base_slug;

  loop
    begin
      insert into public.restaurants (name, slug, table_count)
      values (restaurant_name, candidate_slug, tables)
      returning id into new_restaurant_id;
      exit;
    exception
      when unique_violation then
        suffix := suffix + 1;
        candidate_slug := base_slug || '-' || suffix::text;
    end;
  end loop;

  insert into public.users (id, restaurant_id, role)
  values (new.id, new_restaurant_id, 'admin')
  on conflict (id) do update
  set restaurant_id = excluded.restaurant_id,
      role = excluded.role;

  insert into public.restaurant_staff (
    restaurant_id,
    user_id,
    role,
    display_name,
    email,
    active
  )
  values (
    new_restaurant_id,
    new.id,
    'owner',
    owner_name,
    lower(new.email),
    true
  )
  on conflict (restaurant_id, user_id) do nothing;

  return new;
end;
$$;
