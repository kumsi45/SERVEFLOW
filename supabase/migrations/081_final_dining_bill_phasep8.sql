-- ServeFlow Phase P8: final dining bill printing.
-- The final bill is generated from the dining session and all verified,
-- served batches in that session. Payment verification and ordering flows
-- are intentionally left unchanged.

create table if not exists public.dining_session_bill_counters (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.dining_session_bills (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  dining_session_id uuid not null references public.orders(id) on delete restrict,
  bill_number text not null,
  printed_by uuid references public.restaurant_staff(id) on delete set null,
  printed_at timestamptz not null default now(),
  print_count integer not null default 1 check (print_count > 0),
  pdf_path text,
  status text not null default 'printed' check (status in ('printed', 'voided')),
  subtotal numeric(12, 2) not null default 0,
  vat_amount numeric(12, 2) not null default 0,
  service_charge_amount numeric(12, 2) not null default 0,
  discount_amount numeric(12, 2) not null default 0,
  grand_total numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dining_session_bills_session_unique unique (restaurant_id, dining_session_id),
  constraint dining_session_bills_number_unique unique (restaurant_id, bill_number)
);

create index if not exists dining_session_bills_restaurant_printed_idx
on public.dining_session_bills (restaurant_id, printed_at desc);

alter table public.dining_session_bills enable row level security;
alter table public.dining_session_bill_counters enable row level security;

revoke all on public.dining_session_bills from public, anon, authenticated;
revoke all on public.dining_session_bill_counters from public, anon, authenticated;
grant select on public.dining_session_bills to authenticated;
grant select, insert, update on public.dining_session_bills to service_role;
grant select, insert, update on public.dining_session_bill_counters to service_role;

drop policy if exists dining_session_bills_select_staff_same_restaurant on public.dining_session_bills;
create policy dining_session_bills_select_staff_same_restaurant
on public.dining_session_bills
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff staff
    where staff.restaurant_id = dining_session_bills.restaurant_id
      and staff.user_id = auth.uid()
      and staff.active = true
      and staff.role::text in ('owner', 'manager', 'cashier')
  )
);

create or replace function public.print_final_dining_bill(
  target_dining_session_id uuid,
  target_format text default '80mm'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  target_restaurant public.restaurants;
  acting_staff public.restaurant_staff;
  existing_bill public.dining_session_bills;
  stored_bill public.dining_session_bills;
  next_number integer;
  bill_prefix text;
  normalized_format text := lower(coalesce(nullif(trim(target_format), ''), '80mm'));
  vat_rate numeric := 0.15;
  service_rate numeric := 0;
  verified_total numeric(12, 2) := 0;
  bill_service_charge_amount numeric(12, 2) := 0;
  bill_vat_amount numeric(12, 2) := 0;
  bill_subtotal_amount numeric(12, 2) := 0;
  bill_discount_amount numeric(12, 2) := 0;
  item_rows jsonb := '[]'::jsonb;
  payment_rows jsonb := '[]'::jsonb;
  item_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to print a final bill.';
  end if;

  if target_dining_session_id is null then
    raise exception 'Dining session is required.';
  end if;

  if normalized_format not in ('58mm', '80mm', 'a4', 'browser') then
    raise exception 'Unsupported bill print format.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_dining_session_id
  for update;

  if target_order.id is null then
    raise exception 'Dining session not found.';
  end if;

  select *
  into target_restaurant
  from public.restaurants
  where id = target_order.restaurant_id;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_order.restaurant_id
    and active = true
    and role::text in ('cashier', 'owner', 'manager')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers, managers, and owners may print final dining bills.';
  end if;

  if target_order.dining_session_status not in ('open', 'closed', 'checked_out') then
    raise exception 'Final bill can only be printed for an open or recently closed dining session.';
  end if;

  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.status in ('pending', 'paid', 'rejected')
  ) then
    raise exception 'Cannot print final bill while a payment batch is pending or unverified.';
  end if;

  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.status not in ('verified', 'cancelled', 'refunded')
  ) then
    raise exception 'Cannot print final bill until every payment batch is verified, cancelled, or refunded.';
  end if;

  if exists (
    select 1
    from public.order_items items
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and items.kitchen_status <> 'completed'
  ) then
    raise exception 'Cannot print final bill while kitchen items remain incomplete.';
  end if;

  select coalesce(sum(invoices.total_price), 0)::numeric(12, 2)
  into verified_total
  from public.order_invoices invoices
  where invoices.restaurant_id = target_order.restaurant_id
    and invoices.order_id = target_order.id
    and invoices.status = 'verified'
    and invoices.verified_at is not null;

  if verified_total <= 0 then
    raise exception 'Cannot print final bill because no verified payment batches were found.';
  end if;

  select coalesce(
    nullif(target_restaurant.ordering_settings->>'service_charge_percent', '')::numeric,
    0
  ) / 100
  into service_rate;
  service_rate := least(greatest(coalesce(service_rate, 0), 0), 0.30);

  bill_subtotal_amount := round((verified_total / (1 + vat_rate + service_rate))::numeric, 2);
  bill_service_charge_amount := round((bill_subtotal_amount * service_rate)::numeric, 2);
  bill_vat_amount := round((bill_subtotal_amount * vat_rate)::numeric, 2);
  bill_discount_amount := round((bill_subtotal_amount + bill_service_charge_amount + bill_vat_amount - verified_total)::numeric, 2);

  select count(*)
  into item_count
  from public.order_items items
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id
   and invoices.id = items.invoice_id
  where items.restaurant_id = target_order.restaurant_id
    and items.order_id = target_order.id
    and invoices.status = 'verified'
    and items.kitchen_status = 'completed';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', line_items.name,
        'quantity', line_items.quantity,
        'unit_price', line_items.unit_price,
        'total', line_items.total
      )
      order by line_items.first_created_at, line_items.name
    ),
    '[]'::jsonb
  )
  into item_rows
  from (
    select
      coalesce(menu_items.name, 'Menu item') as name,
      sum(items.quantity)::integer as quantity,
      items.price::numeric(12, 2) as unit_price,
      sum(items.quantity * items.price)::numeric(12, 2) as total,
      min(items.created_at) as first_created_at
    from public.order_items items
    join public.order_invoices invoices
      on invoices.restaurant_id = items.restaurant_id
     and invoices.id = items.invoice_id
    left join public.menu_items menu_items
      on menu_items.restaurant_id = items.restaurant_id
     and menu_items.id = items.menu_item_id
    where items.restaurant_id = target_order.restaurant_id
      and items.order_id = target_order.id
      and invoices.status = 'verified'
      and invoices.verified_at is not null
      and items.kitchen_status = 'completed'
    group by coalesce(menu_items.name, 'Menu item'), items.price
  ) line_items;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'method', payments.method,
        'amount', payments.amount
      )
      order by payments.method
    ),
    '[]'::jsonb
  )
  into payment_rows
  from (
    select
      coalesce(public.normalize_payment_method(invoices.payment_method), 'Other') as method,
      sum(invoices.total_price)::numeric(12, 2) as amount
    from public.order_invoices invoices
    where invoices.restaurant_id = target_order.restaurant_id
      and invoices.order_id = target_order.id
      and invoices.status = 'verified'
      and invoices.verified_at is not null
    group by coalesce(public.normalize_payment_method(invoices.payment_method), 'Other')
  ) payments;

  if item_count = 0 then
    raise exception 'Cannot print final bill because no served items were found.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_order.restaurant_id::text || ':final_bill', 0));

  select *
  into existing_bill
  from public.dining_session_bills bills
  where bills.restaurant_id = target_order.restaurant_id
    and bills.dining_session_id = target_order.id
  for update;

  if existing_bill.id is null then
    bill_prefix := upper(left(regexp_replace(coalesce(nullif(target_restaurant.slug, ''), target_restaurant.name, 'GR'), '[^a-zA-Z0-9]', '', 'g'), 2));
    if length(bill_prefix) < 2 then bill_prefix := 'GR'; end if;

    insert into public.dining_session_bill_counters (restaurant_id, last_number, updated_at)
    values (target_order.restaurant_id, 1, now())
    on conflict (restaurant_id) do update
      set last_number = public.dining_session_bill_counters.last_number + 1,
          updated_at = now()
    returning last_number into next_number;

    insert into public.dining_session_bills (
      restaurant_id,
      dining_session_id,
      bill_number,
      printed_by,
      printed_at,
      print_count,
      status,
      subtotal,
      vat_amount,
      service_charge_amount,
      discount_amount,
      grand_total
    )
    values (
      target_order.restaurant_id,
      target_order.id,
      bill_prefix || '-' || lpad(next_number::text, 6, '0'),
      acting_staff.id,
      now(),
      1,
      'printed',
      bill_subtotal_amount,
      bill_vat_amount,
      bill_service_charge_amount,
      bill_discount_amount,
      verified_total
    )
    on conflict (restaurant_id, dining_session_id) do update
      set printed_by = excluded.printed_by,
          printed_at = now(),
          print_count = public.dining_session_bills.print_count + 1,
          status = 'printed',
          updated_at = now()
    returning * into stored_bill;
  else
    update public.dining_session_bills
    set printed_by = acting_staff.id,
        printed_at = now(),
        print_count = print_count + 1,
        status = 'printed',
        subtotal = bill_subtotal_amount,
        vat_amount = bill_vat_amount,
        service_charge_amount = bill_service_charge_amount,
        discount_amount = bill_discount_amount,
        grand_total = verified_total,
        updated_at = now()
    where id = existing_bill.id
    returning * into stored_bill;
  end if;

  insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
  select
    target_order.restaurant_id,
    shifts.id,
    target_order.id,
    acting_staff.id,
    'final_bill_printed',
    'Final bill ' || stored_bill.bill_number || ' printed for table ' || coalesce(target_order.table_number, '-'),
    verified_total,
    jsonb_build_object(
      'bill_id', stored_bill.id,
      'bill_number', stored_bill.bill_number,
      'print_count', stored_bill.print_count,
      'format', normalized_format
    )
  from public.cashier_shifts shifts
  where shifts.restaurant_id = target_order.restaurant_id
    and shifts.opened_by = acting_staff.id
    and shifts.closed_at is null
  order by shifts.opened_at desc
  limit 1;

  return jsonb_build_object(
    'bill', jsonb_build_object(
      'id', stored_bill.id,
      'bill_number', stored_bill.bill_number,
      'receipt_number', stored_bill.bill_number,
      'dining_session_id', target_order.id,
      'dining_session_number', 'DS-' || upper(left(target_order.id::text, 8)),
      'table_number', target_order.table_number,
      'customer_name', target_order.customer_name,
      'waiter_name', (
        select staff.display_name
        from public.restaurant_staff staff
        where staff.restaurant_id = target_order.restaurant_id
          and staff.id = target_order.created_by_waiter_id
        limit 1
      ),
      'cashier_name', acting_staff.display_name,
      'printed_at', stored_bill.printed_at,
      'print_count', stored_bill.print_count,
      'format', normalized_format,
      'pdf_path', stored_bill.pdf_path,
      'status', stored_bill.status
    ),
    'restaurant', jsonb_build_object(
      'name', target_restaurant.name,
      'logo_url', target_restaurant.branding->>'logo_url',
      'tin_number', coalesce(target_restaurant.profile->>'tin_number', target_restaurant.profile->>'tin', ''),
      'vat_registration_number', coalesce(target_restaurant.profile->>'vat_registration_number', target_restaurant.profile->>'vat_number', ''),
      'phone', coalesce(target_restaurant.profile->>'phone', ''),
      'address', coalesce(target_restaurant.profile->>'address', ''),
      'website', coalesce(target_restaurant.profile->>'website', '')
    ),
    'items', item_rows,
    'totals', jsonb_build_object(
      'subtotal', bill_subtotal_amount,
      'vat_rate', vat_rate,
      'vat_amount', bill_vat_amount,
      'service_charge_rate', service_rate,
      'service_charge_amount', bill_service_charge_amount,
      'discount_amount', bill_discount_amount,
      'grand_total', verified_total
    ),
    'payments', payment_rows,
    'validation', jsonb_build_object(
      'ready_to_print', true,
      'served_item_count', item_count,
      'verified_invoice_total', verified_total
    )
  );
end;
$$;

revoke all on function public.print_final_dining_bill(uuid, text) from public, anon;
grant execute on function public.print_final_dining_bill(uuid, text) to authenticated, service_role;
