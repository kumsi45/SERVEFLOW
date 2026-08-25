-- Serialize waiter PIN attempt admission per restaurant/source so concurrent
-- guesses cannot all pass a count-then-insert rate-limit race.

create or replace function public.reserve_waiter_pin_auth_attempt(
  target_restaurant_id uuid,
  target_scope_fingerprint text,
  target_window_seconds integer default 120,
  target_attempt_limit integer default 5
)
returns table (
  event_id bigint,
  allowed boolean,
  recent_failures integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  failure_count integer;
  reserved_event_id bigint;
  reservation_outcome text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Insufficient privilege.' using errcode = '42501';
  end if;

  if target_restaurant_id is null
     or target_scope_fingerprint !~ '^[0-9a-f]{64}$'
     or target_window_seconds < 1
     or target_window_seconds > 3600
     or target_attempt_limit < 1
     or target_attempt_limit > 100 then
    raise exception 'Invalid waiter PIN attempt reservation.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_restaurant_id::text || ':' || target_scope_fingerprint, 0)
  );

  select count(*)::integer
    into failure_count
  from public.waiter_pin_auth_events event
  where event.restaurant_id = target_restaurant_id
    and event.scope_fingerprint = target_scope_fingerprint
    and event.outcome in ('invalid', 'conflict', 'throttled')
    and event.created_at >= now() - make_interval(secs => target_window_seconds);

  reservation_outcome := case
    when failure_count >= target_attempt_limit then 'throttled'
    else 'invalid'
  end;

  insert into public.waiter_pin_auth_events (
    restaurant_id,
    scope_fingerprint,
    outcome
  ) values (
    target_restaurant_id,
    target_scope_fingerprint,
    reservation_outcome
  )
  returning id into reserved_event_id;

  return query select
    reserved_event_id,
    failure_count < target_attempt_limit,
    failure_count;
end;
$$;

revoke all on function public.reserve_waiter_pin_auth_attempt(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_waiter_pin_auth_attempt(uuid, text, integer, integer)
  to service_role;

comment on function public.reserve_waiter_pin_auth_attempt(uuid, text, integer, integer) is
  'Service-only atomic waiter PIN attempt reservation. Uses a transaction advisory lock to prevent concurrent rate-limit bypass and never accepts or returns PIN material.';
