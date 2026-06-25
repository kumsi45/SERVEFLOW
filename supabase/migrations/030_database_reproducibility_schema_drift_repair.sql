-- SERVEFLOW database reproducibility and schema drift repair.
-- Removes live-only staff activity column drift, replaces the previously
-- live-only helper with a canonical non-blocking implementation, and validates
-- the public table-number constraint after confirming production data satisfies it.

drop function if exists public.log_staff_activity(uuid, uuid, text, uuid, jsonb);

alter table public.staff_activity_log
  drop column if exists actor_id,
  drop column if exists target_id,
  drop column if exists metadata;

create or replace function public.log_staff_activity(
  p_restaurant_id uuid,
  p_actor_id uuid,
  p_action text,
  p_target_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_action public.staff_activity_action;
  actor_staff_id uuid;
  target_staff_id uuid;
begin
  begin
    normalized_action := p_action::public.staff_activity_action;
  exception
    when invalid_text_representation then
      return;
  end;

  select id
  into actor_staff_id
  from public.restaurant_staff
  where id = p_actor_id
    and restaurant_id = p_restaurant_id
  limit 1;

  if p_target_id is not null then
    select id
    into target_staff_id
    from public.restaurant_staff
    where id = p_target_id
      and restaurant_id = p_restaurant_id
    limit 1;
  end if;

  insert into public.staff_activity_log (
    restaurant_id,
    action,
    performed_by_staff_id,
    target_staff_id,
    details
  )
  values (
    p_restaurant_id,
    normalized_action,
    actor_staff_id,
    target_staff_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
exception
  when others then
    raise warning 'Activity logging failed: %', sqlerrm;
end;
$$;

revoke all on function public.log_staff_activity(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.log_staff_activity(uuid, uuid, text, uuid, jsonb) to authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_table_number_positive_integer'
      and convalidated = false
  ) then
    alter table public.orders validate constraint orders_table_number_positive_integer;
  end if;
end;
$$;
