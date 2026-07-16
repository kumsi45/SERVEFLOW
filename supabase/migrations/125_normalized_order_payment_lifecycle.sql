-- Canonical, independent operational and payment lifecycles.
alter table public.restaurants add column if not exists payment_policy text not null default 'pay_before_kitchen';
alter table public.restaurants drop constraint if exists restaurants_payment_policy_allowed;
alter table public.restaurants add constraint restaurants_payment_policy_allowed check (payment_policy in ('pay_before_kitchen','hold_payment','mixed'));

alter table public.orders add column if not exists operational_status text not null default 'new';
alter table public.orders add column if not exists payment_timing text;
alter table public.orders drop constraint if exists orders_operational_status_allowed;
alter table public.orders add constraint orders_operational_status_allowed check (operational_status in ('new','accepted','preparing','ready','served','closed'));
alter table public.orders drop constraint if exists orders_payment_timing_allowed;
alter table public.orders add constraint orders_payment_timing_allowed check (payment_timing in ('before_kitchen','after_meal'));

alter table public.order_invoices add column if not exists payment_status text not null default 'pending';
alter table public.order_invoices drop constraint if exists order_invoices_payment_status_allowed;
alter table public.order_invoices add constraint order_invoices_payment_status_allowed check (payment_status in ('pending','held','paid','refunded','cancelled'));

update public.orders set operational_status = case status::text
  when 'preparing' then 'preparing' when 'ready' then 'ready'
  when 'completed' then 'served' when 'cancelled' then 'closed'
  when 'paid' then 'accepted' else 'new' end;
update public.orders o set payment_timing = case r.payment_policy
  when 'hold_payment' then 'after_meal'
  when 'mixed' then case when o.order_source = 'public_qr' then 'before_kitchen' else 'after_meal' end
  else 'before_kitchen' end
from public.restaurants r where r.id=o.restaurant_id and o.payment_timing is null;
update public.order_invoices set payment_status = case status
  when 'verified' then 'paid' when 'paid' then 'paid' when 'refunded' then 'refunded'
  when 'cancelled' then 'cancelled' when 'rejected' then 'cancelled' else 'pending' end;

create or replace function public.sync_normalized_order_lifecycle() returns trigger language plpgsql set search_path=public as $$
declare policy text;
begin
  if new.payment_timing is null then
    select payment_policy into policy from public.restaurants where id=new.restaurant_id;
    new.payment_timing := case policy when 'hold_payment' then 'after_meal' when 'mixed' then case when new.order_source='public_qr' then 'before_kitchen' else 'after_meal' end else 'before_kitchen' end;
  end if;
  if new.dining_session_status::text in ('closed','expired') or new.table_released_at is not null then new.operational_status := 'closed';
  elsif new.status::text='completed' then new.operational_status := 'served';
  elsif new.status::text='ready' then new.operational_status := 'ready';
  elsif new.status::text='preparing' then new.operational_status := 'preparing';
  elsif new.status::text='paid' and new.operational_status='new' then new.operational_status := 'accepted'; end if;
  return new;
end;$$;
drop trigger if exists sync_normalized_order_lifecycle_trigger on public.orders;
create trigger sync_normalized_order_lifecycle_trigger before insert or update of status,dining_session_status,table_released_at,payment_timing on public.orders for each row execute function public.sync_normalized_order_lifecycle();

create or replace function public.sync_normalized_invoice_payment() returns trigger language plpgsql set search_path=public as $$
declare timing text;
begin
  select payment_timing into timing from public.orders where id=new.order_id and restaurant_id=new.restaurant_id;
  new.payment_status := case new.status when 'verified' then 'paid' when 'paid' then 'paid' when 'refunded' then 'refunded' when 'cancelled' then 'cancelled' when 'rejected' then 'cancelled' else case when timing='after_meal' then 'held' else 'pending' end end;
  return new;
end;$$;
drop trigger if exists sync_normalized_invoice_payment_trigger on public.order_invoices;
create trigger sync_normalized_invoice_payment_trigger before insert or update of status on public.order_invoices for each row execute function public.sync_normalized_invoice_payment();

create or replace function public.release_hold_payment_items() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.payment_status='held' then update public.order_items set kitchen_status='paid' where invoice_id=new.id and kitchen_status='held'; end if;
  return new;
end;$$;
drop trigger if exists release_hold_payment_items_trigger on public.order_invoices;
create trigger release_hold_payment_items_trigger after insert or update of payment_status on public.order_invoices for each row execute function public.release_hold_payment_items();

create or replace function public.release_new_hold_payment_item() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.kitchen_status='held' and exists(select 1 from public.order_invoices where id=new.invoice_id and restaurant_id=new.restaurant_id and payment_status='held') then
    update public.order_items set kitchen_status='paid' where id=new.id;
  end if;
  return new;
end;$$;
drop trigger if exists release_new_hold_payment_item_trigger on public.order_items;
create trigger release_new_hold_payment_item_trigger after insert on public.order_items for each row execute function public.release_new_hold_payment_item();

create or replace function public.enforce_verified_invoice_kitchen_gate() returns trigger language plpgsql set search_path=public as $$
declare allowed boolean;
begin
  if new.kitchen_status='held' then return new; end if;
  select (i.payment_status='paid' or (i.payment_status='held' and o.payment_timing='after_meal')) into allowed
  from public.order_invoices i join public.orders o on o.id=i.order_id and o.restaurant_id=i.restaurant_id
  where i.id=new.invoice_id and i.restaurant_id=new.restaurant_id;
  if not coalesce(allowed,false) then raise exception 'Kitchen release requires paid payment or an authorized hold-payment policy.'; end if;
  return new;
end;$$;

create or replace function public.set_restaurant_payment_policy(target_restaurant_id uuid, requested_policy text) returns text language plpgsql security definer set search_path=public as $$
begin
  if requested_policy not in ('pay_before_kitchen','hold_payment','mixed') then raise exception 'Invalid payment policy.'; end if;
  if not public.has_staff_role(target_restaurant_id,array['owner']::public.restaurant_staff_role[]) then raise exception 'Only the restaurant owner may change payment policy.'; end if;
  update public.restaurants set payment_policy=requested_policy,updated_at=now() where id=target_restaurant_id;
  return requested_policy;
end;$$;
revoke all on function public.set_restaurant_payment_policy(uuid,text) from public,anon;
grant execute on function public.set_restaurant_payment_policy(uuid,text) to authenticated;

create index if not exists orders_operational_status_idx on public.orders(restaurant_id,operational_status,created_at desc);
create index if not exists invoices_payment_status_idx on public.order_invoices(restaurant_id,payment_status,created_at desc);
