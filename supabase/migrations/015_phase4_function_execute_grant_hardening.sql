-- SERVEFLOW Phase 4 function grant hardening.
-- Public QR functions remain anonymous. Internal tenant/staff helpers and
-- staff action RPCs should not be executable by anonymous clients.

revoke all on function public.current_user_restaurant_id() from public;
revoke all on function public.current_user_role() from public;
revoke all on function public.is_restaurant_member(uuid) from public;
revoke all on function public.has_any_role(public.user_role[]) from public;
revoke all on function public.current_restaurant_staff_role(uuid) from public;
revoke all on function public.has_staff_role(uuid, public.restaurant_staff_role[]) from public;
revoke all on function public.is_active_restaurant_staff_member(uuid) from public;

grant execute on function public.current_user_restaurant_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_restaurant_member(uuid) to authenticated;
grant execute on function public.has_any_role(public.user_role[]) to authenticated;
grant execute on function public.current_restaurant_staff_role(uuid) to authenticated;
grant execute on function public.has_staff_role(uuid, public.restaurant_staff_role[]) to authenticated;
grant execute on function public.is_active_restaurant_staff_member(uuid) to authenticated;

revoke all on function public.approve_order_payment(uuid) from public;
revoke all on function public.start_order_preparation(uuid) from public;
revoke all on function public.mark_order_ready(uuid) from public;
revoke all on function public.update_order_status(uuid, public.order_status) from public;

grant execute on function public.approve_order_payment(uuid) to authenticated;
grant execute on function public.start_order_preparation(uuid) to authenticated;
grant execute on function public.mark_order_ready(uuid) to authenticated;

revoke all on function public.rls_auto_enable() from public;

revoke all on function public.get_public_qr_menu(text) from public;
revoke all on function public.create_public_qr_order(text, text, text, text, jsonb) from public;

grant execute on function public.get_public_qr_menu(text) to anon;
grant execute on function public.get_public_qr_menu(text) to authenticated;
grant execute on function public.create_public_qr_order(text, text, text, text, jsonb) to anon;
grant execute on function public.create_public_qr_order(text, text, text, text, jsonb) to authenticated;
