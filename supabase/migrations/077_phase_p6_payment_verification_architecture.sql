-- ServeFlow Phase P6: production payment verification architecture.
-- Dining sessions remain the existing active order/session record; each
-- order_invoices row is now the independent order batch/payment record.

alter table public.order_invoices
  add column if not exists reference_number text,
  add column if not exists transaction_id text,
  add column if not exists screenshot_url text,
  add column if not exists payment_recorded_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid,
  add column if not exists rejection_reason text,
  add column if not exists retry_requested_at timestamptz,
  add column if not exists retry_requested_by uuid,
  add column if not exists retry_note text,
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_by uuid,
  add column if not exists refund_reason text,
  add column if not exists duplicate_override_by uuid,
  add column if not exists duplicate_override_at timestamptz;

update public.order_invoices
set
  verified_at = coalesce(verified_at, paid_at),
  verified_by = coalesce(verified_by, paid_by),
  payment_recorded_at = coalesce(payment_recorded_at, paid_at, created_at)
where status = 'paid';

alter table public.order_invoices
  drop constraint if exists order_invoices_status_allowed,
  add constraint order_invoices_status_allowed
    check (status in ('pending', 'paid', 'verified', 'rejected', 'cancelled', 'refunded'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_invoices_verified_by_same_restaurant'
      and conrelid = 'public.order_invoices'::regclass
  ) then
    alter table public.order_invoices
      add constraint order_invoices_verified_by_same_restaurant
      foreign key (restaurant_id, verified_by)
      references public.restaurant_staff (restaurant_id, id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_invoices_rejected_by_same_restaurant'
      and conrelid = 'public.order_invoices'::regclass
  ) then
    alter table public.order_invoices
      add constraint order_invoices_rejected_by_same_restaurant
      foreign key (restaurant_id, rejected_by)
      references public.restaurant_staff (restaurant_id, id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_invoices_retry_requested_by_same_restaurant'
      and conrelid = 'public.order_invoices'::regclass
  ) then
    alter table public.order_invoices
      add constraint order_invoices_retry_requested_by_same_restaurant
      foreign key (restaurant_id, retry_requested_by)
      references public.restaurant_staff (restaurant_id, id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_invoices_refunded_by_same_restaurant'
      and conrelid = 'public.order_invoices'::regclass
  ) then
    alter table public.order_invoices
      add constraint order_invoices_refunded_by_same_restaurant
      foreign key (restaurant_id, refunded_by)
      references public.restaurant_staff (restaurant_id, id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_invoices_duplicate_override_by_same_restaurant'
      and conrelid = 'public.order_invoices'::regclass
  ) then
    alter table public.order_invoices
      add constraint order_invoices_duplicate_override_by_same_restaurant
      foreign key (restaurant_id, duplicate_override_by)
      references public.restaurant_staff (restaurant_id, id)
      on delete set null;
  end if;
end;
$$;

create index if not exists order_invoices_payment_queue_idx
on public.order_invoices (restaurant_id, status, created_at desc);

create index if not exists order_invoices_verified_revenue_idx
on public.order_invoices (restaurant_id, verified_at desc)
where status in ('paid', 'verified');

create index if not exists order_invoices_reference_lookup_idx
on public.order_invoices (restaurant_id, lower(reference_number))
where reference_number is not null and status in ('paid', 'verified');

create index if not exists order_invoices_transaction_lookup_idx
on public.order_invoices (restaurant_id, lower(transaction_id))
where transaction_id is not null and status in ('paid', 'verified');

with duplicate_references as (
  select
    id,
    row_number() over (
      partition by restaurant_id, lower(reference_number)
      order by verified_at nulls last, paid_at nulls last, created_at, id
    ) as duplicate_position
  from public.order_invoices
  where reference_number is not null
    and status in ('paid', 'verified')
)
update public.order_invoices invoices
set
  duplicate_override_by = coalesce(invoices.duplicate_override_by, invoices.verified_by, invoices.paid_by),
  duplicate_override_at = coalesce(invoices.duplicate_override_at, invoices.verified_at, invoices.paid_at, now())
from duplicate_references duplicates
where duplicates.id = invoices.id
  and duplicates.duplicate_position > 1
  and invoices.duplicate_override_at is null;

with duplicate_transactions as (
  select
    id,
    row_number() over (
      partition by restaurant_id, lower(transaction_id)
      order by verified_at nulls last, paid_at nulls last, created_at, id
    ) as duplicate_position
  from public.order_invoices
  where transaction_id is not null
    and status in ('paid', 'verified')
)
update public.order_invoices invoices
set
  duplicate_override_by = coalesce(invoices.duplicate_override_by, invoices.verified_by, invoices.paid_by),
  duplicate_override_at = coalesce(invoices.duplicate_override_at, invoices.verified_at, invoices.paid_at, now())
from duplicate_transactions duplicates
where duplicates.id = invoices.id
  and duplicates.duplicate_position > 1
  and invoices.duplicate_override_at is null;

create unique index if not exists order_invoices_reference_verified_unique_idx
on public.order_invoices (restaurant_id, lower(reference_number))
where reference_number is not null and status in ('paid', 'verified') and duplicate_override_at is null;

create unique index if not exists order_invoices_transaction_verified_unique_idx
on public.order_invoices (restaurant_id, lower(transaction_id))
where transaction_id is not null and status in ('paid', 'verified') and duplicate_override_at is null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-screenshots',
  'payment-screenshots',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists payment_screenshots_select_staff_same_restaurant on storage.objects;
drop policy if exists payment_screenshots_insert_cashier_owner_same_restaurant on storage.objects;
drop policy if exists payment_screenshots_update_cashier_owner_same_restaurant on storage.objects;
drop policy if exists payment_screenshots_delete_owner_same_restaurant on storage.objects;

create policy payment_screenshots_select_staff_same_restaurant
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-screenshots'
  and array_length(storage.foldername(name), 1) >= 1
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.has_staff_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'cashier']::public.restaurant_staff_role[]
  )
);

create policy payment_screenshots_insert_cashier_owner_same_restaurant
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-screenshots'
  and array_length(storage.foldername(name), 1) >= 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.has_staff_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'cashier']::public.restaurant_staff_role[]
  )
);

create policy payment_screenshots_update_cashier_owner_same_restaurant
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payment-screenshots'
  and array_length(storage.foldername(name), 1) >= 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.has_staff_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'cashier']::public.restaurant_staff_role[]
  )
)
with check (
  bucket_id = 'payment-screenshots'
  and array_length(storage.foldername(name), 1) >= 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.has_staff_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'cashier']::public.restaurant_staff_role[]
  )
);

create policy payment_screenshots_delete_owner_same_restaurant
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payment-screenshots'
  and array_length(storage.foldername(name), 1) >= 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.has_staff_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner']::public.restaurant_staff_role[]
  )
);

create table if not exists public.receipt_generation_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null,
  invoice_id uuid not null,
  event_type text not null default 'payment_verified',
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (restaurant_id, invoice_id),
  constraint receipt_generation_events_order_same_restaurant
    foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id)
    on delete cascade,
  constraint receipt_generation_events_invoice_same_restaurant
    foreign key (restaurant_id, invoice_id)
    references public.order_invoices (restaurant_id, id)
    on delete cascade,
  constraint receipt_generation_events_status_allowed
    check (status in ('pending', 'processing', 'processed', 'failed'))
);

alter table public.receipt_generation_events enable row level security;

revoke all on public.receipt_generation_events from anon, authenticated;
grant select on public.receipt_generation_events to authenticated;

drop policy if exists receipt_generation_events_select_staff_same_restaurant on public.receipt_generation_events;
create policy receipt_generation_events_select_staff_same_restaurant
on public.receipt_generation_events
for select
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['owner', 'cashier', 'kitchen']::public.restaurant_staff_role[]
  )
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'receipt_generation_events'
     ) then
    alter publication supabase_realtime add table public.receipt_generation_events;
  end if;
end;
$$;

create or replace function public.normalize_payment_method(payment_method text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(trim(payment_method), '') is null then null
    when lower(trim(payment_method)) in ('credit/debit card', 'debit card', 'credit card', 'card') then 'Card'
    when lower(trim(payment_method)) = 'telebirr' then 'Telebirr'
    when lower(trim(payment_method)) = 'cbe birr' then 'CBE Birr'
    when lower(trim(payment_method)) = 'chapa' then 'Chapa'
    when lower(trim(payment_method)) = 'cash' then 'Cash'
    else trim(payment_method)
  end
$$;

create or replace function public.payment_method_is_supported(payment_method text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.normalize_payment_method(payment_method) in ('Cash', 'Telebirr', 'CBE Birr', 'Card', 'Chapa')
$$;

create or replace function public.create_cashier_order(
  target_restaurant_id uuid,
  table_number text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_total_tables integer;
  created_order public.orders;
  created_invoice public.order_invoices;
  requested_count integer;
  computed_total numeric(12, 2);
  normalized_table_number_text text;
  normalized_table_number integer;
  normalized_payment_method text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to create cashier orders.';
  end if;

  if target_restaurant_id is null then
    raise exception 'Restaurant is required.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may create cashier orders.';
  end if;

  normalized_table_number_text := nullif(trim(table_number), '');
  normalized_payment_method := coalesce(public.normalize_payment_method(selected_payment_method), 'Cash');

  if normalized_table_number_text is null then
    raise exception 'Table number is required.';
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  select r.total_tables
  into target_total_tables
  from public.restaurants r
  where r.id = target_restaurant_id
  limit 1;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = target_restaurant_id
      and rt.table_number = normalized_table_number
      and rt.active = true
  ) then
    raise exception 'Invalid table number. Please select a table between 1 and %.', coalesce(target_total_tables, 20);
  end if;

  if not public.payment_method_is_supported(normalized_payment_method) then
    raise exception 'Payment method is not supported.';
  end if;

  if requested_items is null or jsonb_typeof(requested_items) is distinct from 'array' then
    raise exception 'Order items must be an array.';
  end if;

  requested_count := jsonb_array_length(requested_items);
  if requested_count < 1 then raise exception 'Order must include at least one item.'; end if;
  if requested_count > 50 then raise exception 'Order cannot include more than 50 line items.'; end if;

  with normalized_items as (
    select
      case when line_item ? 'menu_item_id'
        and (line_item->>'menu_item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (line_item->>'menu_item_id')::uuid else null end as menu_item_id,
      case when line_item ? 'quantity' and (line_item->>'quantity') ~ '^[0-9]+$'
        then (line_item->>'quantity')::integer else null end as quantity
    from jsonb_array_elements(requested_items) as line_item
  ),
  invalid_items as (
    select 1 from normalized_items
    where menu_item_id is null or quantity is null or quantity < 1 or quantity > 99
  ),
  valid_items as (
    select normalized_items.menu_item_id, normalized_items.quantity, menu_items.price
    from normalized_items
    join public.menu_items
      on menu_items.id = normalized_items.menu_item_id
     and menu_items.restaurant_id = target_restaurant_id
     and menu_items.available = true
  )
  select sum(valid_items.price * valid_items.quantity)::numeric(12, 2)
  into computed_total
  from valid_items
  where not exists (select 1 from invalid_items)
    and (select count(*) from valid_items) = requested_count;

  if computed_total is null then
    raise exception 'Order contains invalid or unavailable menu items.';
  end if;

  insert into public.orders (
    restaurant_id, customer_user_id, status, total_price, customer_name,
    table_number, payment_method, order_source
  )
  values (
    target_restaurant_id, null, 'pending_payment', computed_total, null,
    normalized_table_number::text, normalized_payment_method, 'cashier'
  )
  returning * into created_order;

  insert into public.order_invoices (
    restaurant_id, order_id, invoice_number, status, total_price, payment_method
  )
  values (
    target_restaurant_id, created_order.id, 1, 'pending', computed_total, normalized_payment_method
  )
  returning * into created_invoice;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, kitchen_status)
  select
    target_restaurant_id,
    created_order.id,
    created_invoice.id,
    menu_items.id,
    normalized_items.quantity,
    menu_items.price,
    nullif(left(trim(coalesce(normalized_items.notes, '')), 500), ''),
    'held'
  from (
    select
      (line_item->>'menu_item_id')::uuid as menu_item_id,
      (line_item->>'quantity')::integer as quantity,
      line_item->>'notes' as notes
    from jsonb_array_elements(requested_items) as line_item
  ) normalized_items
  join public.menu_items
    on menu_items.id = normalized_items.menu_item_id
   and menu_items.restaurant_id = target_restaurant_id
   and menu_items.available = true;

  return jsonb_build_object(
    'order_id', created_order.id,
    'invoice_id', created_invoice.id,
    'invoice_number', created_invoice.invoice_number,
    'invoice_status', created_invoice.status,
    'status', created_order.status,
    'total_price', created_order.total_price,
    'invoice_total', created_invoice.total_price,
    'table_number', created_order.table_number,
    'payment_method', coalesce(public.normalize_payment_method(created_invoice.payment_method), public.normalize_payment_method(created_order.payment_method)),
    'order_source', created_order.order_source,
    'created_at', created_order.created_at
  );
end;
$$;

drop function if exists public.verify_order_payment(uuid, text, text, text);

create or replace function public.verify_order_payment(
  target_invoice_id uuid,
  payment_reference_number text default null,
  payment_transaction_id text default null,
  payment_screenshot_url text default null,
  owner_duplicate_override boolean default false
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_user_id uuid := auth.uid();
  acting_staff public.restaurant_staff;
  target_invoice public.order_invoices;
  target_order public.orders;
  updated_order public.orders;
  active_shift_id uuid;
  normalized_reference text;
  normalized_transaction_id text;
  normalized_screenshot_path text;
  normalized_payment_method text;
begin
  if caller_user_id is null then
    raise exception 'Authentication is required to verify payment.';
  end if;

  select *
  into target_invoice
  from public.order_invoices
  where id = target_invoice_id
  for update;

  if target_invoice.id is null then
    raise exception 'Payment batch not found.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_invoice.order_id
    and restaurant_id = target_invoice.restaurant_id
  for update;

  if target_order.id is null then
    raise exception 'Dining session not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = caller_user_id
    and restaurant_id = target_invoice.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may verify payment.';
  end if;

  normalized_reference := nullif(left(trim(coalesce(payment_reference_number, '')), 120), '');
  normalized_transaction_id := nullif(left(trim(coalesce(payment_transaction_id, '')), 120), '');
  normalized_screenshot_path := nullif(left(trim(coalesce(payment_screenshot_url, '')), 500), '');
  normalized_payment_method := public.normalize_payment_method(coalesce(target_invoice.payment_method, target_order.payment_method));

  if target_invoice.status not in ('pending', 'paid') then
    raise exception 'Only pending or paid payments may be verified.';
  end if;

  if normalized_payment_method is null or not public.payment_method_is_supported(normalized_payment_method) then
    raise exception 'A supported payment method is required before verification.';
  end if;

  if owner_duplicate_override and acting_staff.role <> 'owner' then
    raise exception 'Only owners may override duplicate transaction references.';
  end if;

  if normalized_screenshot_path is not null and (
    normalized_screenshot_path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
    or split_part(normalized_screenshot_path, '/', 1)::uuid <> target_invoice.restaurant_id
    or normalized_screenshot_path !~* '\.(jpg|jpeg|png|webp|gif)$'
  ) then
    raise exception 'Payment screenshot must be an image stored under this restaurant.';
  end if;

  if normalized_reference is not null
     and not owner_duplicate_override
     and exists (
       select 1
       from public.order_invoices existing
       where existing.restaurant_id = target_invoice.restaurant_id
         and existing.id <> target_invoice.id
         and existing.status in ('paid', 'verified')
         and lower(existing.reference_number) = lower(normalized_reference)
     ) then
    raise exception 'Duplicate transaction reference for this restaurant. Owner override is required.';
  end if;

  if normalized_transaction_id is not null
     and not owner_duplicate_override
     and exists (
       select 1
       from public.order_invoices existing
       where existing.restaurant_id = target_invoice.restaurant_id
         and existing.id <> target_invoice.id
         and existing.status in ('paid', 'verified')
         and lower(existing.transaction_id) = lower(normalized_transaction_id)
     ) then
    raise exception 'Duplicate transaction ID for this restaurant. Owner override is required.';
  end if;

  update public.order_invoices
  set
    status = 'verified',
    paid_at = coalesce(paid_at, now()),
    paid_by = coalesce(paid_by, acting_staff.id),
    locked_at = now(),
    payment_recorded_at = coalesce(payment_recorded_at, now()),
    verified_at = now(),
    verified_by = acting_staff.id,
    payment_method = normalized_payment_method,
    reference_number = normalized_reference,
    transaction_id = normalized_transaction_id,
    screenshot_url = normalized_screenshot_path,
    duplicate_override_by = case when owner_duplicate_override then acting_staff.id else null end,
    duplicate_override_at = case when owner_duplicate_override then now() else null end,
    rejected_at = null,
    rejected_by = null,
    rejection_reason = null,
    retry_requested_at = null,
    retry_requested_by = null,
    retry_note = null,
    updated_at = now()
  where id = target_invoice.id
    and restaurant_id = target_invoice.restaurant_id
    and status in ('pending', 'paid')
  returning * into target_invoice;

  insert into public.receipt_generation_events (restaurant_id, order_id, invoice_id, event_type, status, payload)
  values (
    target_invoice.restaurant_id,
    target_invoice.order_id,
    target_invoice.id,
    'payment_verified',
    'pending',
    jsonb_build_object(
      'invoice_id', target_invoice.id,
      'invoice_number', target_invoice.invoice_number,
      'payment_method', normalized_payment_method,
      'verified_at', target_invoice.verified_at,
      'verified_by', target_invoice.verified_by,
      'total_price', target_invoice.total_price
    )
  )
  on conflict (restaurant_id, invoice_id) do nothing;

  update public.order_items items
  set kitchen_status = 'paid'
  where items.restaurant_id = target_invoice.restaurant_id
    and items.invoice_id = target_invoice.id
    and items.kitchen_status = 'held';

  update public.orders
  set
    payment_verified_at = coalesce(payment_verified_at, target_invoice.verified_at),
    payment_verified_by = coalesce(payment_verified_by, acting_staff.id),
    payment_method = coalesce(payment_method, normalized_payment_method),
    updated_at = now()
  where id = target_order.id
    and restaurant_id = target_order.restaurant_id;

  updated_order := public.derive_order_status_from_items(target_order.id, acting_staff.id);

  select cs.id
  into active_shift_id
  from public.cashier_shifts cs
  where cs.restaurant_id = target_order.restaurant_id
    and cs.opened_by = acting_staff.id
    and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  if active_shift_id is null then
    select cs.id
    into active_shift_id
    from public.cashier_shifts cs
    where cs.restaurant_id = target_order.restaurant_id
      and cs.closed_at is null
    order by cs.opened_at desc
    limit 1;
  end if;

  insert into public.shift_activity_logs (restaurant_id, shift_id, order_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_order.restaurant_id,
    active_shift_id,
    target_order.id,
    acting_staff.id,
    'payment_verified',
    'Invoice #' || target_invoice.invoice_number || ' payment verified for table ' || coalesce(target_order.table_number, '-'),
    target_invoice.total_price,
    jsonb_build_object(
      'invoice_id', target_invoice.id,
      'invoice_number', target_invoice.invoice_number,
      'payment_method', normalized_payment_method,
      'reference_number', target_invoice.reference_number,
      'transaction_id', target_invoice.transaction_id,
      'table_number', target_order.table_number,
      'staff_id', acting_staff.id
    )
  );

  if to_regprocedure('public.log_staff_activity(uuid, uuid, text, uuid, jsonb)') is not null then
    perform public.log_staff_activity(
      target_order.restaurant_id,
      caller_user_id,
      'verify_payment',
      target_order.id,
      jsonb_build_object(
        'invoice_id', target_invoice.id,
        'invoice_number', target_invoice.invoice_number,
        'invoice_total', target_invoice.total_price,
        'payment_method', normalized_payment_method,
        'reference_number', target_invoice.reference_number,
        'transaction_id', target_invoice.transaction_id,
        'table_number', updated_order.table_number,
        'staff_id', acting_staff.id
      )
    );
  end if;

  return updated_order;
end;
$$;

create or replace function public.approve_order_payment(target_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_invoice_id uuid;
begin
  select invoices.id
  into target_invoice_id
  from public.order_invoices invoices
  where invoices.order_id = target_order_id
    and invoices.status in ('pending', 'paid')
  order by invoices.invoice_number desc
  limit 1;

  if target_invoice_id is null then
    raise exception 'No pending or paid invoice was found for this order.';
  end if;

  return public.verify_order_payment(target_invoice_id, null, null, null, false);
end;
$$;

create or replace function public.find_payment_reference(
  target_restaurant_id uuid,
  search_reference text
)
returns table (
  invoice_id uuid,
  order_id uuid,
  invoice_number integer,
  reference_number text,
  transaction_id text,
  payment_method text,
  total_price numeric,
  verified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_query text := lower(nullif(trim(coalesce(search_reference, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to search payment references.';
  end if;

  if normalized_query is null then
    raise exception 'Transaction reference is required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner', 'cashier']::public.restaurant_staff_role[]) then
    raise exception 'Only active cashiers and owners may search payment references.';
  end if;

  return query
  select
    invoices.id,
    invoices.order_id,
    invoices.invoice_number,
    invoices.reference_number,
    invoices.transaction_id,
    coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(orders.payment_method)) as payment_method,
    invoices.total_price,
    invoices.verified_at
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  where invoices.restaurant_id = target_restaurant_id
    and invoices.status in ('paid', 'verified')
    and (
      lower(coalesce(invoices.reference_number, '')) = normalized_query
      or lower(coalesce(invoices.transaction_id, '')) = normalized_query
    )
  order by invoices.verified_at desc nulls last
  limit 20;
end;
$$;

create or replace function public.reject_order_payment(
  target_invoice_id uuid,
  rejection_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_invoice public.order_invoices;
  target_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to reject payment.';
  end if;

  select *
  into target_invoice
  from public.order_invoices
  where id = target_invoice_id
  for update;

  if target_invoice.id is null then
    raise exception 'Payment batch not found.';
  end if;

  select *
  into target_order
  from public.orders
  where id = target_invoice.order_id
    and restaurant_id = target_invoice.restaurant_id
  for update;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_invoice.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may reject payment.';
  end if;

  if target_invoice.status not in ('pending', 'paid') then
    raise exception 'Only pending or paid payments may be rejected.';
  end if;

  update public.order_invoices
  set
    status = 'rejected',
    rejected_at = now(),
    rejected_by = acting_staff.id,
    rejection_reason = nullif(left(trim(coalesce(rejection_note, '')), 500), ''),
    updated_at = now()
  where id = target_invoice.id
    and restaurant_id = target_invoice.restaurant_id
  returning * into target_invoice;

  perform public.derive_order_status_from_items(target_order.id, acting_staff.id);

  return jsonb_build_object(
    'invoice_id', target_invoice.id,
    'invoice_status', target_invoice.status,
    'order_id', target_invoice.order_id
  );
end;
$$;

create or replace function public.request_order_payment_retry(
  target_invoice_id uuid,
  retry_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_invoice public.order_invoices;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to request payment retry.';
  end if;

  select *
  into target_invoice
  from public.order_invoices
  where id = target_invoice_id
  for update;

  if target_invoice.id is null then
    raise exception 'Payment batch not found.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_invoice.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may request payment retry.';
  end if;

  if target_invoice.status not in ('pending', 'rejected') then
    raise exception 'Only pending or rejected payments may be retried.';
  end if;

  update public.order_invoices
  set
    status = 'pending',
    rejected_at = null,
    rejected_by = null,
    rejection_reason = null,
    retry_requested_at = now(),
    retry_requested_by = acting_staff.id,
    retry_note = nullif(left(trim(coalesce(retry_note, '')), 500), ''),
    updated_at = now()
  where id = target_invoice.id
    and restaurant_id = target_invoice.restaurant_id
  returning * into target_invoice;

  return jsonb_build_object(
    'invoice_id', target_invoice.id,
    'invoice_status', target_invoice.status,
    'retry_requested_at', target_invoice.retry_requested_at
  );
end;
$$;

drop function if exists public.get_cashier_invoice_queue(uuid);

create or replace function public.get_cashier_invoice_queue(target_restaurant_id uuid)
returns table (
  invoice_id uuid,
  invoice_number integer,
  invoice_status text,
  invoice_paid_at timestamptz,
  invoice_locked_at timestamptz,
  invoice_verified_at timestamptz,
  invoice_verified_by uuid,
  invoice_verified_by_name text,
  invoice_rejected_at timestamptz,
  invoice_rejection_reason text,
  invoice_retry_requested_at timestamptz,
  reference_number text,
  transaction_id text,
  screenshot_url text,
  dining_session_id uuid,
  dining_session_status text,
  order_batch_id uuid,
  id uuid,
  status text,
  customer_name text,
  customer_phone text,
  table_number text,
  order_source text,
  waiter_name text,
  order_note text,
  payment_method text,
  total_price numeric,
  order_total_price numeric,
  created_at timestamptz,
  payment_verified_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  today_start timestamptz := date_trunc('day', now());
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view cashier payments.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers and owners may view payment queue.';
  end if;

  return query
  select
    invoices.id as invoice_id,
    invoices.invoice_number,
    case
      when invoices.status = 'verified' or (invoices.status = 'paid' and invoices.verified_at is not null) then 'verified'
      else invoices.status
    end as invoice_status,
    invoices.paid_at as invoice_paid_at,
    invoices.locked_at as invoice_locked_at,
    invoices.verified_at as invoice_verified_at,
    invoices.verified_by as invoice_verified_by,
    verifier.display_name as invoice_verified_by_name,
    invoices.rejected_at as invoice_rejected_at,
    invoices.rejection_reason as invoice_rejection_reason,
    invoices.retry_requested_at as invoice_retry_requested_at,
    invoices.reference_number,
    invoices.transaction_id,
    invoices.screenshot_url,
    orders.id as dining_session_id,
    orders.dining_session_status::text as dining_session_status,
    invoices.id as order_batch_id,
    orders.id,
    orders.status::text as status,
    orders.customer_name,
    orders.customer_phone,
    orders.table_number,
    orders.order_source,
    waiter_staff.display_name as waiter_name,
    orders.order_note,
    coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(orders.payment_method)) as payment_method,
    invoices.total_price,
    orders.total_price as order_total_price,
    invoices.created_at,
    invoices.verified_at as payment_verified_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', items.id,
          'order_id', items.order_id,
          'invoice_id', items.invoice_id,
          'quantity', items.quantity,
          'price', items.price,
          'notes', items.notes,
          'appended_at', items.appended_at,
          'kitchen_status', items.kitchen_status,
          'menu_item_name', menu_items.name
        )
        order by items.created_at, items.id
      ) filter (where items.id is not null),
      '[]'::jsonb
    ) as items
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  left join public.restaurant_staff waiter_staff
    on waiter_staff.restaurant_id = orders.restaurant_id
   and waiter_staff.id = orders.created_by_waiter_id
  left join public.restaurant_staff verifier
    on verifier.restaurant_id = invoices.restaurant_id
   and verifier.id = invoices.verified_by
  left join public.order_items items
    on items.restaurant_id = invoices.restaurant_id
   and items.invoice_id = invoices.id
  left join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  where invoices.restaurant_id = target_restaurant_id
    and invoices.created_at >= today_start
    and orders.status::text <> 'cancelled'
  group by invoices.id, orders.id, waiter_staff.display_name, verifier.display_name
  order by invoices.created_at desc;
end;
$$;

create or replace function public.get_cashier_shift_summary(target_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  active_shift public.cashier_shifts;
  cash_total numeric(12, 2) := 0;
  digital_total numeric(12, 2) := 0;
  orders_processed integer := 0;
  payments_processed integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view shift status.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_restaurant_id
    and active = true
    and role::text in ('cashier', 'owner', 'manager')
  limit 1;

  if acting_staff.id is null then
    raise exception 'Only active cashiers, managers, and owners may view shift status.';
  end if;

  if acting_staff.role = 'cashier' then
    select *
    into active_shift
    from public.cashier_shifts
    where restaurant_id = target_restaurant_id
      and opened_by = acting_staff.id
      and closed_at is null
    order by opened_at desc
    limit 1;
  end if;

  if active_shift.id is not null then
    select
      coalesce(sum(invoices.total_price) filter (
        where coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(orders.payment_method)) = 'Cash'
      ), 0),
      coalesce(sum(invoices.total_price) filter (
        where coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(orders.payment_method)) <> 'Cash'
      ), 0),
      count(distinct invoices.order_id),
      count(invoices.id)
    into cash_total, digital_total, orders_processed, payments_processed
    from public.order_invoices invoices
    join public.orders orders
      on orders.restaurant_id = invoices.restaurant_id
     and orders.id = invoices.order_id
    where invoices.restaurant_id = target_restaurant_id
      and invoices.status in ('paid', 'verified')
      and invoices.verified_by = active_shift.opened_by
      and invoices.verified_at >= active_shift.opened_at
      and invoices.verified_at <= now();
  end if;

  return jsonb_build_object(
    'staff_id', acting_staff.id,
    'active_shift', case when active_shift.id is null then null else jsonb_build_object(
      'id', active_shift.id,
      'restaurant_id', active_shift.restaurant_id,
      'opened_by', active_shift.opened_by,
      'opened_at', active_shift.opened_at,
      'opening_cash', active_shift.opening_cash,
      'notes', active_shift.notes,
      'cash_collected', cash_total,
      'digital_collected', digital_total,
      'orders_processed', orders_processed,
      'payments_processed', payments_processed,
      'expected_cash', active_shift.opening_cash + cash_total
    ) end
  );
end;
$$;

create or replace function public.close_cashier_shift(
  target_shift_id uuid,
  actual_cash_amount numeric,
  variance_explanation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_staff public.restaurant_staff;
  target_shift public.cashier_shifts;
  cash_payments numeric(12, 2) := 0;
  cash_refunds numeric(12, 2) := 0;
  expected_drawer numeric(12, 2);
  variance_amount numeric(12, 2);
  unpaid_payments integer := 0;
  active_orders integer := 0;
  reconciliation_row public.cash_reconciliations;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to close a shift.';
  end if;

  if actual_cash_amount is null or actual_cash_amount < 0 then
    raise exception 'Actual cash must be zero or greater.';
  end if;

  select *
  into target_shift
  from public.cashier_shifts
  where id = target_shift_id
  for update;

  if target_shift.id is null then
    raise exception 'Shift not found.';
  end if;

  if target_shift.closed_at is not null then
    raise exception 'Shift is already closed.';
  end if;

  select *
  into acting_staff
  from public.restaurant_staff
  where user_id = auth.uid()
    and restaurant_id = target_shift.restaurant_id
    and active = true
    and role in ('cashier', 'owner')
  limit 1;

  if acting_staff.id is null or acting_staff.id <> target_shift.opened_by then
    raise exception 'Only the cashier who opened this shift may close it.';
  end if;

  select coalesce(sum(invoices.total_price), 0)
  into cash_payments
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  where invoices.restaurant_id = target_shift.restaurant_id
    and coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(orders.payment_method)) = 'Cash'
    and invoices.status in ('paid', 'verified')
    and invoices.verified_by = target_shift.opened_by
    and invoices.verified_at >= target_shift.opened_at
    and invoices.verified_at <= now();

  select
    count(distinct invoices.id) filter (where invoices.status in ('pending', 'rejected')),
    count(distinct orders.id) filter (where orders.status::text not in ('completed', 'cancelled'))
  into unpaid_payments, active_orders
  from public.orders orders
  left join public.order_invoices invoices
    on invoices.restaurant_id = orders.restaurant_id
   and invoices.order_id = orders.id
   and invoices.status in ('pending', 'rejected', 'paid', 'verified')
  where orders.restaurant_id = target_shift.restaurant_id
    and (
      exists (
        select 1
        from public.shift_activity_logs logs
        where logs.restaurant_id = orders.restaurant_id
          and logs.order_id = orders.id
          and logs.shift_id = target_shift.id
          and logs.action in ('order_created', 'order_items_appended')
      )
      or exists (
        select 1
        from public.order_invoices verified_batches
        where verified_batches.restaurant_id = orders.restaurant_id
          and verified_batches.order_id = orders.id
          and verified_batches.status in ('paid', 'verified')
          and verified_batches.verified_by = target_shift.opened_by
          and verified_batches.verified_at >= target_shift.opened_at
          and verified_batches.verified_at <= now()
      )
    );

  if unpaid_payments > 0 then
    raise exception 'Shift cannot close while % unpaid payment batch(es) remain.', unpaid_payments;
  end if;

  if active_orders > 0 then
    raise exception 'Shift cannot close while % active order(s) remain.', active_orders;
  end if;

  expected_drawer := target_shift.opening_cash + cash_payments - cash_refunds;
  variance_amount := actual_cash_amount - expected_drawer;

  if variance_amount <> 0 and nullif(trim(variance_explanation), '') is null then
    raise exception 'Variance explanation is required when cash variance is non-zero.';
  end if;

  update public.cashier_shifts
  set
    closed_at = now(),
    closed_by = acting_staff.id,
    expected_cash = expected_drawer,
    actual_cash = actual_cash_amount,
    variance = variance_amount,
    variance_reason = nullif(trim(variance_explanation), '')
  where id = target_shift.id
  returning * into target_shift;

  insert into public.cash_reconciliations (
    restaurant_id,
    shift_id,
    closed_by,
    opening_cash,
    cash_payments,
    cash_refunds,
    expected_cash,
    actual_cash,
    variance,
    variance_reason,
    closed_at
  )
  values (
    target_shift.restaurant_id,
    target_shift.id,
    acting_staff.id,
    target_shift.opening_cash,
    cash_payments,
    cash_refunds,
    expected_drawer,
    actual_cash_amount,
    variance_amount,
    nullif(trim(variance_explanation), ''),
    target_shift.closed_at
  )
  returning * into reconciliation_row;

  insert into public.shift_activity_logs (restaurant_id, shift_id, actor_staff_id, action, message, amount, metadata)
  values (
    target_shift.restaurant_id,
    target_shift.id,
    acting_staff.id,
    'shift_closed',
    'Shift closed',
    actual_cash_amount,
    jsonb_build_object('expected_cash', expected_drawer, 'variance', variance_amount, 'cash_source', 'verified_payment_batches')
  );

  return jsonb_build_object('shift', to_jsonb(target_shift), 'reconciliation', to_jsonb(reconciliation_row));
end;
$$;

create or replace function public.get_owner_reporting_center(
  target_restaurant_id uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  report jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to view reports.';
  end if;

  if target_restaurant_id is null or range_start is null or range_end is null or range_start >= range_end then
    raise exception 'Valid restaurant and reporting range are required.';
  end if;

  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only restaurant owners may view reports.';
  end if;

  with scoped_orders as (
    select *
    from public.orders
    where restaurant_id = target_restaurant_id
      and created_at >= range_start
      and created_at < range_end
  ),
  verified_payments as (
    select *
    from public.order_invoices
    where restaurant_id = target_restaurant_id
      and status in ('paid', 'verified')
      and verified_at >= range_start
      and verified_at < range_end
  ),
  payment_orders as (
    select distinct orders.*
    from public.orders orders
    join verified_payments payments
      on payments.restaurant_id = orders.restaurant_id
     and payments.order_id = orders.id
  ),
  item_rows as (
    select
      oi.menu_item_id,
      coalesce(mi.name, 'Menu item') as name,
      coalesce(c.name, 'Uncategorized') as category_name,
      oi.quantity,
      oi.price,
      oi.quantity * oi.price as line_total
    from public.order_items oi
    join verified_payments payments
      on payments.restaurant_id = oi.restaurant_id
     and payments.id = oi.invoice_id
    left join public.menu_items mi on mi.id = oi.menu_item_id and mi.restaurant_id = oi.restaurant_id
    left join public.categories c on c.id = mi.category_id and c.restaurant_id = mi.restaurant_id
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'revenue', coalesce((select sum(total_price) from verified_payments), 0),
      'orders', (select count(*) from verified_payments),
      'average_order_value', coalesce((select avg(total_price) from verified_payments), 0),
      'completed_orders', (select count(distinct scoped_orders.id) from scoped_orders join payment_orders on payment_orders.id = scoped_orders.id where scoped_orders.status::text = 'completed'),
      'cancelled_orders', (select count(distinct scoped_orders.id) from scoped_orders join payment_orders on payment_orders.id = scoped_orders.id where scoped_orders.status::text = 'cancelled'),
      'unique_customers', (select count(distinct nullif(customer_name, '')) from payment_orders)
    ),
    'sales_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', day::date, 'revenue', revenue, 'orders', orders) order by day)
      from (
        select date_trunc('day', verified_at) as day, sum(total_price) as revenue, count(*) as orders
        from verified_payments
        group by 1
      ) daily
    ), '[]'::jsonb),
    'orders_by_status', coalesce((
      select jsonb_agg(jsonb_build_object('status', status::text, 'orders', count) order by status)
      from (
        select status, count(*) as count
        from payment_orders
        group by status
      ) statuses
    ), '[]'::jsonb),
    'menu_performance', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'category', category_name, 'quantity', quantity, 'revenue', revenue) order by revenue desc)
      from (
        select name, category_name, sum(quantity) as quantity, sum(line_total) as revenue
        from item_rows
        group by name, category_name
        order by revenue desc
        limit 25
      ) menu
    ), '[]'::jsonb),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object('method', payment_method, 'payments', payments, 'revenue', revenue) order by revenue desc)
      from (
        select coalesce(payment_method, 'Unknown') as payment_method, count(*) as payments, sum(total_price) as revenue
        from verified_payments
        group by coalesce(payment_method, 'Unknown')
      ) methods
    ), '[]'::jsonb),
    'staff_performance', coalesce((
      select jsonb_agg(jsonb_build_object('name', display_name, 'role', role, 'orders_completed', orders_completed, 'payments_verified', payments_verified) order by orders_completed desc, payments_verified desc)
      from (
        select
          rs.display_name,
          rs.role::text as role,
          count(o.id) filter (where o.completed_by = rs.id) as orders_completed,
          count(payments.id) filter (where payments.verified_by = rs.id) as payments_verified
        from public.restaurant_staff rs
        left join scoped_orders o on o.restaurant_id = rs.restaurant_id
        left join verified_payments payments on payments.restaurant_id = rs.restaurant_id
        where rs.restaurant_id = target_restaurant_id
          and rs.role::text <> 'owner'
        group by rs.id, rs.display_name, rs.role
      ) staff
    ), '[]'::jsonb),
    'table_usage', coalesce((
      select jsonb_agg(jsonb_build_object('table_number', table_number, 'orders', orders, 'revenue', revenue) order by table_number)
      from (
        select
          rt.table_number,
          count(payments.id) as orders,
          coalesce(sum(payments.total_price), 0) as revenue
        from public.restaurant_tables rt
        left join scoped_orders o
          on o.restaurant_id = rt.restaurant_id
         and o.table_number = rt.table_number::text
        left join verified_payments payments
          on payments.restaurant_id = rt.restaurant_id
         and payments.order_id = o.id
        where rt.restaurant_id = target_restaurant_id
          and rt.active = true
        group by rt.table_number
      ) tables
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object('customer_name', customer_name, 'orders', orders, 'revenue', revenue, 'last_order_at', last_order_at) order by revenue desc)
      from (
        select
          coalesce(nullif(o.customer_name, ''), 'Guest') as customer_name,
          count(payments.id) as orders,
          coalesce(sum(payments.total_price), 0) as revenue,
          max(o.created_at) as last_order_at
        from verified_payments payments
        join public.orders o
          on o.restaurant_id = payments.restaurant_id
         and o.id = payments.order_id
        group by coalesce(nullif(o.customer_name, ''), 'Guest')
        order by revenue desc
        limit 25
      ) customers
    ), '[]'::jsonb),
    'ai_insights', jsonb_build_array(
      jsonb_build_object('title', 'Peak sales window', 'detail', 'Use the hourly verified-payment chart to staff cashier and kitchen roles around proven demand.'),
      jsonb_build_object('title', 'Menu focus', 'detail', 'Promote top revenue items and review low-performing items for photos, price, or availability.'),
      jsonb_build_object('title', 'Table coverage', 'detail', 'Tables with low QR usage may need clearer table signage or staff prompts.')
    )
  )
  into report;

  return report;
end;
$$;

revoke all on function public.normalize_payment_method(text) from public, anon;
revoke all on function public.payment_method_is_supported(text) from public, anon;
revoke all on function public.verify_order_payment(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.reject_order_payment(uuid, text) from public, anon;
revoke all on function public.request_order_payment_retry(uuid, text) from public, anon;
revoke all on function public.get_cashier_invoice_queue(uuid) from public, anon;
revoke all on function public.get_cashier_shift_summary(uuid) from public, anon;
revoke all on function public.get_owner_reporting_center(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.find_payment_reference(uuid, text) from public, anon;

grant execute on function public.normalize_payment_method(text) to authenticated, anon;
grant execute on function public.payment_method_is_supported(text) to authenticated, anon;
grant execute on function public.verify_order_payment(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.reject_order_payment(uuid, text) to authenticated;
grant execute on function public.request_order_payment_retry(uuid, text) to authenticated;
grant execute on function public.get_cashier_invoice_queue(uuid) to authenticated;
grant execute on function public.get_cashier_shift_summary(uuid) to authenticated;
grant execute on function public.get_owner_reporting_center(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.find_payment_reference(uuid, text) to authenticated;
