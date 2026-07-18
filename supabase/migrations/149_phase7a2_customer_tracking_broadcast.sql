-- Anonymous customers cannot SELECT order tables. Broadcast changes only to
-- the unguessable browser-session topic that created the dining session.
create or replace function public.broadcast_customer_order_change()
returns trigger
language plpgsql
security definer
set search_path=public,realtime
as $$
declare target_order public.orders; topic text;
begin
  if tg_table_name='orders' then
    target_order := case when tg_op='DELETE' then old else new end;
  else
    select * into target_order from public.orders
    where id=coalesce(new.order_id,old.order_id)
      and restaurant_id=coalesce(new.restaurant_id,old.restaurant_id);
  end if;
  if target_order.id is null or nullif(target_order.browser_session_token,'') is null then return coalesce(new,old); end if;
  topic := 'customer-order:'||target_order.browser_session_token;
  perform realtime.broadcast_changes(topic,'order_changed',tg_op,tg_table_name,tg_table_schema,new,old);
  return coalesce(new,old);
end;$$;

drop trigger if exists broadcast_customer_order_change_trigger on public.orders;
create trigger broadcast_customer_order_change_trigger after insert or update on public.orders
for each row execute function public.broadcast_customer_order_change();
drop trigger if exists broadcast_customer_item_change_trigger on public.order_items;
create trigger broadcast_customer_item_change_trigger after insert or update or delete on public.order_items
for each row execute function public.broadcast_customer_order_change();
drop trigger if exists broadcast_customer_invoice_change_trigger on public.order_invoices;
create trigger broadcast_customer_invoice_change_trigger after insert or update or delete on public.order_invoices
for each row execute function public.broadcast_customer_order_change();

revoke all on function public.broadcast_customer_order_change() from public,anon,authenticated;
