-- Phase P7.8: payment verification is the single atomic kitchen gateway.
-- Keep the mature P6 validation/audit implementation as the base operation and
-- enforce its payment-to-kitchen postconditions before the transaction commits.

alter function public.verify_order_payment(uuid, text, text, text, boolean)
rename to verify_order_payment_p78_base;

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
  verified_order public.orders;
  target_invoice public.order_invoices;
  invoice_item_count integer;
  held_item_count integer;
begin
  -- The base RPC locks the invoice and dining session and performs every
  -- payment, receipt, audit, item-release, and lifecycle write atomically.
  verified_order := public.verify_order_payment_p78_base(
    target_invoice_id,
    payment_reference_number,
    payment_transaction_id,
    payment_screenshot_url,
    owner_duplicate_override
  );

  select * into target_invoice
  from public.order_invoices
  where id = target_invoice_id;

  if target_invoice.id is null or target_invoice.status <> 'verified' then
    raise exception 'Payment verification did not produce a verified invoice.';
  end if;

  select count(*), count(*) filter (where items.kitchen_status = 'held')
  into invoice_item_count, held_item_count
  from public.order_items items
  where items.restaurant_id = target_invoice.restaurant_id
    and items.order_id = target_invoice.order_id
    and items.invoice_id = target_invoice.id;

  if invoice_item_count = 0 then
    raise exception 'Verified invoice has no kitchen items.';
  end if;

  if held_item_count <> 0 then
    raise exception 'Verified invoice still has items waiting for payment.';
  end if;

  -- P7.5's lifecycle derivation deliberately ignores pending_payment orders.
  -- Cross that payment boundary only here, after the invoice and every one of
  -- its items have passed the verification postconditions.
  update public.orders
  set status = 'paid',
      updated_at = now()
  where id = target_invoice.order_id
    and restaurant_id = target_invoice.restaurant_id
    and status::text = 'pending_payment';

  -- Re-derive after validating the invoice-owned release. This makes the
  -- order row (customer tracker) and item rows (kitchen queue) agree before
  -- their realtime events become visible at commit.
  verified_order := public.derive_order_status_from_items(target_invoice.order_id, target_invoice.verified_by);

  if verified_order.status::text not in ('paid', 'preparing', 'ready', 'completed') then
    raise exception 'Verified invoice did not enter the kitchen lifecycle.';
  end if;

  return verified_order;
end;
$$;

revoke all on function public.verify_order_payment_p78_base(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.verify_order_payment_p78_base(uuid, text, text, text, boolean) to service_role;

revoke all on function public.verify_order_payment(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.verify_order_payment(uuid, text, text, text, boolean) to authenticated, service_role;

-- approve_order_payment resolves the invoice then enters the same gateway.
revoke all on function public.approve_order_payment(uuid) from public, anon;
grant execute on function public.approve_order_payment(uuid) to authenticated, service_role;
