-- Phase 11.3: safe runtime projections and enabled-method enforcement.
-- No tables or columns are introduced. Private configuration remains protected by RLS.

create or replace function public.get_public_payment_runtime(target_restaurant_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant public.restaurants;
begin
  select restaurant.* into target_restaurant
  from public.restaurants restaurant
  where restaurant.slug = nullif(btrim(target_restaurant_slug), '')
  limit 1;

  if target_restaurant.id is null then
    raise exception 'Business not found.';
  end if;

  return jsonb_build_object(
    'restaurant_id', target_restaurant.id,
    'business_name', target_restaurant.name,
    'payment_policy', target_restaurant.payment_policy,
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', method.method_code,
        'display_name', method.display_name,
        'is_default', method.is_default,
        'accounts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'provider', account.provider_code,
            'business_name', account.business_name,
            'account_name', account.account_name,
            'account_number', account.account_number,
            'phone_number', account.phone_number,
            'reference_format', account.reference_format,
            'qr_image_url', account.qr_image_url,
            'instructions', account.instructions
          ) order by account.display_order, account.created_at)
          from public.business_payment_accounts account
          where account.restaurant_id = method.restaurant_id
            and account.payment_method_id = method.id
            and account.status = 'active'
            and account.deleted_at is null
        ), '[]'::jsonb)
      ) order by method.is_default desc, method.display_order, method.display_name)
      from public.business_payment_methods method
      where method.restaurant_id = target_restaurant.id
        and method.enabled
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_payment_runtime(text) from public;
grant execute on function public.get_public_payment_runtime(text) to anon, authenticated;

create or replace function public.assert_public_payment_method_enabled(
  target_restaurant_slug text,
  selected_payment_method text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_method text;
begin
  normalized_method := case lower(btrim(selected_payment_method))
    when 'cash' then 'cash'
    when 'telebirr' then 'telebirr'
    when 'cbe birr' then 'cbe_birr'
    when 'mobile banking' then 'mobile_banking'
    when 'bank transfer' then 'bank_transfer'
    when 'credit card' then 'credit_card'
    when 'credit/debit card' then 'credit_card'
    when 'card' then 'credit_card'
    else null
  end;

  if normalized_method is null or not exists (
    select 1
    from public.restaurants restaurant
    join public.business_payment_methods method on method.restaurant_id = restaurant.id
    where restaurant.slug = nullif(btrim(target_restaurant_slug), '')
      and method.method_code = normalized_method
      and method.enabled
  ) then
    raise exception 'This payment method is not enabled for this business.';
  end if;

  return normalized_method;
end;
$$;

revoke all on function public.assert_public_payment_method_enabled(text, text) from public;
grant execute on function public.assert_public_payment_method_enabled(text, text) to anon, authenticated;

comment on function public.get_public_payment_runtime(text) is
  'Public checkout projection containing enabled methods and customer-visible active account instructions only.';
comment on function public.assert_public_payment_method_enabled(text, text) is
  'Server-owned guard that prevents public checkout from submitting a disabled payment method.';

-- Keep validation and order creation in the same database transaction. This
-- extends the existing Phase 7A.1 authority; it does not duplicate order logic.
create or replace function public.create_public_qr_order(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  browser_session_token text,
  customer_name text,
  selected_payment_method text,
  requested_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
begin
  perform public.assert_public_payment_method_enabled(target_restaurant_slug, selected_payment_method);
  payload := public.create_public_qr_order_phase7a1_base(
    target_restaurant_slug, table_number, qr_token, browser_session_token,
    customer_name, selected_payment_method, requested_items
  );
  return public.merge_open_session_invoice(payload);
end;
$$;

revoke all on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) from public;
grant execute on function public.create_public_qr_order(text, text, text, text, text, text, jsonb) to anon, authenticated;
