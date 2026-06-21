-- SERVEFLOW Phase 4 Step 3 preparation.
-- Deprecates the legacy broad order status mutation path.
-- Future order status transitions must use dedicated RPCs:
-- - public.approve_order_payment(uuid)
-- - public.start_order_preparation(uuid)
-- - public.mark_order_ready(uuid)

revoke execute on function public.update_order_status(uuid, public.order_status) from authenticated;
