-- Candidate only. Apply after 274 in an isolated review; do not amend 271-273.
-- Approval must consume the tenant and Owner provenance of the one-use setup claim.
create or replace function public.approve_print_bridge_pairing(
  target_pairing_id uuid, supplied_code_digest bytea,
  target_restaurant_id uuid, verified_owner_user_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare pair public.print_bridge_pairings;
  claim public.print_bridge_setup_claims;
begin
  select * into pair from public.print_bridge_pairings
    where id = target_pairing_id for update;
  if pair.id is null or pair.status <> 'pending'
    or pair.expires_at <= clock_timestamp()
    or pair.code_digest is distinct from supplied_code_digest then
    raise exception 'Print bridge pairing is unavailable.' using errcode = 'P0001';
  end if;

  select * into claim from public.print_bridge_setup_claims
    where pairing_id = pair.id for share;
  if claim.pairing_id is null
    or claim.owner_user_id is distinct from verified_owner_user_id
    or claim.restaurant_id is distinct from target_restaurant_id
    or claim.token_expires_at <= clock_timestamp() then
    raise exception 'Print bridge pairing is unavailable.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.restaurant_staff staff
    where staff.restaurant_id = claim.restaurant_id
      and staff.user_id = claim.owner_user_id
      and staff.active and staff.role::text = 'owner') then
    raise exception 'An active restaurant owner is required.' using errcode = 'P0001';
  end if;

  update public.print_bridge_pairings set status = 'approved',
    restaurant_id = claim.restaurant_id,
    approved_by_user_id = claim.owner_user_id,
    approved_at = clock_timestamp()
    where id = pair.id;
  insert into public.print_bridge_pairing_events
    (pairing_id, restaurant_id, actor_user_id, event_type)
  values (pair.id, claim.restaurant_id, claim.owner_user_id, 'approved');
  return pair.id;
end; $$;

revoke all on function public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid)
  to service_role;
