-- Authoritative, assignment-safe waiter assistance resolution.
-- Historical requests are preserved; operational freshness is enforced by the
-- waiter query and requests are resolved only through the RPC below.

alter table public.waiter_assistance_requests
  add column if not exists resolved_by_staff_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'waiter_assistance_requests_resolver_same_restaurant'
      and conrelid = 'public.waiter_assistance_requests'::regclass
  ) then
    alter table public.waiter_assistance_requests
      add constraint waiter_assistance_requests_resolver_same_restaurant
      foreign key (restaurant_id, resolved_by_staff_id)
      references public.restaurant_staff(restaurant_id, id)
      on delete restrict;
  end if;
end;
$$;

drop policy if exists waiter_assistance_requests_staff_tenant
  on public.waiter_assistance_requests;
drop policy if exists waiter_assistance_requests_select_authorized_staff
  on public.waiter_assistance_requests;

create policy waiter_assistance_requests_select_authorized_staff
on public.waiter_assistance_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff staff
    where staff.restaurant_id = waiter_assistance_requests.restaurant_id
      and staff.user_id = auth.uid()
      and staff.active
      and (
        staff.role::text in ('manager', 'owner')
        or (
          staff.role::text = 'waiter'
          and exists (
            select 1
            from public.restaurant_table_waiter_assignments assignments
            where assignments.restaurant_id = waiter_assistance_requests.restaurant_id
              and assignments.table_id = waiter_assistance_requests.table_id
              and assignments.waiter_staff_id = staff.id
              and assignments.active
          )
        )
      )
  )
);

-- Waiters must not mutate assistance history directly. Managers/owners retain
-- tenant-safe read access; future manager mutations require their own RPC.
revoke update on public.waiter_assistance_requests from authenticated;
grant select on public.waiter_assistance_requests to authenticated;

create or replace function public.resolve_waiter_assistance_request(
  target_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_request public.waiter_assistance_requests;
  acting_waiter public.restaurant_staff;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into target_request
  from public.waiter_assistance_requests requests
  where requests.id = target_request_id
  for update;

  if target_request.id is null then
    raise exception 'Assistance request was not found.';
  end if;

  select *
  into acting_waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_request.restaurant_id
    and staff.user_id = auth.uid()
    and staff.role::text = 'waiter'
    and staff.active
  limit 1;

  if acting_waiter.id is null then
    raise exception 'Waiter is not authorized for this assistance request.';
  end if;

  if not exists (
    select 1
    from public.restaurant_table_waiter_assignments assignments
    where assignments.restaurant_id = target_request.restaurant_id
      and assignments.table_id = target_request.table_id
      and assignments.waiter_staff_id = acting_waiter.id
      and assignments.active
  ) then
    raise exception 'Waiter is not authorized for this assistance request.';
  end if;

  if target_request.status not in ('pending', 'acknowledged') then
    raise exception 'Assistance request is no longer active.';
  end if;

  update public.waiter_assistance_requests requests
  set status = 'resolved',
      resolved_at = clock_timestamp(),
      resolved_by_staff_id = acting_waiter.id,
      updated_at = clock_timestamp()
  where requests.id = target_request.id
  returning * into target_request;

  return jsonb_build_object(
    'request_id', target_request.id,
    'status', target_request.status,
    'resolved_at', target_request.resolved_at,
    'resolved_by_staff_id', target_request.resolved_by_staff_id
  );
end;
$$;

revoke all on function public.resolve_waiter_assistance_request(uuid)
from public, anon, authenticated;
grant execute on function public.resolve_waiter_assistance_request(uuid)
to authenticated, service_role;

comment on function public.resolve_waiter_assistance_request(uuid) is
  'Resolves an active assistance request only for the authenticated active waiter currently assigned to its table.';
