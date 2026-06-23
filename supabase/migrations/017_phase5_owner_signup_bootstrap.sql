-- SERVEFLOW Phase 5 owner signup bootstrap.
-- Creates the restaurant and first owner staff row from auth signup metadata.

alter table public.restaurants
  add column if not exists table_count integer check (table_count is null or (table_count >= 1 and table_count <= 500));

create or replace function public.slugify_restaurant_name(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, 'restaurant')), '[^a-z0-9]+', '-', 'g'))
$$;

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
  base_slug text;
  candidate_slug text;
  suffix integer := 1;
  tables integer;
  new_restaurant_id uuid;
begin
  if metadata->>'signup_kind' is distinct from 'owner' then
    return new;
  end if;

  if restaurant_name is null then
    raise exception 'Restaurant name is required for owner signup.';
  end if;

  if owner_name is null then
    owner_name := split_part(new.email, '@', 1);
  end if;

  if metadata ? 'table_count' and nullif(metadata->>'table_count', '') is not null then
    tables := greatest(1, least(500, (metadata->>'table_count')::integer));
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
  );

  return new;
end;
$$;

drop trigger if exists create_owner_restaurant_from_auth_signup on auth.users;

create trigger create_owner_restaurant_from_auth_signup
after insert on auth.users
for each row
execute function public.create_owner_restaurant_from_auth_signup();
