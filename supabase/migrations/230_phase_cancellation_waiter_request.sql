-- ServeFlow mastered cancellation Phase 1: waiter request-only cancellation.
-- This phase records cancellation requests and audit evidence only. It does not
-- mutate orders, order_items, invoices, kitchen state, refunds, or table release.

alter type public.staff_activity_action add value if not exists 'cancellation_requested';

create table if not exists public.order_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete restrict,
  request_scope text not null check (request_scope in ('order', 'item')),
  requested_by_staff_id uuid not null,
  requested_by_user_id uuid not null,
  requester_role text not null default 'waiter' check (requester_role = 'waiter'),
  reason text not null check (reason in (
    'Customer changed mind',
    'Wrong item entered',
    'Duplicate item',
    'Wrong table',
    'Item unavailable',
    'Customer requested different item',
    'Other'
  )),
  note text,
  requested_at timestamptz not null default now(),
  current_order_status text not null,
  current_kitchen_status text not null,
  current_payment_status text not null,
  status text not null default 'pending_review' check (status = 'pending_review'),
  metadata jsonb not null default '{}'::jsonb,
  constraint order_cancellation_requests_scope_item_check
    check (
      (request_scope = 'item' and order_item_id is not null)
      or (request_scope = 'order' and order_item_id is null)
    ),
  constraint order_cancellation_requests_note_check
    check (reason <> 'Other' or length(trim(coalesce(note, ''))) between 1 and 300),
  constraint order_cancellation_requests_order_same_restaurant
    foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id)
    on delete cascade,
  constraint order_cancellation_requests_item_same_restaurant
    foreign key (restaurant_id, order_item_id)
    references public.order_items (restaurant_id, id)
    on delete restrict,
  constraint order_cancellation_requests_requested_by_same_restaurant
    foreign key (restaurant_id, requested_by_staff_id)
    references public.restaurant_staff (restaurant_id, id)
    on delete restrict
);

create unique index if not exists order_cancellation_requests_pending_item_key
on public.order_cancellation_requests (restaurant_id, order_item_id)
where status = 'pending_review' and order_item_id is not null;

create unique index if not exists order_cancellation_requests_pending_order_key
on public.order_cancellation_requests (restaurant_id, order_id)
where status = 'pending_review' and order_item_id is null;

create index if not exists order_cancellation_requests_order_idx
on public.order_cancellation_requests (restaurant_id, order_id, requested_at desc);

alter table public.order_cancellation_requests enable row level security;

revoke all on public.order_cancellation_requests from anon, authenticated;
grant select on public.order_cancellation_requests to authenticated;
grant select, insert on public.order_cancellation_requests to service_role;

drop policy if exists order_cancellation_requests_select_authorized_staff on public.order_cancellation_requests;
create policy order_cancellation_requests_select_authorized_staff
on public.order_cancellation_requests
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner','manager','cashier']::public.restaurant_staff_role[])
  or exists (
    select 1
    from public.orders orders
    join public.restaurant_staff staff
      on staff.restaurant_id = orders.restaurant_id
     and staff.user_id = auth.uid()
     and staff.active
     and staff.role::text = 'waiter'
    where orders.restaurant_id = order_cancellation_requests.restaurant_id
      and orders.id = order_cancellation_requests.order_id
      and (
        orders.created_by_waiter_id = staff.id
        or exists (
          select 1
          from public.restaurant_table_waiter_assignments assignments
          left join public.restaurant_tables tables
            on tables.restaurant_id = assignments.restaurant_id
           and tables.id = assignments.table_id
          where assignments.restaurant_id = orders.restaurant_id
            and assignments.waiter_staff_id = staff.id
            and assignments.active
            and (
              (orders.table_id is not null and assignments.table_id = orders.table_id)
              or (orders.table_id is null and tables.table_number::text = trim(orders.table_number))
            )
        )
      )
  )
);

create or replace function public.request_waiter_cancellation(
  target_order_id uuid,
  target_order_item_id uuid default null,
  cancellation_reason text default null,
  cancellation_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  target_item public.order_items;
  acting_waiter public.restaurant_staff;
  table_label text;
  item_name text;
  normalized_reason text := nullif(trim(coalesce(cancellation_reason, '')), '');
  normalized_note text := nullif(left(trim(coalesce(cancellation_note, '')), 300), '');
  request_row public.order_cancellation_requests;
  kitchen_snapshot text;
  payment_snapshot text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to request cancellation.';
  end if;

  select * into target_order
  from public.orders orders
  where orders.id = target_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found.';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_order.restaurant_id::text || ':' || target_order.id::text || ':cancellation_request'));

  select * into acting_waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_order.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;

  if acting_waiter.id is null then
    raise exception 'Only an active waiter can request cancellation.';
  end if;

  if not (
    target_order.created_by_waiter_id = acting_waiter.id
    or exists (
      select 1
      from public.restaurant_table_waiter_assignments assignments
      left join public.restaurant_tables tables
        on tables.restaurant_id = assignments.restaurant_id
       and tables.id = assignments.table_id
      where assignments.restaurant_id = target_order.restaurant_id
        and assignments.waiter_staff_id = acting_waiter.id
        and assignments.active
        and (
          (target_order.table_id is not null and assignments.table_id = target_order.table_id)
          or (target_order.table_id is null and tables.table_number::text = trim(target_order.table_number))
        )
    )
  ) then
    raise exception 'Waiter is not authorized for this order.';
  end if;

  if target_order.dining_session_status <> 'open'
    or target_order.table_released_at is not null
    or target_order.status::text = 'cancelled'
    or coalesce(target_order.operational_status, '') in ('closed', 'cancelled')
  then
    raise exception 'This order is not eligible for cancellation review.';
  end if;

  if normalized_reason is null or normalized_reason not in (
    'Customer changed mind',
    'Wrong item entered',
    'Duplicate item',
    'Wrong table',
    'Item unavailable',
    'Customer requested different item',
    'Other'
  ) then
    raise exception 'Cancellation reason is required.';
  end if;

  if normalized_reason = 'Other' and normalized_note is null then
    raise exception 'A short explanation is required for Other.';
  end if;

  if target_order_item_id is not null then
    select * into target_item
    from public.order_items items
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and items.id = target_order_item_id
    for update;

    if target_item.id is null then
      raise exception 'Order item not found.';
    end if;

    if coalesce(target_item.kitchen_status, 'held') in ('completed', 'served', 'delivered', 'cancelled', 'voided') then
      raise exception 'This item is no longer eligible for cancellation review.';
    end if;

    if exists (
      select 1 from public.order_cancellation_requests existing
      where existing.restaurant_id = target_order.restaurant_id
        and existing.order_item_id = target_item.id
        and existing.status = 'pending_review'
    ) then
      raise exception 'Cancellation review is already requested for this item.';
    end if;

    kitchen_snapshot := coalesce(target_item.kitchen_status, 'held');
    select coalesce(invoices.payment_status, invoices.status::text, 'pending')
    into payment_snapshot
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.id = target_item.invoice_id
    limit 1;
  else
    if exists (
      select 1 from public.order_cancellation_requests existing
      where existing.restaurant_id = target_order.restaurant_id
        and existing.order_id = target_order.id
        and existing.order_item_id is null
        and existing.status = 'pending_review'
    ) then
      raise exception 'Cancellation review is already requested for this order.';
    end if;

    if not exists (
      select 1
      from public.order_items items
      where items.restaurant_id = target_order.restaurant_id
        and items.order_id = target_order.id
        and coalesce(items.kitchen_status, 'held') not in ('completed', 'served', 'delivered', 'cancelled', 'voided')
    ) then
      raise exception 'This order has no item eligible for cancellation review.';
    end if;

    select coalesce(
      case
        when count(*) = 0 then 'none'
        when count(distinct coalesce(items.kitchen_status, 'held')) = 1 then min(coalesce(items.kitchen_status, 'held'))
        else 'mixed'
      end,
      'none'
    )
    into kitchen_snapshot
    from public.order_items items
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id;

    select coalesce(
      case
        when count(*) = 0 then 'pending'
        when count(distinct coalesce(invoices.payment_status, invoices.status::text, 'pending')) = 1
          then min(coalesce(invoices.payment_status, invoices.status::text, 'pending'))
        else 'mixed'
      end,
      'pending'
    )
    into payment_snapshot
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id;
  end if;

  insert into public.order_cancellation_requests (
    restaurant_id,
    order_id,
    order_item_id,
    request_scope,
    requested_by_staff_id,
    requested_by_user_id,
    requester_role,
    reason,
    note,
    current_order_status,
    current_kitchen_status,
    current_payment_status,
    metadata
  )
  values (
    target_order.restaurant_id,
    target_order.id,
    target_order_item_id,
    case when target_order_item_id is null then 'order' else 'item' end,
    acting_waiter.id,
    auth.uid(),
    'waiter',
    normalized_reason,
    normalized_note,
    coalesce(nullif(target_order.operational_status, ''), target_order.status::text),
    coalesce(kitchen_snapshot, 'none'),
    coalesce(payment_snapshot, 'pending'),
    jsonb_build_object(
      'table_number', target_order.table_number,
      'table_id', target_order.table_id,
      'order_number', coalesce(target_order.display_number, target_order.id::text),
      'requested_by_name', acting_waiter.display_name
    )
  )
  returning * into request_row;

  select coalesce(tables.label, 'Table ' || coalesce(tables.table_number::text, target_order.table_number))
  into table_label
  from public.restaurant_tables tables
  where tables.restaurant_id = target_order.restaurant_id
    and (
      (target_order.table_id is not null and tables.id = target_order.table_id)
      or (target_order.table_id is null and tables.table_number::text = trim(target_order.table_number))
    )
  limit 1;

  if target_order_item_id is not null then
    select menu_items.name
    into item_name
    from public.order_items items
    join public.menu_items menu_items
      on menu_items.restaurant_id = items.restaurant_id
     and menu_items.id = items.menu_item_id
    where items.restaurant_id = target_order.restaurant_id
      and items.id = target_order_item_id
    limit 1;
  end if;

  perform public.log_staff_activity(
    target_order.restaurant_id,
    acting_waiter.id,
    'cancellation_requested',
    null,
    jsonb_build_object(
      'request_id', request_row.id,
      'order_id', target_order.id,
      'order_item_id', target_order_item_id,
      'scope', request_row.request_scope,
      'table', coalesce(table_label, 'Table ' || coalesce(target_order.table_number, '')),
      'item_name', item_name,
      'reason', normalized_reason,
      'note', normalized_note,
      'current_order_status', request_row.current_order_status,
      'current_kitchen_status', request_row.current_kitchen_status,
      'current_payment_status', request_row.current_payment_status,
      'status', request_row.status
    )
  );

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'requested_at', request_row.requested_at,
    'order_id', request_row.order_id,
    'order_item_id', request_row.order_item_id
  );
exception
  when unique_violation then
    raise exception 'Cancellation review is already requested.';
end;
$$;

revoke all on function public.request_waiter_cancellation(uuid, uuid, text, text) from public, anon;
grant execute on function public.request_waiter_cancellation(uuid, uuid, text, text) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'order_cancellation_requests'
    )
  then
    alter publication supabase_realtime add table public.order_cancellation_requests;
  end if;
end $$;

comment on table public.order_cancellation_requests is
  'Phase 1 waiter cancellation request ledger. Request-only: no financial, kitchen, item deletion, or table-release side effects.';

comment on function public.request_waiter_cancellation(uuid, uuid, text, text) is
  'Allows an authorized active waiter to request cancellation review for an order or item without approving or applying cancellation.';
