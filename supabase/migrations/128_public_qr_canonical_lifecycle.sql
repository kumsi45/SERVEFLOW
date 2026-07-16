create or replace function public.get_public_qr_canonical_lifecycle(target_restaurant_slug text,table_number text,qr_token text,target_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_restaurant_id uuid; v_table_id uuid;
begin
  select id into v_restaurant_id from public.restaurants where slug=lower(trim(target_restaurant_slug)) and active limit 1;
  select id into v_table_id from public.restaurant_tables where restaurant_id=v_restaurant_id
    and table_number::text=trim(get_public_qr_canonical_lifecycle.table_number) and qr_token::text=trim(get_public_qr_canonical_lifecycle.qr_token) and active limit 1;
  if v_table_id is null or not exists(select 1 from public.orders where id=target_order_id and restaurant_id=v_restaurant_id and table_id=v_table_id) then return null; end if;
  return (select jsonb_build_object('operational_status',o.operational_status,'dining_session_status',o.dining_session_status,
    'payment_policy',r.payment_policy,'invoices',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'payment_status',i.payment_status)) from public.order_invoices i where i.order_id=o.id and i.restaurant_id=o.restaurant_id),'[]'::jsonb))
    from public.orders o join public.restaurants r on r.id=o.restaurant_id where o.id=target_order_id);
end;$$;
revoke all on function public.get_public_qr_canonical_lifecycle(text,text,text,uuid) from public;
grant execute on function public.get_public_qr_canonical_lifecycle(text,text,text,uuid) to anon,authenticated;
