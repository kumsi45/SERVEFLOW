-- Phase 11.3D: customer-safe public Broadcast transport.
-- The topic contains the unguessable browser session token. The payload is a
-- minimal invalidation signal; customers still read canonical state through
-- get_public_qr_order_session, which validates restaurant/table/QR/token.

create or replace function public.broadcast_customer_order_change()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  target_order public.orders;
  topic text;
begin
  if tg_table_name = 'orders' then
    target_order := case when tg_op = 'DELETE' then old else new end;
  else
    select * into target_order
    from public.orders
    where id = coalesce(new.order_id, old.order_id)
      and restaurant_id = coalesce(new.restaurant_id, old.restaurant_id);
  end if;

  if target_order.id is null
     or nullif(trim(target_order.browser_session_token), '') is null then
    return coalesce(new, old);
  end if;

  topic := 'customer-order:' || target_order.browser_session_token;

  -- realtime.broadcast_changes() is private by default. QR customers are
  -- anonymous, so send a deliberately minimal public invalidation message to
  -- the secret per-browser topic instead of exposing database rows.
  perform realtime.send(
    jsonb_build_object(
      'record', jsonb_build_object(
        'restaurant_id', target_order.restaurant_id,
        'order_id', target_order.id,
        'source_table', tg_table_name,
        'operation', tg_op
      )
    ),
    'order_changed',
    topic,
    false
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists broadcast_customer_order_change_trigger on public.orders;
create trigger broadcast_customer_order_change_trigger
after insert or update on public.orders
for each row execute function public.broadcast_customer_order_change();

drop trigger if exists broadcast_customer_item_change_trigger on public.order_items;
create trigger broadcast_customer_item_change_trigger
after insert or update or delete on public.order_items
for each row execute function public.broadcast_customer_order_change();

drop trigger if exists broadcast_customer_invoice_change_trigger on public.order_invoices;
create trigger broadcast_customer_invoice_change_trigger
after insert or update or delete on public.order_invoices
for each row execute function public.broadcast_customer_order_change();

revoke all on function public.broadcast_customer_order_change() from public, anon, authenticated;

comment on function public.broadcast_customer_order_change() is
  'Emits minimal public invalidation signals to a secret browser-session topic; canonical customer state remains RPC-owned.';
