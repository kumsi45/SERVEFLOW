-- Transitional credential-readiness ledger for the privileged password cutover.
-- Authentication secrets remain exclusively in Supabase Auth / waiter credential storage.

create table if not exists public.staff_credential_readiness (
  restaurant_id uuid not null,
  staff_id uuid not null,
  readiness text not null,
  setup_requested_at timestamptz,
  ready_at timestamptz,
  updated_by_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_credential_readiness_pkey primary key (restaurant_id, staff_id),
  constraint staff_credential_readiness_staff_fk foreign key (restaurant_id, staff_id)
    references public.restaurant_staff(restaurant_id, id) on delete cascade,
  constraint staff_credential_readiness_actor_fk foreign key (restaurant_id, updated_by_staff_id)
    references public.restaurant_staff(restaurant_id, id),
  constraint staff_credential_readiness_state_check check (
    readiness in ('legacy_credential', 'reset_required', 'password_ready', 'waiter_pin_ready')
  ),
  constraint staff_credential_readiness_ready_time_check check (
    (readiness in ('password_ready', 'waiter_pin_ready') and ready_at is not null)
    or (readiness in ('legacy_credential', 'reset_required') and ready_at is null)
  )
);

create index if not exists staff_credential_readiness_tenant_state_idx
  on public.staff_credential_readiness(restaurant_id, readiness);

alter table public.staff_credential_readiness enable row level security;
alter table public.staff_credential_readiness force row level security;

drop policy if exists staff_credential_readiness_admin_read on public.staff_credential_readiness;
create policy staff_credential_readiness_admin_read
on public.staff_credential_readiness
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff actor
    where actor.user_id = auth.uid()
      and actor.restaurant_id = staff_credential_readiness.restaurant_id
      and actor.active = true
      and actor.role::text in ('owner', 'manager')
  )
);

revoke all on table public.staff_credential_readiness from public, anon, authenticated;
grant select on table public.staff_credential_readiness to authenticated;

create or replace function public.sync_staff_credential_readiness()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  next_readiness text;
  next_ready_at timestamptz;
  replace_existing boolean := false;
begin
  if new.active is not true
     or new.role::text not in ('manager', 'cashier', 'kitchen', 'inventory', 'inventory_officer', 'waiter') then
    return new;
  end if;

  if new.role::text = 'waiter' then
    if exists (
      select 1 from public.waiter_pin_credentials credential
      where credential.restaurant_id = new.restaurant_id
        and credential.staff_id = new.id
        and credential.active = true
    ) then
      next_readiness := 'waiter_pin_ready';
      next_ready_at := now();
    else
      next_readiness := 'reset_required';
      next_ready_at := null;
    end if;
  else
    next_readiness := 'legacy_credential';
    next_ready_at := null;
  end if;
  if tg_op = 'UPDATE' then
    replace_existing := old.role::text is distinct from new.role::text;
  end if;

  insert into public.staff_credential_readiness(
    restaurant_id, staff_id, readiness, ready_at, created_at, updated_at
  ) values (
    new.restaurant_id, new.id, next_readiness, next_ready_at, now(), now()
  )
  on conflict (restaurant_id, staff_id) do update set
    readiness = excluded.readiness,
    setup_requested_at = null,
    ready_at = excluded.ready_at,
    updated_by_staff_id = null,
    updated_at = now()
  where replace_existing;

  return new;
end;
$$;

drop trigger if exists sync_staff_credential_readiness on public.restaurant_staff;
create trigger sync_staff_credential_readiness
after insert or update of active, role
on public.restaurant_staff
for each row execute function public.sync_staff_credential_readiness();

insert into public.staff_credential_readiness(
  restaurant_id, staff_id, readiness, ready_at, created_at, updated_at
)
select
  staff.restaurant_id,
  staff.id,
  case
    when staff.role::text = 'waiter' and credential.staff_id is not null then 'waiter_pin_ready'
    when staff.role::text = 'waiter' then 'reset_required'
    else 'legacy_credential'
  end,
  case when staff.role::text = 'waiter' and credential.staff_id is not null then now() else null end,
  now(),
  now()
from public.restaurant_staff staff
left join public.waiter_pin_credentials credential
  on credential.restaurant_id = staff.restaurant_id
 and credential.staff_id = staff.id
 and credential.active = true
where staff.active = true
  and staff.role::text in ('manager', 'cashier', 'kitchen', 'inventory', 'inventory_officer', 'waiter')
on conflict (restaurant_id, staff_id) do nothing;

revoke all on function public.sync_staff_credential_readiness() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'staff_credential_readiness'
     ) then
    alter publication supabase_realtime add table public.staff_credential_readiness;
  end if;
end;
$$;
