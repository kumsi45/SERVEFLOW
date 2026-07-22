-- SERVEFLOW Phase W2.7: human-facing employee identity.
-- Supabase auth user IDs and every historical staff UUID remain unchanged.

alter table public.restaurant_staff
  add column if not exists employee_id text,
  add column if not exists contact_email text,
  add column if not exists shift_label text;

create table if not exists public.restaurant_employee_id_counters (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role public.restaurant_staff_role not null,
  next_value bigint not null default 1 check (next_value > 0),
  primary key (restaurant_id, role)
);

alter table public.restaurant_employee_id_counters enable row level security;
revoke all on public.restaurant_employee_id_counters from public, anon, authenticated;

create or replace function public.staff_employee_prefix(target_role public.restaurant_staff_role)
returns text language sql immutable strict set search_path = public as $$
  select case target_role::text
    when 'waiter' then 'WT'
    when 'cashier' then 'CS'
    when 'kitchen' then 'KT'
    when 'manager' then 'MG'
    when 'reception' then 'RC'
    when 'inventory' then 'IN'
    else null
  end
$$;

create or replace function public.next_restaurant_employee_id(
  target_restaurant_id uuid,
  target_role public.restaurant_staff_role
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  prefix text;
  allocated bigint;
begin
  prefix := public.staff_employee_prefix(target_role);
  if prefix is null then
    raise exception 'This role does not use an employee ID.';
  end if;

  insert into public.restaurant_employee_id_counters(restaurant_id, role, next_value)
  values (target_restaurant_id, target_role, 2)
  on conflict (restaurant_id, role) do update
    set next_value = public.restaurant_employee_id_counters.next_value + 1
  returning next_value - 1 into allocated;

  return prefix || '-' || lpad(allocated::text, 5, '0');
end;
$$;

do $$
declare
  staff_row record;
  generated text;
begin
  for staff_row in
    select id, restaurant_id, role
    from public.restaurant_staff
    where role::text <> 'owner' and employee_id is null
    order by restaurant_id, role, created_at, id
  loop
    generated := public.next_restaurant_employee_id(staff_row.restaurant_id, staff_row.role);
    update public.restaurant_staff set employee_id = generated where id = staff_row.id;
  end loop;
end $$;

update public.restaurant_staff
set contact_email = email
where contact_email is null
  and email is not null
  and email not like '%@waiter.serveflow.local'
  and email not like '%@cashier.serveflow.local'
  and email not like '%@kitchen.serveflow.local'
  and email not like '%@manager.serveflow.local'
  and role::text <> 'owner';

create unique index if not exists restaurant_staff_employee_id_unique
  on public.restaurant_staff(restaurant_id, upper(employee_id))
  where employee_id is not null;

alter table public.restaurant_staff
  drop constraint if exists restaurant_staff_operational_employee_id_required;
alter table public.restaurant_staff
  add constraint restaurant_staff_operational_employee_id_required
  check (role::text = 'owner' or employee_id is not null) not valid;
alter table public.restaurant_staff validate constraint restaurant_staff_operational_employee_id_required;

create or replace function public.assign_restaurant_staff_employee_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role::text <> 'owner' and nullif(trim(new.employee_id), '') is null then
    new.employee_id := public.next_restaurant_employee_id(new.restaurant_id, new.role);
  end if;
  return new;
end;
$$;

drop trigger if exists assign_restaurant_staff_employee_id on public.restaurant_staff;
create trigger assign_restaurant_staff_employee_id
before insert on public.restaurant_staff
for each row execute function public.assign_restaurant_staff_employee_id();

create or replace function public.get_restaurant_terminal_staff(target_restaurant_slug text)
returns table(staff_id uuid, employee_id text, display_name text, staff_role text, shift_label text)
language sql stable security definer set search_path = public as $$
  select s.id, s.employee_id, s.display_name, s.role::text, s.shift_label
  from public.restaurant_staff s
  join public.restaurants r on r.id = s.restaurant_id
  where r.active and s.active and s.role::text in ('manager','waiter','cashier','kitchen')
    and (r.slug = lower(trim(target_restaurant_slug)) or r.id::text = lower(trim(target_restaurant_slug)))
  order by s.display_name, s.employee_id
$$;

create or replace function public.resolve_restaurant_staff_identity(
  target_restaurant_slug text,
  target_employee_identity text,
  target_role text default null
)
returns table(staff_id uuid, user_id uuid, auth_email text, employee_id text, display_name text,
  staff_role text, restaurant_id uuid, restaurant_slug text, restaurant_name text, logo_url text)
language sql stable security definer set search_path = public as $$
  with candidates as (
    select s.*, r.slug, r.name restaurant_name, r.branding->>'logo_url' logo_url,
      count(*) over () match_count
    from public.restaurant_staff s join public.restaurants r on r.id=s.restaurant_id
    where r.active and s.active and s.role::text <> 'owner'
      and (r.slug=lower(trim(target_restaurant_slug)) or r.id::text=lower(trim(target_restaurant_slug)))
      and (target_role is null or s.role::text=target_role)
      and (upper(s.employee_id)=upper(trim(target_employee_identity))
        or lower(s.display_name)=lower(trim(target_employee_identity))
        or lower(coalesce(s.username,''))=lower(trim(target_employee_identity)))
  )
  select id,user_id,email,employee_id,display_name,role::text,restaurant_id,slug,restaurant_name,logo_url
  from candidates
  where upper(employee_id)=upper(trim(target_employee_identity)) or match_count=1
  order by case when upper(employee_id)=upper(trim(target_employee_identity)) then 0 else 1 end
  limit 1
$$;

revoke all on function public.next_restaurant_employee_id(uuid, public.restaurant_staff_role) from public, anon, authenticated;
grant execute on function public.next_restaurant_employee_id(uuid, public.restaurant_staff_role) to service_role;
revoke all on function public.get_restaurant_terminal_staff(text) from public;
revoke all on function public.resolve_restaurant_staff_identity(text,text,text) from public;
grant execute on function public.get_restaurant_terminal_staff(text) to anon, authenticated;
grant execute on function public.resolve_restaurant_staff_identity(text,text,text) to anon, authenticated;

comment on column public.restaurant_staff.username is
  'Legacy internal login alias. Hidden from operational staff workflows after Phase W2.7.';
comment on column public.restaurant_staff.employee_id is
  'Stable restaurant-scoped human-facing employee identifier; never used as a historical foreign key.';
