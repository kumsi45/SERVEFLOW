-- Legacy base order RPCs may briefly emit their old kitchen marker before the
-- official source-specific wrapper assigns invoice payment state. Normalize
-- that intermediate write to Held; only valid workflow releases survive.
create or replace function public.enforce_official_waiter_kitchen_release()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  released boolean;
begin
  if new.kitchen_status = 'held' then return new; end if;

  select
    invoices.payment_status = 'paid'
    or (
      invoices.payment_status = 'held'
      and invoices.invoice_source = 'waiter'
      and restaurants.payment_policy = 'kitchen_before_payment'
    )
  into released
  from public.order_invoices invoices
  join public.orders orders
    on orders.restaurant_id = invoices.restaurant_id
   and orders.id = invoices.order_id
  join public.restaurants restaurants
    on restaurants.id = invoices.restaurant_id
  where invoices.id = new.invoice_id
    and invoices.order_id = new.order_id
    and invoices.restaurant_id = new.restaurant_id;

  if not coalesce(released, false) then
    new.kitchen_status := 'held';
  end if;
  return new;
end;
$$;
