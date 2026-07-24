-- Preserve atomic session settlement while reporting the actual amount due
-- when legacy invoice rows carry a zero-valued grand_total placeholder.
alter function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) rename to verify_dining_session_payment_phase161_base;

create or replace function public.verify_dining_session_payment(
  target_dining_session_id uuid,
  selected_payment_method text,
  payment_reference_number text default null,
  payment_transaction_id text default null,
  payment_screenshot_url text default null,
  owner_duplicate_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  due_total numeric(12,2);
  payload jsonb;
begin
  select coalesce(sum(coalesce(nullif(invoices.grand_total, 0), invoices.total_price, 0)), 0)
  into due_total
  from public.order_invoices invoices
  where invoices.order_id = target_dining_session_id
    and invoices.payment_status in ('pending', 'held')
    and invoices.status::text in ('pending', 'paid');

  payload := public.verify_dining_session_payment_phase161_base(
    target_dining_session_id,
    selected_payment_method,
    payment_reference_number,
    payment_transaction_id,
    payment_screenshot_url,
    owner_duplicate_override
  );

  return jsonb_set(payload, '{settled_total}', to_jsonb(due_total), true);
end;
$$;

revoke all on function public.verify_dining_session_payment_phase161_base(
  uuid, text, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.verify_dining_session_payment_phase161_base(
  uuid, text, text, text, text, boolean
) to service_role;

revoke all on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) from public, anon;
grant execute on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) to authenticated, service_role;
