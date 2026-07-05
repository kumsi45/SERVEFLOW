-- SERVEFLOW Phase 4B compatibility: preserve kitchen audit actor during
-- station-scoped item status reconciliation.

create or replace function public.reconcile_order_status_from_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_order_id uuid;
  acting_staff_id uuid;
begin
  changed_order_id := coalesce(new.order_id, old.order_id);
  acting_staff_id := coalesce(
    case when tg_op <> 'DELETE' then new.kitchen_completed_by end,
    case when tg_op <> 'DELETE' then new.kitchen_ready_marked_by end,
    case when tg_op <> 'DELETE' then new.kitchen_preparation_started_by end,
    case when tg_op <> 'INSERT' then old.kitchen_completed_by end,
    case when tg_op <> 'INSERT' then old.kitchen_ready_marked_by end,
    case when tg_op <> 'INSERT' then old.kitchen_preparation_started_by end
  );

  perform public.derive_order_status_from_items(changed_order_id, acting_staff_id);
  return coalesce(new, old);
end;
$$;

revoke all on function public.reconcile_order_status_from_item_change() from public, anon, authenticated;
