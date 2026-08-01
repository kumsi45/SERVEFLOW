-- Phase 11.3A: V1 customer-safe payment projection.
-- No schema changes. QR image and reference-format metadata are intentionally excluded.
create or replace function public.get_public_payment_runtime(target_restaurant_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target_restaurant public.restaurants;
begin
  select restaurant.* into target_restaurant from public.restaurants restaurant
  where restaurant.slug = nullif(btrim(target_restaurant_slug), '') limit 1;
  if target_restaurant.id is null then raise exception 'Business not found.'; end if;
  return jsonb_build_object(
    'business_name', target_restaurant.name,
    'payment_policy', target_restaurant.payment_policy,
    'methods', coalesce((select jsonb_agg(jsonb_build_object(
      'code', method.method_code, 'display_name', method.display_name, 'is_default', method.is_default,
      'accounts', case when method.method_code = 'cash' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
        'provider', account.provider_code, 'business_name', account.business_name,
        'account_name', account.account_name, 'account_number', account.account_number,
        'phone_number', account.phone_number, 'instructions', account.instructions
      ) order by account.display_order, account.created_at) from public.business_payment_accounts account
      where account.restaurant_id = method.restaurant_id and account.payment_method_id = method.id
        and account.status = 'active' and account.deleted_at is null
        and (nullif(btrim(coalesce(account.account_number, '')), '') is not null or nullif(btrim(coalesce(account.phone_number, '')), '') is not null)), '[]'::jsonb) end
    ) order by method.is_default desc, method.display_order)
    from public.business_payment_methods method where method.restaurant_id = target_restaurant.id and method.enabled
      and (method.method_code = 'cash' or exists (select 1 from public.business_payment_accounts account
        where account.restaurant_id = method.restaurant_id and account.payment_method_id = method.id
          and account.status = 'active' and account.deleted_at is null
          and (nullif(btrim(coalesce(account.account_number, '')), '') is not null or nullif(btrim(coalesce(account.phone_number, '')), '') is not null)))), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_public_payment_runtime(text) from public;
grant execute on function public.get_public_payment_runtime(text) to anon, authenticated;
