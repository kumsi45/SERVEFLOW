-- Canonical, atomic current-operation Waiter -> table responsibility.
-- Assignment changes never mutate dining sessions, orders, invoices, payments,
-- kitchen state, or historical waiter attribution on existing orders.

alter table public.restaurant_table_waiter_assignments
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by_staff_id uuid,
  add column if not exists assignment_version bigint not null default 1;

update public.restaurant_table_waiter_assignments
set ended_at = coalesce(ended_at, updated_at, assigned_at, now())
where not active and ended_at is null;

update public.restaurant_table_waiter_assignments
set ended_at = null, ended_by_staff_id = null
where active;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='waiter_table_assignments_table_tenant_fk') then
    alter table public.restaurant_table_waiter_assignments
      add constraint waiter_table_assignments_table_tenant_fk
      foreign key (restaurant_id, table_id)
      references public.restaurant_tables(restaurant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='waiter_table_assignments_waiter_tenant_fk') then
    alter table public.restaurant_table_waiter_assignments
      add constraint waiter_table_assignments_waiter_tenant_fk
      foreign key (restaurant_id, waiter_staff_id)
      references public.restaurant_staff(restaurant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='waiter_table_assignments_assigner_tenant_fk') then
    alter table public.restaurant_table_waiter_assignments
      add constraint waiter_table_assignments_assigner_tenant_fk
      foreign key (restaurant_id, assigned_by_staff_id)
      references public.restaurant_staff(restaurant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname='waiter_table_assignments_ender_tenant_fk') then
    alter table public.restaurant_table_waiter_assignments
      add constraint waiter_table_assignments_ender_tenant_fk
      foreign key (restaurant_id, ended_by_staff_id)
      references public.restaurant_staff(restaurant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname='waiter_table_assignments_lifecycle_check') then
    alter table public.restaurant_table_waiter_assignments
      add constraint waiter_table_assignments_lifecycle_check check (
        (active and ended_at is null and ended_by_staff_id is null)
        or (not active and ended_at is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname='waiter_table_assignments_version_check') then
    alter table public.restaurant_table_waiter_assignments
      add constraint waiter_table_assignments_version_check check (assignment_version > 0);
  end if;
end $$;

alter table public.restaurant_table_waiter_assignments enable row level security;
alter table public.restaurant_table_waiter_assignments force row level security;

drop policy if exists restaurant_table_waiter_assignments_select_staff_same_restaurant on public.restaurant_table_waiter_assignments;
drop policy if exists restaurant_table_waiter_assignments_manage_owner_same_restaurant on public.restaurant_table_waiter_assignments;
drop policy if exists restaurant_table_waiter_assignments_select_manager_same_restaurant on public.restaurant_table_waiter_assignments;

create policy restaurant_table_waiter_assignments_select_management_same_restaurant
on public.restaurant_table_waiter_assignments for select to authenticated
using (public.has_staff_role(restaurant_id, array['owner','manager']::public.restaurant_staff_role[]));

create policy restaurant_table_waiter_assignments_select_waiter_self
on public.restaurant_table_waiter_assignments for select to authenticated
using (
  restaurant_table_waiter_assignments.active
  and exists (
    select 1 from public.restaurant_staff staff
    where staff.restaurant_id = restaurant_table_waiter_assignments.restaurant_id
      and staff.id = restaurant_table_waiter_assignments.waiter_staff_id
      and staff.user_id = auth.uid()
      and staff.role::text = 'waiter'
      and staff.active
  )
);

revoke insert, update, delete on public.restaurant_table_waiter_assignments from authenticated;
grant select on public.restaurant_table_waiter_assignments to authenticated;

create or replace function public.assign_waiter_tables(
  target_restaurant_id uuid,
  target_waiter_staff_id uuid,
  target_table_ids uuid[]
)
returns table(table_id uuid, waiter_staff_id uuid, assigned_at timestamptz, assignment_version bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.restaurant_staff;
  target_waiter public.restaurant_staff;
  normalized_table_ids uuid[];
  location public.restaurant_tables;
  previous_waiter_id uuid;
  desired_waiter_id uuid;
  changed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;

  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id=target_restaurant_id and staff.user_id=auth.uid()
    and staff.active and staff.role::text in ('owner','manager')
  limit 1;
  if actor.id is null then raise exception 'Permission denied.'; end if;

  select * into target_waiter from public.restaurant_staff staff
  where staff.restaurant_id=target_restaurant_id and staff.id=target_waiter_staff_id
    and staff.active and staff.role::text='waiter'
  limit 1;
  if target_waiter.id is null then raise exception 'Active Waiter not found for this restaurant.'; end if;

  if target_table_ids is null then raise exception 'Table selection is required.'; end if;
  if array_position(target_table_ids, null) is not null then raise exception 'Table selection is invalid.'; end if;
  select coalesce(array_agg(distinct selected_id order by selected_id), '{}'::uuid[])
    into normalized_table_ids from unnest(target_table_ids) selected_id;
  if cardinality(normalized_table_ids) > 500 then raise exception 'Too many tables selected.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('waiter-table-assignment:'||target_restaurant_id::text,0));

  if (select count(*) from public.restaurant_tables tables
      where tables.restaurant_id=target_restaurant_id and tables.active and tables.id=any(normalized_table_ids))
     <> cardinality(normalized_table_ids) then
    raise exception 'All selected tables must be active restaurant tables.';
  end if;

  perform 1 from public.restaurant_tables tables
  where tables.restaurant_id=target_restaurant_id and tables.id=any(normalized_table_ids)
  order by tables.id for update;
  perform 1 from public.restaurant_table_waiter_assignments assignments
  where assignments.restaurant_id=target_restaurant_id and assignments.active
  order by assignments.table_id for update;

  for location in
    select tables.* from public.restaurant_tables tables
    where tables.restaurant_id=target_restaurant_id and tables.active
      and (tables.id=any(normalized_table_ids) or exists (
        select 1 from public.restaurant_table_waiter_assignments current_assignment
        where current_assignment.restaurant_id=target_restaurant_id
          and current_assignment.table_id=tables.id
          and current_assignment.waiter_staff_id=target_waiter_staff_id
          and current_assignment.active
      ))
    order by tables.id
  loop
    select assignments.waiter_staff_id into previous_waiter_id
    from public.restaurant_table_waiter_assignments assignments
    where assignments.restaurant_id=target_restaurant_id
      and assignments.table_id=location.id and assignments.active
    limit 1;
    desired_waiter_id := case when location.id=any(normalized_table_ids) then target_waiter_staff_id else null end;

    if previous_waiter_id is distinct from desired_waiter_id then
      update public.restaurant_table_waiter_assignments assignments
      set active=false, ended_at=changed_at, ended_by_staff_id=actor.id,
          assignment_version=assignments.assignment_version+1
      where assignments.restaurant_id=target_restaurant_id
        and assignments.table_id=location.id and assignments.active;

      if desired_waiter_id is not null then
        insert into public.restaurant_table_waiter_assignments(
          restaurant_id,table_id,waiter_staff_id,assigned_by_staff_id,active,
          assigned_at,ended_at,ended_by_staff_id,assignment_version
        ) values (
          target_restaurant_id,location.id,desired_waiter_id,actor.id,true,
          changed_at,null,null,1
        )
        on conflict on constraint restaurant_table_waiter_assig_restaurant_id_table_id_waiter_key
        do update set assigned_by_staff_id=excluded.assigned_by_staff_id,active=true,
          assigned_at=excluded.assigned_at,ended_at=null,ended_by_staff_id=null,
          assignment_version=restaurant_table_waiter_assignments.assignment_version+1;
      end if;

      insert into public.staff_activity_log(
        restaurant_id,action,performed_by_staff_id,target_staff_id,details
      ) values (
        target_restaurant_id,'waiter_tables_assigned',actor.id,coalesce(desired_waiter_id,previous_waiter_id),
        jsonb_build_object(
          'assignment_action',case when previous_waiter_id is null then 'assigned' when desired_waiter_id is null then 'unassigned' else 'reassigned' end,
          'table_id',location.id,'table_number',location.table_number,
          'previous_waiter_staff_id',previous_waiter_id,'new_waiter_staff_id',desired_waiter_id,
          'changed_by_staff_id',actor.id,'changed_at',changed_at
        )
      );
    end if;
  end loop;

  return query select assignments.table_id,assignments.waiter_staff_id,
    assignments.assigned_at,assignments.assignment_version
  from public.restaurant_table_waiter_assignments assignments
  where assignments.restaurant_id=target_restaurant_id
    and assignments.waiter_staff_id=target_waiter_staff_id and assignments.active
  order by assignments.table_id;
end;
$$;

create or replace function public.unassign_waiter_tables(
  target_restaurant_id uuid,
  target_table_ids uuid[]
)
returns table(table_id uuid, previous_waiter_staff_id uuid, unassigned_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare
  actor public.restaurant_staff;
  normalized_table_ids uuid[];
  location public.restaurant_tables;
  previous_waiter uuid;
  changed_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id=target_restaurant_id and staff.user_id=auth.uid()
    and staff.active and staff.role::text in ('owner','manager') limit 1;
  if actor.id is null then raise exception 'Permission denied.'; end if;
  if target_table_ids is null or array_position(target_table_ids,null) is not null then raise exception 'Table selection is invalid.'; end if;
  select coalesce(array_agg(distinct selected_id order by selected_id),'{}'::uuid[])
    into normalized_table_ids from unnest(target_table_ids) selected_id;
  if cardinality(normalized_table_ids)>500 then raise exception 'Too many tables selected.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('waiter-table-assignment:'||target_restaurant_id::text,0));
  if (select count(*) from public.restaurant_tables tables where tables.restaurant_id=target_restaurant_id and tables.active and tables.id=any(normalized_table_ids))<>cardinality(normalized_table_ids)
    then raise exception 'All selected tables must be active restaurant tables.'; end if;
  for location in select * from public.restaurant_tables tables
    where tables.restaurant_id=target_restaurant_id and tables.id=any(normalized_table_ids) order by tables.id for update
  loop
    select assignments.waiter_staff_id into previous_waiter from public.restaurant_table_waiter_assignments assignments
    where assignments.restaurant_id=target_restaurant_id and assignments.table_id=location.id and assignments.active limit 1;
    if previous_waiter is not null then
      update public.restaurant_table_waiter_assignments assignments
      set active=false,ended_at=changed_at,ended_by_staff_id=actor.id,assignment_version=assignments.assignment_version+1
      where assignments.restaurant_id=target_restaurant_id and assignments.table_id=location.id and assignments.active;
      insert into public.staff_activity_log(restaurant_id,action,performed_by_staff_id,target_staff_id,details)
      values(target_restaurant_id,'waiter_tables_assigned',actor.id,previous_waiter,
        jsonb_build_object('assignment_action','unassigned','table_id',location.id,'table_number',location.table_number,
          'previous_waiter_staff_id',previous_waiter,'new_waiter_staff_id',null,
          'changed_by_staff_id',actor.id,'changed_at',changed_at));
      table_id:=location.id; previous_waiter_staff_id:=previous_waiter; unassigned_at:=changed_at; return next;
    end if;
  end loop;
end;
$$;

create or replace function public.get_waiter_table_assignment_context(target_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.restaurant_staff; result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id=target_restaurant_id and staff.user_id=auth.uid()
    and staff.active and staff.role::text in ('owner','manager') limit 1;
  if actor.id is null then raise exception 'Permission denied.'; end if;
  select jsonb_build_object(
    'waiters',coalesce((select jsonb_agg(jsonb_build_object(
      'staff_id',staff.id,'display_name',staff.display_name,'active',staff.active,
      'assigned_table_count',(select count(*) from public.restaurant_table_waiter_assignments a where a.restaurant_id=target_restaurant_id and a.waiter_staff_id=staff.id and a.active)
    ) order by staff.display_name) from public.restaurant_staff staff
      where staff.restaurant_id=target_restaurant_id and staff.role::text='waiter' and staff.active),'[]'::jsonb),
    'tables',coalesce((select jsonb_agg(jsonb_build_object(
      'table_id',tables.id,'table_number',tables.table_number,'table_label',tables.label,
      'active',tables.active,'current_waiter_staff_id',assignment.waiter_staff_id,
      'current_waiter_name',waiter.display_name,'assignment_version',assignment.assignment_version,
      'occupancy_status',case when exists(select 1 from public.orders orders where orders.restaurant_id=target_restaurant_id and orders.table_id=tables.id and orders.dining_session_status='open' and orders.table_released_at is null) then 'occupied' else 'available' end
    ) order by tables.table_number) from public.restaurant_tables tables
      left join public.restaurant_table_waiter_assignments assignment on assignment.restaurant_id=tables.restaurant_id and assignment.table_id=tables.id and assignment.active
      left join public.restaurant_staff waiter on waiter.restaurant_id=assignment.restaurant_id and waiter.id=assignment.waiter_staff_id
      where tables.restaurant_id=target_restaurant_id and tables.active),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

-- Route the older single-customer Manager action through the same atomic
-- assignment engine while preserving its public signature and audit event.
create or replace function public.manager_assign_customer_waiter(
  target_restaurant_id uuid,
  target_order_id uuid,
  waiter_staff_id uuid
)
returns void language plpgsql security definer set search_path=public as $$
declare
  manager_staff_id uuid;
  target_order public.orders;
  desired_table_ids uuid[];
begin
  manager_staff_id:=public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;
  select * into target_order from public.orders orders
  where orders.id=target_order_id and orders.restaurant_id=target_restaurant_id
    and orders.dining_session_status='open' for update;
  if target_order.id is null then raise exception 'Customer session not found.'; end if;
  if target_order.table_id is null then raise exception 'This customer session is not attached to a table.'; end if;
  select coalesce(array_agg(assignments.table_id order by assignments.table_id),'{}'::uuid[])
    into desired_table_ids
  from public.restaurant_table_waiter_assignments assignments
  where assignments.restaurant_id=target_restaurant_id
    and assignments.waiter_staff_id=$3
    and assignments.active and assignments.table_id<>target_order.table_id;
  desired_table_ids:=array_append(desired_table_ids,target_order.table_id);
  perform public.assign_waiter_tables(target_restaurant_id,$3,desired_table_ids);
  insert into public.staff_activity_log(restaurant_id,action,performed_by_staff_id,target_staff_id,details)
  values(target_restaurant_id,'manager_waiter_assigned_to_customer',manager_staff_id,$3,
    jsonb_build_object('order_id',target_order.id,'table_id',target_order.table_id,
      'table_number',target_order.table_number,'timestamp',now()));
end;
$$;

revoke all on function public.assign_waiter_tables(uuid,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.unassign_waiter_tables(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.get_waiter_table_assignment_context(uuid) from public,anon,authenticated;
grant execute on function public.assign_waiter_tables(uuid,uuid,uuid[]) to authenticated;
grant execute on function public.unassign_waiter_tables(uuid,uuid[]) to authenticated;
grant execute on function public.get_waiter_table_assignment_context(uuid) to authenticated;

comment on function public.assign_waiter_tables(uuid,uuid,uuid[]) is
  'Atomically replaces one active Waiter current table responsibility set; serializes tenant assignment changes and preserves order/session/payment/kitchen state.';
comment on function public.unassign_waiter_tables(uuid,uuid[]) is
  'Atomically removes current Waiter responsibility from active same-tenant tables without releasing their dining sessions.';
comment on function public.get_waiter_table_assignment_context(uuid) is
  'Management-only tenant-scoped Waiter/table responsibility read model with occupancy derived independently from open dining sessions.';
