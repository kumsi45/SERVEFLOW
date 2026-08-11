-- Phase A1: tenant-scoped waiter PIN credentials and authentication throttling.
-- PIN material is never stored. Edge Functions store only a keyed HMAC
-- fingerprint produced with the server-only WAITER_PIN_PEPPER secret.

create table if not exists public.waiter_pin_credentials (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  staff_id uuid not null,
  pin_fingerprint text not null check (pin_fingerprint ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  failed_attempt_count integer not null default 0 check (failed_attempt_count >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waiter_pin_credentials_staff_fk
    foreign key (restaurant_id, staff_id)
    references public.restaurant_staff(restaurant_id, id)
    on delete cascade,
  constraint waiter_pin_credentials_staff_unique unique (restaurant_id, staff_id)
);

create unique index if not exists waiter_pin_credentials_active_pin_unique
on public.waiter_pin_credentials (restaurant_id, pin_fingerprint)
where active = true;

create index if not exists waiter_pin_credentials_active_lookup_idx
on public.waiter_pin_credentials (restaurant_id, pin_fingerprint, active);

create table if not exists public.waiter_pin_auth_events (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  credential_id uuid references public.waiter_pin_credentials(id) on delete set null,
  scope_fingerprint text not null check (scope_fingerprint ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('success', 'invalid', 'conflict', 'throttled')),
  created_at timestamptz not null default now()
);

create index if not exists waiter_pin_auth_events_scope_recent_idx
on public.waiter_pin_auth_events (restaurant_id, scope_fingerprint, created_at desc);

create index if not exists waiter_pin_auth_events_credential_recent_idx
on public.waiter_pin_auth_events (credential_id, created_at desc)
where credential_id is not null;

alter table public.waiter_pin_credentials enable row level security;
alter table public.waiter_pin_auth_events enable row level security;

revoke all on table public.waiter_pin_credentials from public, anon, authenticated;
revoke all on table public.waiter_pin_auth_events from public, anon, authenticated;
grant all on table public.waiter_pin_credentials to service_role;
grant all on table public.waiter_pin_auth_events to service_role;
grant usage, select on sequence public.waiter_pin_auth_events_id_seq to service_role;

comment on table public.waiter_pin_credentials is
  'Server-only tenant-scoped waiter PIN verifier records. pin_fingerprint is a keyed HMAC; plaintext PINs and reusable password hashes are never stored.';
comment on table public.waiter_pin_auth_events is
  'Server-only waiter PIN authentication audit and throttling events. Contains no PIN, auth email, token, or waiter name.';
