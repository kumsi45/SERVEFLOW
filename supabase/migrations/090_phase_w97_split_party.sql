-- Phase W9.7: split selected named guests into a new, empty dining session.
-- Historical invoices/items/payments/tickets remain on the source session.

create or replace function public.split_waiter_party(
  source_order_id uuid,
  destination_table_id uuid,
  selected_customer_names text[]
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_waiter public.restaurant_staff;
  source_order public.orders;
  destination public.restaurant_tables;
  source_names text[];
  normalized_selected text[];
  remaining_names text[];
  new_session public.orders;
begin
  if auth.uid() is null then raise exception 'Authentication is required to split a party.'; end if;
  if source_order_id is null or destination_table_id is null then raise exception 'Source session and destination table are required.'; end if;

  select * into source_order from public.orders where id = source_order_id for update;
  if source_order.id is null then raise exception 'Dining session not found.'; end if;
  if source_order.dining_session_status <> 'open' or source_order.table_released_at is not null then raise exception 'Only an active dining session can be split.'; end if;

  select * into acting_waiter from public.restaurant_staff staff
  where staff.restaurant_id = source_order.restaurant_id and staff.user_id = auth.uid()
    and staff.role = 'waiter' and staff.active = true limit 1;
  if acting_waiter.id is null then raise exception 'Only an active waiter may split a party.'; end if;

  select * into destination from public.restaurant_tables tables
  where tables.restaurant_id = source_order.restaurant_id and tables.id = destination_table_id and tables.active = true;
  if destination.id is null or destination.id = source_order.table_id then raise exception 'Choose another active destination table.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(source_order.restaurant_id::text || ':' || least(source_order.table_number::integer, destination.table_number)::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(source_order.restaurant_id::text || ':' || greatest(source_order.table_number::integer, destination.table_number)::text, 0));
  if exists (select 1 from public.orders occupied where occupied.restaurant_id=source_order.restaurant_id and occupied.table_id=destination.id and occupied.dining_session_status='open' and occupied.table_released_at is null) then raise exception 'Destination table is occupied.'; end if;

  source_names := array(select trim(value) from unnest(string_to_array(coalesce(source_order.customer_name,''), ' + ')) value where trim(value)<>'');
  normalized_selected := array(select distinct trim(value) from unnest(coalesce(selected_customer_names,array[]::text[])) value where trim(value)<>'');
  if cardinality(normalized_selected)=0 then raise exception 'Select at least one customer.'; end if;
  if cardinality(source_names)<=cardinality(normalized_selected) then raise exception 'At least one customer must remain at the source table.'; end if;
  if exists (select 1 from unnest(normalized_selected) selected where not exists (select 1 from unnest(source_names) source where lower(source)=lower(selected))) then raise exception 'Selected customer does not belong to this party.'; end if;
  remaining_names := array(select source from unnest(source_names) source where not exists(select 1 from unnest(normalized_selected) selected where lower(selected)=lower(source)));

  insert into public.orders(restaurant_id,status,total_price,customer_name,customer_phone,table_id,table_number,payment_method,order_source,created_by_waiter_id,dining_session_status,dining_session_opened_at,dining_session_last_activity_at)
  values(source_order.restaurant_id,'pending_payment',0,array_to_string(normalized_selected,' + '),null,destination.id,destination.table_number::text,coalesce(source_order.payment_method,'Cash'),'waiter',acting_waiter.id,'open',now(),now())
  returning * into new_session;

  update public.orders set customer_name=array_to_string(remaining_names,' + '),dining_session_last_activity_at=now(),updated_at=now()
  where id=source_order.id and restaurant_id=source_order.restaurant_id;

  perform public.log_staff_activity(source_order.restaurant_id,acting_waiter.id,'dining_party_split',new_session.id,jsonb_build_object('source_order_id',source_order.id,'source_table_number',source_order.table_number,'destination_order_id',new_session.id,'destination_table_number',destination.table_number,'moved_customers',normalized_selected));
  return new_session;
end;
$$;

revoke all on function public.split_waiter_party(uuid,uuid,text[]) from public,anon;
grant execute on function public.split_waiter_party(uuid,uuid,text[]) to authenticated,service_role;

