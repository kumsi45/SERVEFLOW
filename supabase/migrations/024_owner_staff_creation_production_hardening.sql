-- SERVEFLOW owner -> staff creation production hardening.
-- Makes owner bootstrap repair incomplete owner staff rows and tightens helper grants.

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

  if owner_name is null then
    owner_name := split_part(new.email, '@', 1);
  end if;

  select users.restaurant_id
  into existing_restaurant_id
  from public.users
  where users.id = new.id
    and users.restaurant_id is not null
  limit 1;

  if existing_restaurant_id is not null then
    insert into public.restaurant_staff (
      restaurant_id,
      user_id,
      role,
      display_name,
      email,
      active
    )
    values (
      existing_restaurant_id,
      new.id,
      'owner',
      owner_name,
      lower(new.email),
      true
    )
    on conflict (restaurant_id, user_id) do update
    set role = 'owner',
        display_name = coalesce(nullif(trim(excluded.display_name), ''), public.restaurant_staff.display_name),
        email = coalesce(excluded.email, public.restaurant_staff.email),
        active = true;

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

    update public.restaurant_staff
    set display_name = coalesce(owner_name, display_name),
        email = coalesce(lower(new.email), email),
        active = true
    where restaurant_id = existing_restaurant_id
      and user_id = new.id
      and role = 'owner';

    return new;
  end if;

  if restaurant_name is null then
    raise exception 'Restaurant name is required for owner signup.';
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
  on conflict (restaurant_id, user_id) do update
  set role = 'owner',
      display_name = coalesce(nullif(trim(excluded.display_name), ''), public.restaurant_staff.display_name),
      email = coalesce(excluded.email, public.restaurant_staff.email),
      active = true;

  return new;
end;
$$;

drop trigger if exists create_owner_restaurant_from_auth_signup on auth.users;

create trigger create_owner_restaurant_from_auth_signup
after insert on auth.users
for each row
execute function public.create_owner_restaurant_from_auth_signup();

-- Repair any legacy admin/owner user rows that are missing the authoritative
-- active owner membership used by staff dashboards and manage-staff.
insert into public.restaurant_staff (
  restaurant_id,
  user_id,
  role,
  display_name,
  email,
  active
)
select
  users.restaurant_id,
  users.id,
  'owner',
  coalesce(nullif(trim(auth_users.raw_user_meta_data->>'display_name'), ''), split_part(auth_users.email, '@', 1), 'Owner'),
  lower(auth_users.email),
  true
from public.users
join auth.users auth_users on auth_users.id = users.id
where users.role in ('admin', 'owner')
  and users.restaurant_id is not null
on conflict (restaurant_id, user_id) do update
set role = 'owner',
    display_name = coalesce(nullif(trim(excluded.display_name), ''), public.restaurant_staff.display_name),
    email = coalesce(excluded.email, public.restaurant_staff.email),
    active = true;

revoke all on function public.create_owner_restaurant_from_auth_signup() from public, anon, authenticated;
grant execute on function public.create_owner_restaurant_from_auth_signup() to service_role;

revoke all on function public.current_restaurant_staff_role(uuid) from public, anon;
revoke all on function public.has_staff_role(uuid, public.restaurant_staff_role[]) from public, anon;
revoke all on function public.is_active_restaurant_staff_member(uuid) from public, anon;
grant execute on function public.current_restaurant_staff_role(uuid) to authenticated, service_role;
grant execute on function public.has_staff_role(uuid, public.restaurant_staff_role[]) to authenticated, service_role;
grant execute on function public.is_active_restaurant_staff_member(uuid) to authenticated, service_role;

revoke delete, truncate, trigger, references on public.restaurant_staff from anon, authenticated;
