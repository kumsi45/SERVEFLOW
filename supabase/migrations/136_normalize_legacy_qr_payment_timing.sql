-- Normalize rows created before QR payment timing became a permanent system
-- rule. This lets already-paid legacy QR sessions complete and close while
-- preserving the pay-before-kitchen invariant for every future write.

update public.orders
set payment_timing = 'before_kitchen'
where order_source = 'public_qr'
  and payment_timing is distinct from 'before_kitchen';

do $$
begin
  if exists (
    select 1
    from public.orders
    where order_source = 'public_qr'
      and payment_timing is distinct from 'before_kitchen'
  ) then
    raise exception 'Legacy QR payment timing normalization failed.';
  end if;
end;
$$;
