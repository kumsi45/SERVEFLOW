-- SA2 local candidate. NOT APPLIED. No existing user/tenant rows are altered.
begin;
create or replace function public.set_app_url(requested_app_url text)
returns text language plpgsql security definer set search_path='' as $$
begin
  perform platform_private.require_admin('sensitive');
  raise exception 'Global URL changes require a separately reviewed configuration change. No dashboard setter is enabled.' using errcode='42501';
end $$;
revoke all on function public.set_app_url(text) from public,anon,authenticated,service_role;

-- Never authorize tenant provisioning from user-editable Auth metadata.
-- Existing logins/memberships are untouched. Reviewed provisioning is not enabled yet.
create or replace function public.create_owner_restaurant_from_auth_signup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(new.raw_user_meta_data,'{}'::jsonb)->>'signup_kind'='owner' then
    raise exception 'Owner provisioning requires an approved invitation workflow; provisioning is currently unavailable.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.create_owner_restaurant_from_auth_signup() from public,anon,authenticated;
-- No RLS widening, tenant suspension, expiry cutover, Storage change or printer change.
commit;
