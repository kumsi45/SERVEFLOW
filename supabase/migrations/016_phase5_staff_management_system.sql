-- SERVEFLOW Phase 5 staff management system.
-- Restaurant-scoped staff metadata, last-login tracking, and owner-visible audit log.

alter table public.restaurant_staff
  add column if not exists email text,
  add column if not exists last_login_at timestamptz;

create unique index if not exists restaurant_staff_restaurant_email_unique
on public.restaurant_staff (restaurant_id, lower(email))
where email is not null;

create index if not exists restaurant_staff_last_login_at_idx
on public.restaurant_staff (restaurant_id, last_login_at desc);

do $$
begin
  create type public.staff_activity_action as enum (
    'staff_created',
    'staff_deactivated',
    'staff_reactivated',
    'password_reset_sent',
    'temporary_password_generated',
    'role_changed',
    'staff_updated'
  );
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.staff_activity_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  action public.staff_activity_action not null,
  performed_by_staff_id uuid references public.restaurant_staff(id) on delete set null,
  target_staff_id uuid references public.restaurant_staff(id) on delete set null,
  target_staff_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists staff_activity_log_restaurant_created_idx
on public.staff_activity_log (restaurant_id, created_at desc);

create index if not exists staff_activity_log_target_staff_idx
on public.staff_activity_log (target_staff_id, created_at desc);

alter table public.staff_activity_log enable row level security;

grant select on public.staff_activity_log to authenticated;

drop policy if exists staff_activity_log_select_owner_same_restaurant on public.staff_activity_log;

create policy staff_activity_log_select_owner_same_restaurant
on public.staff_activity_log
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

create or replace function public.record_staff_login(target_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.restaurant_staff
  set last_login_at = now()
  where restaurant_id = target_restaurant_id
    and user_id = auth.uid()
    and active = true;

  if not found then
    raise exception 'Active staff membership not found for this restaurant.';
  end if;
end;
$$;

revoke all on function public.record_staff_login(uuid) from public;
grant execute on function public.record_staff_login(uuid) to authenticated;
