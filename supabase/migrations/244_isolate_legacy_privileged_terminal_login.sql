-- Keep the public restaurant terminal compatible with existing demo credentials,
-- while preventing newly created password-ready privileged accounts from being
-- listed or resolved through the legacy four-digit terminal flow.

create or replace function public.get_restaurant_terminal_staff(target_restaurant_slug text)
returns table(staff_id uuid, employee_id text, display_name text, staff_role text, shift_label text)
language sql stable security definer set search_path = public as $$
  select s.id, s.employee_id, s.display_name, s.role::text, s.shift_label
  from public.restaurant_staff s
  join public.restaurants r on r.id = s.restaurant_id
  where r.active
    and s.active
    and s.role::text in ('manager','waiter','cashier','kitchen')
    and (r.slug = lower(trim(target_restaurant_slug)) or r.id::text = lower(trim(target_restaurant_slug)))
    and (
      s.role::text = 'waiter'
      or exists (
        select 1
        from public.staff_credential_readiness readiness
        where readiness.restaurant_id = s.restaurant_id
          and readiness.staff_id = s.id
          and readiness.readiness in ('legacy_credential', 'reset_required')
      )
    )
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
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where r.active
      and s.active
      and s.role::text <> 'owner'
      and (r.slug = lower(trim(target_restaurant_slug)) or r.id::text = lower(trim(target_restaurant_slug)))
      and (target_role is null or s.role::text = target_role)
      and (
        s.role::text not in ('manager','cashier','kitchen')
        or exists (
          select 1
          from public.staff_credential_readiness readiness
          where readiness.restaurant_id = s.restaurant_id
            and readiness.staff_id = s.id
            and readiness.readiness in ('legacy_credential', 'reset_required')
        )
      )
      and (
        upper(s.employee_id) = upper(trim(target_employee_identity))
        or lower(s.display_name) = lower(trim(target_employee_identity))
        or lower(coalesce(s.username,'')) = lower(trim(target_employee_identity))
      )
  )
  select id,user_id,email,employee_id,display_name,role::text,restaurant_id,slug,restaurant_name,logo_url
  from candidates
  where upper(employee_id) = upper(trim(target_employee_identity)) or match_count = 1
  order by case when upper(employee_id) = upper(trim(target_employee_identity)) then 0 else 1 end
  limit 1
$$;

revoke all on function public.get_restaurant_terminal_staff(text) from public;
revoke all on function public.resolve_restaurant_staff_identity(text,text,text) from public;
grant execute on function public.get_restaurant_terminal_staff(text) to anon, authenticated;
grant execute on function public.resolve_restaurant_staff_identity(text,text,text) to anon, authenticated;

comment on function public.get_restaurant_terminal_staff(text) is
  'Public terminal directory. Privileged rows are limited to readiness-marked legacy demo credentials; waiters remain PIN-based.';
comment on function public.resolve_restaurant_staff_identity(text,text,text) is
  'Resolves tenant-scoped active staff identity while excluding password-ready privileged users from legacy terminal authentication.';
