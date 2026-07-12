-- ServeFlow repair: keep every pending payment batch visible to cashiers and
-- keep completed public QR sessions visible long enough for customer feedback.

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
    when lower(trim(payment_method)) = 'mobile banking' then 'Mobile Banking'
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
  select public.normalize_payment_method(payment_method) in (
    'Cash',
    'Telebirr',
    'CBE Birr',
    'Mobile Banking',
    'Card',
    'Chapa'
  )
$$;

alter table public.orders
  drop constraint if exists orders_payment_method_allowed,
  add constraint orders_payment_method_allowed
    check (
      public.normalize_payment_method(payment_method) in (
        'Cash',
        'Telebirr',
        'CBE Birr',
        'Mobile Banking',
        'Card',
        'Chapa'
      )
    );

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
  recent_cutoff timestamptz := now() - interval '36 hours';
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
    and orders.status::text <> 'cancelled'
    and (
      invoices.status in ('pending', 'rejected')
      or orders.status::text in ('pending', 'pending_payment', 'paid', 'preparing', 'ready')
      or orders.dining_session_status = 'open'
      or invoices.created_at >= recent_cutoff
      or invoices.verified_at >= recent_cutoff
    )
  group by invoices.id, orders.id, waiter_staff.display_name, verifier.display_name
  order by
    case when invoices.status in ('pending', 'rejected') then 0 else 1 end,
    invoices.created_at desc;
end;
$$;

create or replace function public.get_public_qr_order_session(
  target_restaurant_slug text,
  table_number text,
  qr_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_table public.restaurant_tables;
  target_qr_token uuid;
  normalized_table_number_text text;
  normalized_table_number integer;
  active_order public.orders;
  session_items jsonb := '[]'::jsonb;
  session_invoices jsonb := '[]'::jsonb;
begin
  normalized_table_number_text := nullif(trim(table_number), '');

  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if normalized_table_number_text is null then
    return null;
  end if;

  if normalized_table_number_text !~ '^[0-9]+$' then
    raise exception 'Table number must be a whole number.';
  end if;

  normalized_table_number := normalized_table_number_text::integer;

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required to view this order.';
  end;

  select restaurants.id
  into target_restaurant_id
  from public.restaurants restaurants
  where restaurants.slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  perform public.expire_stale_dining_sessions(target_restaurant_id);

  select *
  into target_table
  from public.restaurant_tables tables
  where tables.restaurant_id = target_restaurant_id
    and tables.table_number = normalized_table_number
    and tables.qr_token = target_qr_token
    and tables.active = true
  limit 1;

  if target_table.id is null then
    raise exception 'Invalid or expired table QR code.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_restaurant_id::text || ':' || normalized_table_number::text, 0));

  select *
  into active_order
  from public.orders orders
  where orders.restaurant_id = target_restaurant_id
    and orders.table_number = normalized_table_number::text
    and orders.order_source = 'public_qr'
    and (
      public.is_public_qr_dining_session_open(orders.id)
      or (
        orders.status::text = 'completed'
        and orders.dining_session_status in ('open', 'closed', 'checked_out')
        and coalesce(orders.table_released_at, orders.dining_session_closed_at, orders.completed_at, orders.updated_at, orders.created_at) >= now() - interval '12 hours'
      )
    )
  order by
    case when public.is_public_qr_dining_session_open(orders.id) then 0 else 1 end,
    orders.created_at desc
  limit 1
  for update;

  if active_order.id is null then
    insert into public.orders (
      restaurant_id, customer_user_id, status, total_price, customer_name,
      table_id, table_number, payment_method, order_source,
      dining_session_status, dining_session_opened_at, dining_session_expires_at
    )
    values (
      target_restaurant_id, null, 'pending', 0, null,
      target_table.id, normalized_table_number::text, 'Cash', 'public_qr',
      'open', now(), now() + public.get_dining_session_timeout(target_restaurant_id)
    )
    returning * into active_order;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', items.id,
        'invoice_id', items.invoice_id,
        'invoice_status', invoices.status,
        'menu_item_id', menu_items.id,
        'name', menu_items.name,
        'quantity', items.quantity,
        'unit_price', items.price,
        'line_total', (items.price * items.quantity)::numeric(12, 2),
        'kitchen_status', items.kitchen_status,
        'appended_at', items.appended_at,
        'created_at', items.created_at
      )
      order by items.created_at, items.id
    ),
    '[]'::jsonb
  )
  into session_items
  from public.order_items items
  join public.order_invoices invoices
    on invoices.restaurant_id = items.restaurant_id
   and invoices.id = items.invoice_id
  join public.menu_items menu_items
    on menu_items.restaurant_id = items.restaurant_id
   and menu_items.id = items.menu_item_id
  where items.restaurant_id = active_order.restaurant_id
    and items.order_id = active_order.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', invoices.id,
        'invoice_number', invoices.invoice_number,
        'status', invoices.status,
        'total_price', invoices.total_price,
        'payment_method', coalesce(public.normalize_payment_method(invoices.payment_method), public.normalize_payment_method(active_order.payment_method)),
        'paid_at', invoices.paid_at,
        'locked_at', invoices.locked_at,
        'created_at', invoices.created_at
      )
      order by invoices.invoice_number
    ),
    '[]'::jsonb
  )
  into session_invoices
  from public.order_invoices invoices
  where invoices.restaurant_id = active_order.restaurant_id
    and invoices.order_id = active_order.id;

  return jsonb_build_object(
    'order_id', active_order.id,
    'status', active_order.status,
    'dining_session_status', active_order.dining_session_status,
    'dining_session_expires_at', active_order.dining_session_expires_at,
    'total_price', active_order.total_price,
    'table_number', active_order.table_number,
    'customer_name', active_order.customer_name,
    'payment_method', active_order.payment_method,
    'created_at', active_order.created_at,
    'payment_verified_at', active_order.payment_verified_at,
    'items', session_items,
    'invoices', session_invoices
  );
end;
$$;

revoke all on function public.normalize_payment_method(text) from public, anon;
revoke all on function public.payment_method_is_supported(text) from public, anon;
revoke all on function public.get_cashier_invoice_queue(uuid) from public, anon;
revoke all on function public.get_public_qr_order_session(text, text, text) from public;

grant execute on function public.normalize_payment_method(text) to authenticated, anon;
grant execute on function public.payment_method_is_supported(text) to authenticated, anon;
grant execute on function public.get_cashier_invoice_queue(uuid) to authenticated;
grant execute on function public.get_public_qr_order_session(text, text, text) to anon;
grant execute on function public.get_public_qr_order_session(text, text, text) to authenticated;
