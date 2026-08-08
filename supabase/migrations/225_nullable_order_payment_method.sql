-- An order records how payment was actually collected only after that method
-- is known. The invoice remains authoritative; the order-level value is a
-- nullable compatibility projection and must never default an unpaid order to
-- Cash.

alter table public.orders
  alter column payment_method drop default,
  alter column payment_method drop not null;

comment on column public.orders.payment_method is
  'Nullable compatibility projection of the authoritative invoice payment method; never inferred at order creation.';
