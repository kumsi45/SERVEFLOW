-- Hold-payment tickets are intentionally released to kitchen without marking payment paid.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.get_station_kitchen_orders(uuid,uuid,boolean,boolean)'::regprocedure);
  if position('order_invoices.status = ''verified''' in definition) = 0 then
    raise exception 'Expected kitchen queue payment predicate was not found.';
  end if;
  definition := replace(definition,
    'order_invoices.status = ''verified'' AND order_invoices.verified_at IS NOT NULL',
    'order_invoices.payment_status IN (''paid'', ''held'')');
  definition := replace(definition,
    'order_invoices.status = ''verified''
      and order_invoices.verified_at is not null',
    'order_invoices.payment_status in (''paid'', ''held'')');
  execute definition;
end $$;

create or replace function public.reconcile_canonical_operational_status()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_order uuid := coalesce(new.order_id,old.order_id); next_status text;
begin
  select case
    when count(*)=0 then 'new'
    when bool_and(kitchen_status='completed') then 'served'
    when bool_and(kitchen_status in ('ready','completed')) then 'ready'
    when bool_or(kitchen_status='preparing') then 'preparing'
    when bool_or(kitchen_status in ('paid','ready','completed')) then 'accepted'
    else 'new' end into next_status
  from public.order_items where order_id=target_order;
  update public.orders set operational_status=next_status where id=target_order and operational_status<>'closed';
  return coalesce(new,old);
end;$$;
drop trigger if exists reconcile_canonical_operational_status_trigger on public.order_items;
create trigger reconcile_canonical_operational_status_trigger
after insert or update of kitchen_status or delete on public.order_items
for each row execute function public.reconcile_canonical_operational_status();

create or replace function public.prevent_unpaid_session_close()
returns trigger language plpgsql set search_path=public as $$
begin
  if (new.dining_session_status::text in ('closed','checked_out') or new.table_released_at is not null)
     and (old.dining_session_status is distinct from new.dining_session_status or old.table_released_at is distinct from new.table_released_at)
     and exists(select 1 from public.order_invoices where order_id=new.id and restaurant_id=new.restaurant_id and payment_status in ('pending','held')) then
    raise exception 'Dining session cannot close while payment is pending or due.';
  end if;
  return new;
end;$$;
drop trigger if exists prevent_unpaid_session_close_trigger on public.orders;
create trigger prevent_unpaid_session_close_trigger before update of dining_session_status,table_released_at on public.orders
for each row execute function public.prevent_unpaid_session_close();
