-- Candidate only. Deploy before the P3.2 Edge functions; never amend Migration 273.
-- A setup claim and pairing creation commit or roll back in one transaction.
create table public.print_bridge_setup_claims (
  setup_digest bytea primary key check (octet_length(setup_digest) = 32),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  pairing_id uuid not null unique references public.print_bridge_pairings(id) on delete restrict,
  token_expires_at timestamptz not null,
  claimed_at timestamptz not null default clock_timestamp()
);

create index print_bridge_setup_claims_tenant_idx
  on public.print_bridge_setup_claims (restaurant_id, claimed_at desc);
alter table public.print_bridge_setup_claims enable row level security;
alter table public.print_bridge_setup_claims force row level security;
revoke all on public.print_bridge_setup_claims from public, anon, authenticated;
grant select, insert on public.print_bridge_setup_claims to service_role;

create function public.begin_print_bridge_pairing_with_setup(
  requested_code_digest bytea, requested_proof_digest bytea,
  requested_bridge_name text, requested_ttl_seconds integer,
  requested_setup_digest bytea, verified_owner_user_id uuid,
  target_restaurant_id uuid, setup_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare pair_id uuid;
begin
  if octet_length(requested_setup_digest) <> 32
    or verified_owner_user_id is null or target_restaurant_id is null
    or setup_expires_at <= clock_timestamp()
    or setup_expires_at > clock_timestamp() + interval '5 minutes'
    or not exists (select 1 from public.restaurant_staff staff
      where staff.restaurant_id = target_restaurant_id
        and staff.user_id = verified_owner_user_id
        and staff.active and staff.role::text = 'owner') then
    raise exception 'Setup authorization is unavailable.' using errcode = 'P0001';
  end if;

  -- Keep Migration 273's validation and event semantics in this transaction.
  if octet_length(requested_code_digest) <> 32
    or octet_length(requested_proof_digest) <> 32
    or length(btrim(coalesce(requested_bridge_name, ''))) not between 1 and 120
    or requested_ttl_seconds not between 60 and 600 then
    raise exception 'Invalid print bridge pairing request.';
  end if;
  pair_id := gen_random_uuid();
  insert into public.print_bridge_pairings
    (id, code_digest, proof_digest, bridge_name, expires_at)
  values (pair_id, requested_code_digest, requested_proof_digest,
    btrim(requested_bridge_name),
    clock_timestamp() + make_interval(secs => requested_ttl_seconds));
  insert into public.print_bridge_pairing_events(pairing_id, event_type)
    values (pair_id, 'started');
  -- The primary key serializes concurrent claims. A collision rolls back the
  -- newly inserted pairing and event as well.
  insert into public.print_bridge_setup_claims
    (setup_digest, owner_user_id, restaurant_id, pairing_id, token_expires_at)
  values (requested_setup_digest, verified_owner_user_id, target_restaurant_id,
    pair_id, setup_expires_at);
  return pair_id;
end; $$;

revoke all on function public.begin_print_bridge_pairing_with_setup(
  bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.begin_print_bridge_pairing_with_setup(
  bytea,bytea,text,integer,bytea,uuid,uuid,timestamptz) to service_role;
revoke execute on function public.begin_print_bridge_pairing(bytea,bytea,text,integer)
  from service_role;
