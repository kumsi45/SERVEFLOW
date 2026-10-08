-- Printer P3.1: bridge lifecycle only. No transport, historical enqueue, or test jobs.
-- Trusted Edge Functions create Auth users; PostgreSQL never holds their passwords.

alter table public.print_agents
  add column bridge_version text,
  add column platform text,
  add column last_heartbeat_at timestamptz;
alter table public.print_agents
  add constraint print_agents_bridge_version_format check
    (bridge_version is null or bridge_version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+.-][A-Za-z0-9.-]+)?$'),
  add constraint print_agents_platform_allowed check
    (platform is null or platform in ('windows'));
create index print_agents_last_seen_idx on public.print_agents
  (restaurant_id, last_seen_at desc) where enabled and revoked_at is null;

alter table public.printer_connections add column windows_queue_name text;
alter table public.printer_connections add constraint printer_connections_windows_queue_shape check (
  windows_queue_name is null or
  (connection_type = 'usb' and length(btrim(windows_queue_name)) between 1 and 240
    and windows_queue_name !~ '[[:cntrl:]]')
);

create table public.print_bridge_pairings (
  id uuid primary key default gen_random_uuid(),
  code_digest bytea not null unique,
  proof_digest bytea not null unique,
  bridge_name text not null,
  status text not null default 'pending',
  restaurant_id uuid references public.restaurants(id) on delete restrict,
  approved_by_user_id uuid references auth.users(id) on delete restrict,
  agent_id uuid,
  agent_auth_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  redeeming_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failure_code text,
  constraint print_bridge_pairings_digest_shape check
    (octet_length(code_digest) = 32 and octet_length(proof_digest) = 32),
  constraint print_bridge_pairings_name_shape check (length(btrim(bridge_name)) between 1 and 120),
  constraint print_bridge_pairings_status_allowed check
    (status in ('pending','approved','redeeming','completed','expired','cancelled','failed')),
  constraint print_bridge_pairings_expiry_shape check
    (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint print_bridge_pairings_approval_shape check (
    (status = 'pending' and restaurant_id is null and approved_by_user_id is null
      and approved_at is null and redeeming_at is null and completed_at is null)
    or (status = 'expired' and completed_at is null)
    or (status = 'cancelled' and completed_at is null)
    or (status = 'failed' and completed_at is null)
    or (status in ('approved','redeeming','completed') and restaurant_id is not null
      and approved_by_user_id is not null and approved_at is not null)),
  constraint print_bridge_pairings_completion_shape check
    ((status = 'completed') = (completed_at is not null and agent_id is not null
      and agent_auth_user_id is not null)),
  constraint print_bridge_pairings_agent_tenant foreign key (restaurant_id, agent_id)
    references public.print_agents(restaurant_id,id) on delete restrict
);
create index print_bridge_pairings_expiry_idx on public.print_bridge_pairings
  (expires_at) where status in ('pending','approved','redeeming');
create index print_bridge_pairings_restaurant_idx on public.print_bridge_pairings
  (restaurant_id, created_at desc) where restaurant_id is not null;

create table public.print_bridge_pairing_events (
  id bigint generated always as identity primary key,
  pairing_id uuid not null references public.print_bridge_pairings(id) on delete restrict,
  restaurant_id uuid references public.restaurants(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (event_type in
    ('started','approved','redeeming','completed','expired','cancelled','failed')),
  occurred_at timestamptz not null default clock_timestamp(),
  failure_code text check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$')
);
create index print_bridge_pairing_events_trace_idx on public.print_bridge_pairing_events
  (pairing_id, occurred_at desc);
create index print_bridge_pairing_events_tenant_idx on public.print_bridge_pairing_events
  (restaurant_id, occurred_at desc) where restaurant_id is not null;

create table public.print_agent_lifecycle_events (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  agent_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (event_type in ('registered','revoked','printer_allowed','printer_removed')),
  printer_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint print_agent_lifecycle_agent_tenant foreign key (restaurant_id,agent_id)
    references public.print_agents(restaurant_id,id) on delete restrict,
  constraint print_agent_lifecycle_printer_tenant foreign key (restaurant_id,printer_id)
    references public.business_printers(restaurant_id,id) on delete restrict
);
create index print_agent_lifecycle_trace_idx on public.print_agent_lifecycle_events
  (restaurant_id, agent_id, occurred_at desc);

create table public.print_agent_printers (
  restaurant_id uuid not null,
  agent_id uuid not null,
  printer_id uuid not null,
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (restaurant_id,agent_id,printer_id),
  constraint print_agent_printers_agent_tenant foreign key (restaurant_id,agent_id)
    references public.print_agents(restaurant_id,id) on delete cascade,
  constraint print_agent_printers_printer_tenant foreign key (restaurant_id,printer_id)
    references public.business_printers(restaurant_id,id) on delete restrict
);
create index print_agent_printers_printer_idx on public.print_agent_printers
  (restaurant_id,printer_id,agent_id) where enabled;

create table public.print_printer_observations (
  restaurant_id uuid not null,
  agent_id uuid not null,
  printer_id uuid not null,
  status text not null check (status in ('reachable','unreachable','unknown')),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  observed_at timestamptz not null default clock_timestamp(),
  last_transport_accepted_at timestamptz,
  primary key (restaurant_id,agent_id,printer_id),
  constraint print_printer_observations_affinity foreign key (restaurant_id,agent_id,printer_id)
    references public.print_agent_printers(restaurant_id,agent_id,printer_id) on delete cascade
);
create index print_printer_observations_recent_idx on public.print_printer_observations
  (restaurant_id,printer_id,observed_at desc);

alter table public.print_bridge_pairings enable row level security;
alter table public.print_bridge_pairings force row level security;
alter table public.print_bridge_pairing_events enable row level security;
alter table public.print_bridge_pairing_events force row level security;
alter table public.print_agent_lifecycle_events enable row level security;
alter table public.print_agent_lifecycle_events force row level security;
alter table public.print_agent_printers enable row level security;
alter table public.print_agent_printers force row level security;
alter table public.print_printer_observations enable row level security;
alter table public.print_printer_observations force row level security;
revoke all on public.print_bridge_pairings,public.print_bridge_pairing_events,
  public.print_agent_lifecycle_events,public.print_agent_printers,
  public.print_printer_observations from public,anon,authenticated;
grant all on public.print_bridge_pairings,public.print_bridge_pairing_events,
  public.print_agent_lifecycle_events,public.print_agent_printers,
  public.print_printer_observations to service_role;
revoke all on sequence public.print_bridge_pairing_events_id_seq,
  public.print_agent_lifecycle_events_id_seq from public,anon,authenticated;
grant usage,select on sequence public.print_bridge_pairing_events_id_seq,
  public.print_agent_lifecycle_events_id_seq to service_role;

-- Every pairing RPC is service-only. The Edge Function validates the bridge
-- proof and caller identity, applies rate limits, and creates Auth users.
create function public.begin_print_bridge_pairing(
  requested_code_digest bytea, requested_proof_digest bytea,
  requested_bridge_name text, requested_ttl_seconds integer default 300
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare pair_id uuid;
begin
  if octet_length(requested_code_digest) <> 32 or octet_length(requested_proof_digest) <> 32
    or length(btrim(coalesce(requested_bridge_name,''))) not between 1 and 120
    or requested_ttl_seconds not between 60 and 600 then
    raise exception 'Invalid print bridge pairing request.';
  end if;
  insert into public.print_bridge_pairings
    (code_digest,proof_digest,bridge_name,expires_at)
  values (requested_code_digest,requested_proof_digest,btrim(requested_bridge_name),
    clock_timestamp()+make_interval(secs=>requested_ttl_seconds)) returning id into pair_id;
  insert into public.print_bridge_pairing_events(pairing_id,event_type)
  values(pair_id,'started');
  return pair_id;
end; $$;

create function public.owner_set_print_agent_printer(
  target_restaurant_id uuid, target_agent_id uuid, target_printer_id uuid,
  requested_enabled boolean
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents; printer public.business_printers;
begin
  if not exists (select 1 from public.restaurant_staff staff
    where staff.restaurant_id=target_restaurant_id and staff.user_id=auth.uid()
      and staff.active and staff.role::text='owner') then
    raise exception 'An active restaurant owner is required.';
  end if;
  -- Claim takes the same agent row lock, serializing changes in authorization.
  select * into agent from public.print_agents
    where id=target_agent_id and restaurant_id=target_restaurant_id for update;
  if agent.id is null or not agent.enabled or agent.revoked_at is not null then
    raise exception 'Active print agent not found for restaurant.';
  end if;
  select * into printer from public.business_printers
    where id=target_printer_id and restaurant_id=target_restaurant_id
      and enabled and deleted_at is null;
  if printer.id is null then raise exception 'Active printer not found for restaurant.'; end if;
  if requested_enabled is null then raise exception 'Printer authorization choice required.'; end if;
  insert into public.print_agent_printers(restaurant_id,agent_id,printer_id,enabled)
  values(target_restaurant_id,agent.id,printer.id,requested_enabled)
  on conflict (restaurant_id,agent_id,printer_id) do update
    set enabled=excluded.enabled,updated_at=clock_timestamp();
  insert into public.print_agent_lifecycle_events
    (restaurant_id,agent_id,actor_user_id,event_type,printer_id)
  values(target_restaurant_id,agent.id,auth.uid(),
    case when requested_enabled then 'printer_allowed' else 'printer_removed' end,printer.id);
end; $$;

create function public.owner_revoke_print_agent(
  target_restaurant_id uuid, target_agent_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents;
begin
  if not exists (select 1 from public.restaurant_staff staff
    where staff.restaurant_id=target_restaurant_id and staff.user_id=auth.uid()
      and staff.active and staff.role::text='owner') then
    raise exception 'An active restaurant owner is required.';
  end if;
  select * into agent from public.print_agents
    where id=target_agent_id and restaurant_id=target_restaurant_id for update;
  if agent.id is null then raise exception 'Print agent not found for restaurant.'; end if;
  if agent.revoked_at is not null then return; end if;
  perform public.revoke_print_agent(agent.id);
  insert into public.print_agent_lifecycle_events
    (restaurant_id,agent_id,actor_user_id,event_type)
  values(target_restaurant_id,agent.id,auth.uid(),'revoked');
  -- Existing claims are left intact until their lease expires. P2 denies this
  -- agent connection lookup and acknowledgement immediately after revocation.
end; $$;

create or replace function public.claim_print_jobs(
  target_restaurant_id uuid, requested_limit integer default 10,
  requested_lease_seconds integer default 60
) returns table (
  job_id uuid, attempt_id uuid, attempt_number integer, job_type text,
  printer_purpose text, target_printer_id uuid, payload_version integer,
  template_id uuid, template_version integer, payload jsonb, claim_expires_at timestamptz
) language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents;
begin
  if auth.uid() is null then raise exception 'Print agent authentication is required.'; end if;
  if requested_limit not between 1 and 50 then raise exception 'Claim limit must be between 1 and 50.'; end if;
  if requested_lease_seconds not between 15 and 300 then raise exception 'Lease must be between 15 and 300 seconds.'; end if;
  -- Lock agent to serialize claim with Owner affinity/revocation changes.
  select * into agent from public.print_agents agents
  where agents.auth_user_id = auth.uid() and agents.restaurant_id = target_restaurant_id
    and agents.enabled and agents.revoked_at is null for update;
  if agent.id is null then raise exception 'Registered print agent access is required for this restaurant.'; end if;

  with expired as (
    update public.print_jobs jobs set status = 'pending', claimed_at = null,
      claim_expires_at = null, claimed_by_agent_id = null,
      available_at = clock_timestamp(), last_error_code = 'LEASE_EXPIRED',
      last_error_message = 'The prior agent lease expired before acknowledgement.',
      updated_at = clock_timestamp()
    where jobs.restaurant_id = target_restaurant_id and jobs.status = 'claimed'
      and jobs.claim_expires_at <= clock_timestamp()
    returning jobs.id, jobs.attempt_count
  )
  update public.print_job_attempts attempts set outcome = 'lease_expired',
    completed_at = clock_timestamp(), error_code = 'LEASE_EXPIRED',
    error_message = 'The agent did not acknowledge before the lease expired.'
  from expired where attempts.restaurant_id = target_restaurant_id
    and attempts.print_job_id = expired.id and attempts.attempt_number = expired.attempt_count
    and attempts.outcome = 'started';

  return query
  with candidates as (
    select jobs.id from public.print_jobs jobs
    join public.print_agent_printers affinity
      on affinity.restaurant_id=jobs.restaurant_id and affinity.printer_id=jobs.target_printer_id
      and affinity.agent_id=agent.id and affinity.enabled
    join public.business_printers printers
      on printers.restaurant_id=jobs.restaurant_id and printers.id=jobs.target_printer_id
      and printers.enabled and printers.deleted_at is null
    where jobs.restaurant_id = target_restaurant_id and jobs.status = 'pending'
      and jobs.dispatch_mode = 'automatic' and jobs.target_printer_id is not null
      and jobs.available_at <= clock_timestamp()
    order by jobs.priority, jobs.available_at, jobs.created_at, jobs.id
    for update of jobs skip locked limit requested_limit
  ), claimed as (
    update public.print_jobs jobs set status = 'claimed',
      attempt_count = jobs.attempt_count + 1, claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + make_interval(secs => requested_lease_seconds),
      claimed_by_agent_id = agent.id, last_error_code = null,
      last_error_message = null, updated_at = clock_timestamp()
    from candidates where jobs.id = candidates.id returning jobs.*
  ), attempts as (
    insert into public.print_job_attempts (
      restaurant_id, print_job_id, agent_id, attempt_number, claimed_at, lease_expires_at
    ) select claimed.restaurant_id, claimed.id, agent.id, claimed.attempt_count,
      claimed.claimed_at, claimed.claim_expires_at from claimed
    returning id, print_job_id
  )
  select claimed.id, attempts.id, claimed.attempt_count, claimed.job_type,
    claimed.printer_purpose, claimed.target_printer_id, claimed.payload_version,
    claimed.template_id, claimed.template_version, claimed.payload, claimed.claim_expires_at
  from claimed join attempts on attempts.print_job_id = claimed.id;

  update public.print_agents set last_seen_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = agent.id;
end; $$;

create or replace function public.get_claimed_print_job_connection(target_job_id uuid)
returns table (
  printer_id uuid, connection_type text, usb_vendor_id text, usb_product_id text,
  network_host inet, network_port integer, connection_options jsonb
) language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents;
begin
  select * into agent from public.print_agents agents
  where agents.auth_user_id = auth.uid() and agents.enabled and agents.revoked_at is null
  limit 1 for share;
  if agent.id is null then raise exception 'Registered print agent access is required.'; end if;
  return query select printers.id, connections.connection_type, connections.usb_vendor_id,
    connections.usb_product_id, connections.network_host, connections.network_port,
    connections.connection_options
  from public.print_jobs jobs
  join public.print_agent_printers affinity on affinity.restaurant_id=jobs.restaurant_id
    and affinity.agent_id=agent.id and affinity.printer_id=jobs.target_printer_id and affinity.enabled
  join public.business_printers printers on printers.restaurant_id = jobs.restaurant_id
    and printers.id = jobs.target_printer_id and printers.enabled and printers.deleted_at is null
  join public.printer_connections connections on connections.restaurant_id = printers.restaurant_id
    and connections.printer_id = printers.id and connections.active and connections.deleted_at is null
  where jobs.id = target_job_id and jobs.restaurant_id = agent.restaurant_id
    and jobs.status = 'claimed' and jobs.claimed_by_agent_id = agent.id
    and jobs.claim_expires_at > clock_timestamp()
  order by connections.created_at, connections.id limit 1;
end; $$;

create function public.get_claimed_print_job_connection_v2(target_job_id uuid)
returns table (
  printer_id uuid, connection_type text, usb_vendor_id text, usb_product_id text,
  network_host inet, network_port integer, windows_queue_name text, connection_options jsonb
) language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents;
begin
  select * into agent from public.print_agents agents
  where agents.auth_user_id = auth.uid() and agents.enabled and agents.revoked_at is null
  limit 1 for share;
  if agent.id is null then raise exception 'Registered print agent access is required.'; end if;
  return query select printers.id, connections.connection_type, connections.usb_vendor_id,
    connections.usb_product_id, connections.network_host, connections.network_port,
    connections.windows_queue_name, connections.connection_options
  from public.print_jobs jobs
  join public.print_agent_printers affinity on affinity.restaurant_id=jobs.restaurant_id
    and affinity.agent_id=agent.id and affinity.printer_id=jobs.target_printer_id and affinity.enabled
  join public.business_printers printers on printers.restaurant_id = jobs.restaurant_id
    and printers.id = jobs.target_printer_id and printers.enabled and printers.deleted_at is null
  join public.printer_connections connections on connections.restaurant_id = printers.restaurant_id
    and connections.printer_id = printers.id and connections.active and connections.deleted_at is null
  where jobs.id = target_job_id and jobs.restaurant_id = agent.restaurant_id
    and jobs.status = 'claimed' and jobs.claimed_by_agent_id = agent.id
    and jobs.claim_expires_at > clock_timestamp()
  order by connections.created_at, connections.id limit 1;
end; $$;

create function public.renew_print_job_lease(
  target_job_id uuid, target_attempt_id uuid, requested_seconds integer
) returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents; job public.print_jobs; attempt public.print_job_attempts;
  new_expiry timestamptz;
begin
  if requested_seconds not between 15 and 300 then raise exception 'Lease renewal must be 15 to 300 seconds.'; end if;
  select * into agent from public.print_agents agents
    where agents.auth_user_id=auth.uid() and agents.enabled and agents.revoked_at is null for update;
  if agent.id is null then raise exception 'Registered print agent access is required.'; end if;
  select * into job from public.print_jobs jobs where jobs.id=target_job_id for update;
  if job.id is null or job.restaurant_id <> agent.restaurant_id
    or job.status <> 'claimed' or job.claimed_by_agent_id <> agent.id
    or job.claim_expires_at <= clock_timestamp() then
    raise exception 'Active owned print lease required.';
  end if;
  if not exists (select 1 from public.print_agent_printers affinity
    where affinity.restaurant_id=agent.restaurant_id and affinity.agent_id=agent.id
      and affinity.printer_id=job.target_printer_id and affinity.enabled) then
    raise exception 'Printer authorization is no longer active.';
  end if;
  select * into attempt from public.print_job_attempts attempts
    where attempts.id=target_attempt_id and attempts.restaurant_id=agent.restaurant_id
      and attempts.print_job_id=job.id and attempts.agent_id=agent.id
      and attempts.attempt_number=job.attempt_count and attempts.outcome='started' for update;
  if attempt.id is null then raise exception 'Active print attempt required.'; end if;
  if job.claimed_at + interval '10 minutes' <= clock_timestamp() then
    raise exception 'Maximum print lease lifetime exceeded.';
  end if;
  new_expiry := least(clock_timestamp()+make_interval(secs=>requested_seconds),
    job.claimed_at+interval '10 minutes');
  if new_expiry < job.claim_expires_at then new_expiry := job.claim_expires_at; end if;
  update public.print_jobs set claim_expires_at=new_expiry,updated_at=clock_timestamp()
    where id=job.id;
  update public.print_job_attempts set lease_expires_at=new_expiry where id=attempt.id;
  return new_expiry;
end; $$;

create function public.heartbeat_print_agent(
  target_restaurant_id uuid, reported_bridge_version text, reported_platform text
) returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents; observed timestamptz := clock_timestamp();
begin
  if reported_bridge_version is null or
    reported_bridge_version !~ '^[0-9]+\.[0-9]+\.[0-9]+([+.-][A-Za-z0-9.-]+)?$'
    or length(reported_bridge_version)>64 or reported_platform <> 'windows' then
    raise exception 'Valid bridge version and platform required.';
  end if;
  select * into agent from public.print_agents agents
    where agents.auth_user_id=auth.uid() and agents.restaurant_id=target_restaurant_id
      and agents.enabled and agents.revoked_at is null for update;
  if agent.id is null then raise exception 'Registered print agent access is required.'; end if;
  update public.print_agents set bridge_version=reported_bridge_version,platform=reported_platform,
    last_seen_at=observed,last_heartbeat_at=observed,updated_at=observed where id=agent.id;
  return observed;
end; $$;

create function public.report_print_printer_observation(
  target_printer_id uuid, reported_status text, reported_error_code text default null,
  transport_accepted boolean default false
) returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents; observed timestamptz := clock_timestamp();
begin
  if reported_status not in ('reachable','unreachable','unknown')
    or (reported_error_code is not null and
      reported_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$')
    or transport_accepted is null then
    raise exception 'Valid structured printer observation required.';
  end if;
  select * into agent from public.print_agents agents
    where agents.auth_user_id=auth.uid() and agents.enabled and agents.revoked_at is null
    for update;
  if agent.id is null then raise exception 'Registered print agent access is required.'; end if;
  if not exists (select 1 from public.print_agent_printers affinity
    join public.business_printers printers on printers.restaurant_id=affinity.restaurant_id
      and printers.id=affinity.printer_id and printers.enabled and printers.deleted_at is null
    where affinity.restaurant_id=agent.restaurant_id and affinity.agent_id=agent.id
      and affinity.printer_id=target_printer_id and affinity.enabled) then
    raise exception 'Authorized printer required for observation.';
  end if;
  insert into public.print_printer_observations
    (restaurant_id,agent_id,printer_id,status,error_code,observed_at,last_transport_accepted_at)
  values(agent.restaurant_id,agent.id,target_printer_id,reported_status,reported_error_code,
    observed,case when transport_accepted then observed else null end)
  on conflict (restaurant_id,agent_id,printer_id) do update set
    status=excluded.status,error_code=excluded.error_code,observed_at=excluded.observed_at,
    last_transport_accepted_at=coalesce(excluded.last_transport_accepted_at,
      public.print_printer_observations.last_transport_accepted_at);
  return observed;
end; $$;

create function public.approve_print_bridge_pairing(
  target_pairing_id uuid, supplied_code_digest bytea,
  target_restaurant_id uuid, verified_owner_user_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare pair public.print_bridge_pairings;
begin
  select * into pair from public.print_bridge_pairings where id=target_pairing_id for update;
  if pair.id is null or pair.status <> 'pending' or pair.expires_at <= clock_timestamp()
    or pair.code_digest is distinct from supplied_code_digest then
    raise exception 'Print bridge pairing is unavailable.';
  end if;
  if not exists (select 1 from public.restaurant_staff staff
    where staff.restaurant_id=target_restaurant_id and staff.user_id=verified_owner_user_id
      and staff.active and staff.role::text='owner') then
    raise exception 'An active restaurant owner is required.';
  end if;
  update public.print_bridge_pairings set status='approved',restaurant_id=target_restaurant_id,
    approved_by_user_id=verified_owner_user_id,approved_at=clock_timestamp()
    where id=pair.id;
  insert into public.print_bridge_pairing_events
    (pairing_id,restaurant_id,actor_user_id,event_type)
  values(pair.id,target_restaurant_id,verified_owner_user_id,'approved');
  return pair.id;
end; $$;

create function public.begin_print_bridge_redemption(
  target_pairing_id uuid, supplied_proof_digest bytea
) returns table(restaurant_id uuid, bridge_name text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare pair public.print_bridge_pairings;
begin
  select * into pair from public.print_bridge_pairings where id=target_pairing_id for update;
  if pair.id is null or pair.status <> 'approved' or pair.expires_at <= clock_timestamp()
    or pair.proof_digest is distinct from supplied_proof_digest then
    raise exception 'Print bridge pairing is unavailable.';
  end if;
  update public.print_bridge_pairings set status='redeeming',redeeming_at=clock_timestamp()
    where id=pair.id;
  insert into public.print_bridge_pairing_events(pairing_id,restaurant_id,event_type)
  values(pair.id,pair.restaurant_id,'redeeming');
  return query select pair.restaurant_id,pair.bridge_name;
end; $$;

create function public.complete_print_bridge_redemption(
  target_pairing_id uuid, target_auth_user_id uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare pair public.print_bridge_pairings; new_agent_id uuid;
begin
  select * into pair from public.print_bridge_pairings where id=target_pairing_id for update;
  if pair.status='completed' and pair.agent_auth_user_id=target_auth_user_id then
    return pair.agent_id;
  end if;
  if pair.id is null or pair.status <> 'redeeming' or pair.expires_at <= clock_timestamp()
    or target_auth_user_id is null then
    raise exception 'Print bridge pairing cannot be completed.';
  end if;
  new_agent_id := public.register_print_agent(pair.restaurant_id,target_auth_user_id,pair.bridge_name);
  update public.print_bridge_pairings set status='completed',agent_id=new_agent_id,
    agent_auth_user_id=target_auth_user_id,completed_at=clock_timestamp() where id=pair.id;
  insert into public.print_bridge_pairing_events
    (pairing_id,restaurant_id,event_type) values(pair.id,pair.restaurant_id,'completed');
  insert into public.print_agent_lifecycle_events
    (restaurant_id,agent_id,actor_user_id,event_type)
  values(pair.restaurant_id,new_agent_id,pair.approved_by_user_id,'registered');
  return new_agent_id;
end; $$;

create function public.cancel_print_bridge_pairing(
  target_pairing_id uuid, target_restaurant_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare pair public.print_bridge_pairings;
begin
  if not exists (select 1 from public.restaurant_staff staff
    where staff.restaurant_id=target_restaurant_id and staff.user_id=auth.uid()
      and staff.active and staff.role::text='owner') then
    raise exception 'An active restaurant owner is required.';
  end if;
  select * into pair from public.print_bridge_pairings where id=target_pairing_id for update;
  if pair.id is null or pair.restaurant_id <> target_restaurant_id
    or pair.status not in ('approved','redeeming') then
    raise exception 'Print bridge pairing cannot be cancelled.';
  end if;
  update public.print_bridge_pairings set status='cancelled',cancelled_at=clock_timestamp()
    where id=pair.id;
  insert into public.print_bridge_pairing_events
    (pairing_id,restaurant_id,actor_user_id,event_type)
  values(pair.id,target_restaurant_id,auth.uid(),'cancelled');
end; $$;

create function public.expire_print_bridge_pairing(target_pairing_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare pair public.print_bridge_pairings;
begin
  select * into pair from public.print_bridge_pairings where id=target_pairing_id for update;
  if pair.id is null or pair.status not in ('pending','approved','redeeming')
    or pair.expires_at > clock_timestamp() then
    raise exception 'Print bridge pairing is not expired.';
  end if;
  update public.print_bridge_pairings set status='expired' where id=pair.id;
  insert into public.print_bridge_pairing_events(pairing_id,restaurant_id,event_type)
  values(pair.id,pair.restaurant_id,'expired');
end; $$;

create function public.fail_print_bridge_redemption(target_pairing_id uuid, reported_code text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare pair public.print_bridge_pairings;
begin
  if reported_code is null or reported_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception 'Structured failure code required.';
  end if;
  select * into pair from public.print_bridge_pairings where id=target_pairing_id for update;
  if pair.id is null or pair.status <> 'redeeming' then
    raise exception 'Print bridge pairing is not redeeming.';
  end if;
  update public.print_bridge_pairings set status='failed',failure_code=reported_code
    where id=pair.id;
  insert into public.print_bridge_pairing_events
    (pairing_id,restaurant_id,event_type,failure_code)
  values(pair.id,pair.restaurant_id,'failed',reported_code);
end; $$;

-- Preserve P2 acknowledgement semantics, adding an agent row lock so Owner
-- revocation and acknowledgement have one serial order.
create or replace function public.acknowledge_print_job(
  target_job_id uuid, target_attempt_id uuid, reported_outcome text,
  reported_error_code text default null, reported_error_message text default null,
  retry_after_seconds integer default 30
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare agent public.print_agents; target_job public.print_jobs; target_attempt public.print_job_attempts;
begin
  select * into agent from public.print_agents agents
  where agents.auth_user_id = auth.uid() and agents.enabled and agents.revoked_at is null
  limit 1 for share;
  if agent.id is null then raise exception 'Registered print agent access is required.'; end if;
  if reported_outcome not in ('dispatched','retryable_failure','terminal_failure') then
    raise exception 'Unsupported print acknowledgement outcome.';
  end if;
  if reported_outcome <> 'dispatched' and coalesce(reported_error_code, '') !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception 'A structured error code is required for failed attempts.';
  end if;
  if retry_after_seconds not between 5 and 3600 then raise exception 'Retry delay must be between 5 and 3600 seconds.'; end if;

  select * into target_job from public.print_jobs jobs where jobs.id = target_job_id for update;
  if target_job.id is null or target_job.restaurant_id <> agent.restaurant_id then
    raise exception 'Print job not found for this agent tenant.';
  end if;
  if target_job.status <> 'claimed' or target_job.claimed_by_agent_id <> agent.id
    or target_job.claim_expires_at <= clock_timestamp() then
    raise exception 'The print job does not have an active lease owned by this agent.';
  end if;
  select * into target_attempt from public.print_job_attempts attempts
  where attempts.id = target_attempt_id and attempts.restaurant_id = agent.restaurant_id
    and attempts.print_job_id = target_job.id and attempts.agent_id = agent.id
    and attempts.attempt_number = target_job.attempt_count and attempts.outcome = 'started' for update;
  if target_attempt.id is null then raise exception 'Active print attempt not found.'; end if;

  update public.print_job_attempts set outcome = reported_outcome,
    completed_at = clock_timestamp(), error_code = case when reported_outcome = 'dispatched' then null else reported_error_code end,
    error_message = case when reported_outcome = 'dispatched' then null else left(reported_error_message, 1000) end
  where id = target_attempt.id;

  if reported_outcome = 'dispatched' then
    update public.print_jobs set status = 'dispatched', dispatched_at = clock_timestamp(),
      acknowledged_at = clock_timestamp(), claimed_at = null, claim_expires_at = null,
      claimed_by_agent_id = null, last_error_code = null, last_error_message = null,
      updated_at = clock_timestamp() where id = target_job.id;
  elsif reported_outcome = 'retryable_failure' then
    update public.print_jobs set status = 'pending', available_at = clock_timestamp() + make_interval(secs => retry_after_seconds),
      claimed_at = null, claim_expires_at = null, claimed_by_agent_id = null,
      last_error_code = reported_error_code, last_error_message = left(reported_error_message, 1000),
      updated_at = clock_timestamp() where id = target_job.id;
  else
    update public.print_jobs set status = 'failed', claimed_at = null, claim_expires_at = null,
      claimed_by_agent_id = null, last_error_code = reported_error_code,
      last_error_message = left(reported_error_message, 1000), updated_at = clock_timestamp()
    where id = target_job.id;
  end if;
  return jsonb_build_object('job_id', target_job.id, 'attempt_id', target_attempt.id,
    'status', case reported_outcome when 'dispatched' then 'dispatched'
      when 'retryable_failure' then 'pending' else 'failed' end,
    'paper_output_confirmed', false);
end; $$;

revoke all on function public.begin_print_bridge_pairing(bytea,bytea,text,integer),
  public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid),
  public.begin_print_bridge_redemption(uuid,bytea),
  public.complete_print_bridge_redemption(uuid,uuid),
  public.expire_print_bridge_pairing(uuid),
  public.fail_print_bridge_redemption(uuid,text)
  from public,anon,authenticated;
grant execute on function public.begin_print_bridge_pairing(bytea,bytea,text,integer),
  public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid),
  public.begin_print_bridge_redemption(uuid,bytea),
  public.complete_print_bridge_redemption(uuid,uuid),
  public.expire_print_bridge_pairing(uuid),
  public.fail_print_bridge_redemption(uuid,text)
  to service_role;

revoke all on function public.cancel_print_bridge_pairing(uuid,uuid),
  public.owner_set_print_agent_printer(uuid,uuid,uuid,boolean),
  public.owner_revoke_print_agent(uuid,uuid),
  public.renew_print_job_lease(uuid,uuid,integer),
  public.heartbeat_print_agent(uuid,text,text),
  public.report_print_printer_observation(uuid,text,text,boolean),
  public.get_claimed_print_job_connection_v2(uuid)
  from public,anon;
grant execute on function public.cancel_print_bridge_pairing(uuid,uuid),
  public.owner_set_print_agent_printer(uuid,uuid,uuid,boolean),
  public.owner_revoke_print_agent(uuid,uuid),
  public.renew_print_job_lease(uuid,uuid,integer),
  public.heartbeat_print_agent(uuid,text,text),
  public.report_print_printer_observation(uuid,text,text,boolean),
  public.get_claimed_print_job_connection_v2(uuid)
  to authenticated,service_role;

revoke all on function public.claim_print_jobs(uuid,integer,integer),
  public.get_claimed_print_job_connection(uuid),
  public.acknowledge_print_job(uuid,uuid,text,text,text,integer)
  from public,anon;
grant execute on function public.claim_print_jobs(uuid,integer,integer),
  public.get_claimed_print_job_connection(uuid),
  public.acknowledge_print_job(uuid,uuid,text,text,text,integer)
  to authenticated,service_role;
