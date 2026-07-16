-- One canonical payment-method vocabulary for collection and analytics.

create or replace function public.normalize_payment_method(payment_method text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(trim(payment_method), '') is null then null
    when lower(trim(payment_method)) in ('credit/debit card', 'debit card', 'credit card', 'card') then 'Card'
    when lower(regexp_replace(trim(payment_method), '[ _-]+', ' ', 'g')) in ('telebirr', 'tele birr') then 'Telebirr'
    when lower(regexp_replace(trim(payment_method), '[ _-]+', ' ', 'g')) in ('cbe birr', 'cbebirr') then 'CBE Birr'
    when lower(regexp_replace(trim(payment_method), '[ _-]+', ' ', 'g')) in ('mobile banking', 'mobile bank', 'mobile') then 'Mobile Banking'
    when lower(trim(payment_method)) = 'chapa' then 'Chapa'
    when lower(trim(payment_method)) = 'cash' then 'Cash'
    when lower(trim(payment_method)) = 'mixed' then 'Mixed'
    else trim(payment_method)
  end
$$;

create or replace function public.payment_method_is_supported(payment_method text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.normalize_payment_method(payment_method) in (
    'Cash', 'Card', 'Telebirr', 'CBE Birr', 'Chapa', 'Mobile Banking', 'Mixed'
  )
$$;

alter table public.orders
  drop constraint if exists orders_payment_method_allowed,
  add constraint orders_payment_method_allowed
    check (public.payment_method_is_supported(payment_method));

revoke all on function public.normalize_payment_method(text) from public;
revoke all on function public.payment_method_is_supported(text) from public;
grant execute on function public.normalize_payment_method(text) to authenticated, anon, service_role;
grant execute on function public.payment_method_is_supported(text) to authenticated, anon, service_role;
