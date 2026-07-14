-- Phase W10.1: expose batch timestamps without replacing the stable detail RPC.
create or replace function public.get_waiter_session_batches(target_order_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare waiter restaurant_staff; result jsonb;
begin
 select s.* into waiter from restaurant_staff s join orders o on o.restaurant_id=s.restaurant_id where o.id=target_order_id and s.user_id=auth.uid() and s.active and s.role::text='waiter' limit 1;
 if waiter.id is null then raise exception 'Active waiter session not found.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('item_id',x.id,'appended_at',x.appended_at,'created_at',x.created_at) order by coalesce(x.appended_at,x.created_at),x.created_at),'[]'::jsonb) into result from order_items x where x.order_id=target_order_id;
 return result;
end;$$;
revoke all on function public.get_waiter_session_batches(uuid) from public,anon;
grant execute on function public.get_waiter_session_batches(uuid) to authenticated,service_role;
