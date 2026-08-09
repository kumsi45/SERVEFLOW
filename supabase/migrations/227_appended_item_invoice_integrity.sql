-- Prevent cashier item appends from producing invoice-less kitchen rows after
-- the latest invoice has already been verified. A verified invoice uses the
-- legacy status value "verified", not "paid", so it is never mutable.

do $$
declare
  definition text;
  old_branch text := $match$if latest_invoice.id is null or latest_invoice.status = 'paid' then$match$;
  new_branch text := $replace$if latest_invoice.id is null
    or latest_invoice.status <> 'pending'
    or coalesce(latest_invoice.payment_status, 'pending') not in ('pending', 'held')
  then$replace$;
  old_update_guard text := $match$and status = 'pending'
    returning * into current_invoice;$match$;
  new_update_guard text := $replace$and status = 'pending'
      and coalesce(payment_status, 'pending') in ('pending', 'held')
    returning * into current_invoice;$replace$;
  item_insert text := $match$  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, appended_at, kitchen_status)$match$;
  guarded_item_insert text := $replace$  if current_invoice.id is null then
    raise exception 'A mutable invoice could not be created for the appended items.';
  end if;

  insert into public.order_items (restaurant_id, order_id, invoice_id, menu_item_id, quantity, price, notes, appended_at, kitchen_status)$replace$;
begin
  select pg_get_functiondef(
    'public.append_items_to_order_p77_base(uuid,jsonb)'::regprocedure
  ) into definition;

  if position(old_branch in definition) = 0
    or position(old_update_guard in definition) = 0
    or position(item_insert in definition) = 0
  then
    raise exception 'append_items_to_order_p77_base no longer matches the expected safe patch points.';
  end if;

  definition := replace(definition, old_branch, new_branch);
  definition := replace(definition, old_update_guard, new_update_guard);
  definition := replace(definition, item_insert, guarded_item_insert);
  execute definition;

  select pg_get_functiondef(
    'public.append_items_to_order_p77_base(uuid,jsonb)'::regprocedure
  ) into definition;

  if position('latest_invoice.status <> ''pending''' in definition) = 0
    or position('latest_invoice.payment_status' in definition) = 0
    or position('A mutable invoice could not be created for the appended items.' in definition) = 0
  then
    raise exception 'append_items_to_order_p77_base invoice-integrity patch was not installed.';
  end if;
end;
$$;

create or replace function public.enforce_appended_item_invoice_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.appended_at is not null and new.invoice_id is null then
    raise exception 'Appended order items require an invoice.';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_appended_item_invoice_integrity()
from public, anon, authenticated;

drop trigger if exists enforce_appended_item_invoice_integrity_trigger
on public.order_items;
create trigger enforce_appended_item_invoice_integrity_trigger
before insert or update of invoice_id, appended_at on public.order_items
for each row
execute function public.enforce_appended_item_invoice_integrity();

comment on function public.enforce_appended_item_invoice_integrity() is
  'Rejects new or reclassified appended order items that are not owned by an invoice.';
