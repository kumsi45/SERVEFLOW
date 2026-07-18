-- Preserve each waiter submission as an independently attributable invoice
-- batch inside the table's single open dining session. The authenticated
-- waiter's identity and the owner's waiter-payment policy remain canonical.

create or replace function public.submit_waiter_order_batch(
  target_restaurant_slug text,
  table_number text,
  customer_name text,
  customer_phone text,
  order_note text,
  requested_items jsonb,
  client_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  target_order public.orders;
  target_invoice public.order_invoices;
  acting_waiter public.restaurant_staff;
  resolved_timing text;
begin
  -- The Phase 7A1 base owns validation, idempotency, the advisory table lock,
  -- and reuse of the one open dining-session order for this table.
  payload := public.submit_waiter_order_batch_phase7a1_base(
    target_restaurant_slug,
    table_number,
    customer_name,
    customer_phone,
    order_note,
    requested_items,
    client_request_id
  );

  select orders.* into target_order
  from public.orders orders
  where orders.id = nullif(payload->>'order_id', '')::uuid;

  select staff.* into acting_waiter
  from public.restaurant_staff staff
  where staff.restaurant_id = target_order.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role::text = 'waiter'
  limit 1;

  if target_order.id is null or acting_waiter.id is null then
    raise exception 'Active waiter order session not found.';
  end if;

  select invoices.* into target_invoice
  from public.order_invoices invoices
  where invoices.id = nullif(payload->>'invoice_id', '')::uuid
    and invoices.order_id = target_order.id
    and invoices.restaurant_id = target_order.restaurant_id;

  if target_invoice.id is null then
    raise exception 'Waiter order batch invoice was not created.';
  end if;

  perform public.stamp_invoice_ownership(
    target_invoice.id,
    'waiter',
    acting_waiter.id,
    acting_waiter.display_name
  );

  resolved_timing := public.resolve_order_payment_timing(
    target_order.restaurant_id,
    'waiter'
  );

  -- A waiter-owned dining session follows the owner's waiter policy. A waiter
  -- assisting a QR/cashier session cannot convert that existing session into a
  -- deferred one; it retains the session's payment-first safety rule.
  if target_order.order_source = 'waiter' then
    update public.orders
    set payment_timing = resolved_timing
    where id = target_order.id;
  else
    resolved_timing := target_order.payment_timing;
  end if;

  if resolved_timing = 'after_meal' then
    update public.order_invoices
    set payment_status = 'held',
        updated_at = clock_timestamp()
    where id = target_invoice.id;

    -- `paid` is the legacy database value for kitchen Accepted; invoice
    -- payment remains held and is not falsely marked as paid.
    update public.order_items
    set kitchen_status = 'paid'
    where order_id = target_order.id
      and invoice_id = target_invoice.id;
  else
    update public.order_invoices
    set payment_status = 'pending',
        updated_at = clock_timestamp()
    where id = target_invoice.id;

    update public.order_items
    set kitchen_status = 'held'
    where order_id = target_order.id
      and invoice_id = target_invoice.id;
  end if;

  payload := payload || jsonb_build_object(
    'invoice_id', target_invoice.id,
    'invoice_source', 'waiter',
    'invoice_creator_name', acting_waiter.display_name,
    'created_by_staff_id', acting_waiter.id,
    'payment_timing', resolved_timing
  );

  update public.waiter_batch_requests
  set response = payload,
      waiter_staff_id = acting_waiter.id
  where id = client_request_id;

  return payload;
end;
$$;

revoke all on function public.submit_waiter_order_batch(
  text, text, text, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.submit_waiter_order_batch(
  text, text, text, text, text, jsonb, uuid
) to authenticated, service_role;

comment on function public.submit_waiter_order_batch(
  text, text, text, text, text, jsonb, uuid
) is 'Appends a waiter-owned invoice batch to the existing open dining session and applies canonical waiter payment timing.';

