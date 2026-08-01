-- Phase 11.1: tenant-isolated printing and payment configuration foundation.
-- Schema only. No printer, payment-provider, or runtime workflow is implemented here.

-- Extend the existing canonical restaurant financial authority. Do not create a
-- parallel policy/VAT/service-charge configuration source.
alter table public.restaurants
  add column if not exists vat_price_mode text not null default 'added_after_price',
  add column if not exists service_charge_mode text not null default 'percentage',
  add column if not exists service_charge_fixed_amount numeric(12,2) not null default 0,
  add column if not exists commission_enabled boolean not null default false,
  add column if not exists commission_percentage numeric(5,2) not null default 0;

alter table public.restaurants
  drop constraint if exists restaurants_payment_policy_allowed,
  add constraint restaurants_payment_policy_allowed
    check (payment_policy in ('pay_before_kitchen', 'kitchen_before_payment', 'mixed')),
  drop constraint if exists restaurants_vat_price_mode_allowed,
  add constraint restaurants_vat_price_mode_allowed
    check (vat_price_mode in ('included_in_price', 'added_after_price')),
  drop constraint if exists restaurants_service_charge_mode_allowed,
  add constraint restaurants_service_charge_mode_allowed
    check (service_charge_mode in ('percentage', 'fixed_amount')),
  drop constraint if exists restaurants_service_charge_fixed_amount_range,
  add constraint restaurants_service_charge_fixed_amount_range
    check (service_charge_fixed_amount >= 0),
  drop constraint if exists restaurants_commission_percentage_range,
  add constraint restaurants_commission_percentage_range
    check (commission_percentage between 0 and 100);

create table if not exists public.business_printing_settings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kitchen_output_mode text not null default 'kds',
  default_print_behaviour text not null default 'on_demand',
  print_order_copies integer not null default 1,
  print_receipt_copies integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id),
  unique (restaurant_id, id),
  constraint business_printing_output_mode_allowed check (
    kitchen_output_mode in ('single_kitchen_printer', 'station_printers', 'kds', 'kds_and_printers')
  ),
  constraint business_printing_behaviour_allowed check (
    default_print_behaviour in ('on_demand', 'automatic')
  ),
  constraint business_printing_order_copies_range check (print_order_copies between 1 and 10),
  constraint business_printing_receipt_copies_range check (print_receipt_copies between 1 and 10)
);

create table if not exists public.business_printers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  immutable_key uuid not null default gen_random_uuid(),
  name text not null,
  printer_role text not null,
  printer_type text not null default 'thermal',
  paper_size text not null default '80mm',
  status text not null default 'not_configured',
  enabled boolean not null default true,
  last_seen_at timestamptz,
  last_status_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (immutable_key),
  unique (restaurant_id, id),
  constraint business_printers_name_not_blank check (length(btrim(name)) > 0),
  constraint business_printers_role_allowed check (printer_role in ('receipt', 'kitchen_order', 'station')),
  constraint business_printers_type_allowed check (printer_type in ('thermal', 'impact', 'label', 'generic')),
  constraint business_printers_paper_size_allowed check (paper_size in ('58mm', '80mm', 'a4', 'custom')),
  constraint business_printers_status_allowed check (status in ('not_configured', 'offline', 'online', 'error', 'testing'))
);

create table if not exists public.printer_connections (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  printer_id uuid not null,
  connection_type text not null,
  usb_vendor_id text,
  usb_product_id text,
  network_host inet,
  network_port integer,
  connection_options jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (restaurant_id, id),
  constraint printer_connections_printer_same_tenant foreign key (restaurant_id, printer_id)
    references public.business_printers(restaurant_id, id) on delete cascade,
  constraint printer_connections_type_allowed check (connection_type in ('usb', 'network', 'bluetooth')),
  constraint printer_connections_network_port_range check (network_port is null or network_port between 1 and 65535),
  constraint printer_connections_shape check (
    (connection_type = 'network' and network_host is not null and network_port is not null)
    or (connection_type = 'usb' and network_host is null and network_port is null)
    or (connection_type = 'bluetooth' and network_host is null and network_port is null)
  )
);

create table if not exists public.printer_capabilities (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  printer_id uuid not null,
  capability_code text not null,
  supported boolean not null default true,
  capability_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, printer_id, capability_code),
  constraint printer_capabilities_printer_same_tenant foreign key (restaurant_id, printer_id)
    references public.business_printers(restaurant_id, id) on delete cascade,
  constraint printer_capabilities_code_not_blank check (length(btrim(capability_code)) > 0)
);

create table if not exists public.printer_station_mappings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kitchen_station_id uuid not null,
  printer_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (restaurant_id, id),
  constraint printer_station_mapping_station_same_tenant foreign key (restaurant_id, kitchen_station_id)
    references public.kitchen_stations(restaurant_id, id) on delete restrict,
  constraint printer_station_mapping_printer_same_tenant foreign key (restaurant_id, printer_id)
    references public.business_printers(restaurant_id, id) on delete restrict
);

create table if not exists public.printer_test_runs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  printer_id uuid not null,
  requested_by_staff_id uuid,
  status text not null default 'pending',
  diagnostic_message text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  constraint printer_test_printer_same_tenant foreign key (restaurant_id, printer_id)
    references public.business_printers(restaurant_id, id) on delete restrict,
  constraint printer_test_staff_same_tenant foreign key (restaurant_id, requested_by_staff_id)
    references public.restaurant_staff(restaurant_id, id) on delete set null (requested_by_staff_id),
  constraint printer_test_status_allowed check (status in ('pending', 'passed', 'failed', 'cancelled')),
  constraint printer_test_completion_valid check (
    (status = 'pending' and completed_at is null) or (status <> 'pending' and completed_at is not null)
  )
);

create table if not exists public.business_payment_methods (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  immutable_key uuid not null default gen_random_uuid(),
  method_code text not null,
  display_name text not null,
  enabled boolean not null default false,
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (immutable_key),
  unique (restaurant_id, id),
  unique (restaurant_id, method_code),
  constraint business_payment_method_code_allowed check (
    method_code in ('cash', 'telebirr', 'cbe_birr', 'mobile_banking', 'bank_transfer', 'credit_card')
  ),
  constraint business_payment_method_name_not_blank check (length(btrim(display_name)) > 0),
  constraint business_payment_method_order_range check (display_order between 0 and 10000)
);

create table if not exists public.business_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  immutable_key uuid not null default gen_random_uuid(),
  payment_method_id uuid not null,
  provider_code text not null,
  business_name text,
  account_name text,
  account_number text,
  phone_number text,
  reference_format text,
  qr_code text,
  status text not null default 'active',
  display_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (immutable_key),
  unique (restaurant_id, id),
  constraint business_payment_account_method_same_tenant foreign key (restaurant_id, payment_method_id)
    references public.business_payment_methods(restaurant_id, id) on delete restrict,
  constraint business_payment_account_provider_allowed check (
    provider_code in ('telebirr', 'commercial_bank_of_ethiopia', 'dashen', 'awash', 'other_bank')
  ),
  constraint business_payment_account_status_allowed check (status in ('active', 'inactive', 'suspended')),
  constraint business_payment_account_identity_present check (
    nullif(btrim(coalesce(account_number, '')), '') is not null
    or nullif(btrim(coalesce(phone_number, '')), '') is not null
  ),
  constraint business_payment_account_order_range check (display_order between 0 and 10000)
);

create table if not exists public.business_daily_closing_config (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  enabled boolean not null default false,
  closing_time time not null default '23:59',
  timezone text not null default 'Africa/Nairobi',
  reminder_enabled boolean not null default true,
  reminder_minutes_before integer not null default 30,
  require_cash_reconciliation boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id),
  unique (restaurant_id, id),
  constraint business_daily_closing_timezone_not_blank check (length(btrim(timezone)) > 0),
  constraint business_daily_closing_reminder_range check (reminder_minutes_before between 0 and 1440)
);

-- One active connection per printer and one active printer per station.
create unique index if not exists printer_connections_one_active_per_printer_idx
  on public.printer_connections(restaurant_id, printer_id)
  where active and deleted_at is null;
create unique index if not exists printer_station_mappings_one_active_station_idx
  on public.printer_station_mappings(restaurant_id, kitchen_station_id)
  where active and deleted_at is null;
create unique index if not exists business_printers_one_active_receipt_role_idx
  on public.business_printers(restaurant_id, printer_role)
  where enabled and deleted_at is null and printer_role in ('receipt', 'kitchen_order');

create index if not exists business_printers_tenant_status_idx
  on public.business_printers(restaurant_id, status) where deleted_at is null;
create index if not exists printer_connections_tenant_type_idx
  on public.printer_connections(restaurant_id, connection_type) where deleted_at is null;
create index if not exists printer_station_mappings_tenant_printer_idx
  on public.printer_station_mappings(restaurant_id, printer_id) where deleted_at is null;
create index if not exists printer_test_runs_tenant_requested_idx
  on public.printer_test_runs(restaurant_id, requested_at desc);
create index if not exists business_payment_methods_tenant_enabled_idx
  on public.business_payment_methods(restaurant_id, enabled, display_order);
create index if not exists business_payment_accounts_tenant_method_idx
  on public.business_payment_accounts(restaurant_id, payment_method_id, status) where deleted_at is null;

create or replace function public.set_phase11_foundation_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'business_printing_settings','business_printers','printer_connections',
    'printer_capabilities','printer_station_mappings','printer_test_runs','business_payment_methods',
    'business_payment_accounts','business_daily_closing_config'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_phase11_foundation_updated_at()', 'set_' || table_name || '_updated_at', table_name);
  end loop;
end $$;

create or replace function public.validate_phase11_station_printer_mapping()
returns trigger language plpgsql set search_path = public as $$
declare assigned_printer public.business_printers;
begin
  select * into assigned_printer
  from public.business_printers
  where restaurant_id = new.restaurant_id and id = new.printer_id;
  if assigned_printer.id is null then raise exception 'Printer does not belong to this business.'; end if;
  if assigned_printer.printer_role <> 'station' then raise exception 'Kitchen stations require a station printer.'; end if;
  if new.active and (not assigned_printer.enabled or assigned_printer.deleted_at is not null) then
    raise exception 'An active station mapping requires an enabled printer.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_phase11_station_printer_mapping on public.printer_station_mappings;
create trigger validate_phase11_station_printer_mapping
before insert or update of restaurant_id, printer_id, active, deleted_at
on public.printer_station_mappings for each row
execute function public.validate_phase11_station_printer_mapping();

create or replace function public.prevent_phase11_tenant_reassignment()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'Tenant ownership cannot be reassigned.';
  end if;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'business_printing_settings','business_printers','printer_connections',
    'printer_capabilities','printer_station_mappings','printer_test_runs','business_payment_methods',
    'business_payment_accounts','business_daily_closing_config'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'protect_' || table_name || '_tenant', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.prevent_phase11_tenant_reassignment()', 'protect_' || table_name || '_tenant', table_name);
  end loop;
end $$;

create or replace function public.prevent_phase11_immutable_key_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.immutable_key is distinct from old.immutable_key then
    raise exception 'Immutable identifier cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_business_printers_immutable_key on public.business_printers;
create trigger protect_business_printers_immutable_key before update on public.business_printers
for each row execute function public.prevent_phase11_immutable_key_change();
drop trigger if exists protect_business_payment_methods_immutable_key on public.business_payment_methods;
create trigger protect_business_payment_methods_immutable_key before update on public.business_payment_methods
for each row execute function public.prevent_phase11_immutable_key_change();
drop trigger if exists protect_business_payment_accounts_immutable_key on public.business_payment_accounts;
create trigger protect_business_payment_accounts_immutable_key before update on public.business_payment_accounts
for each row execute function public.prevent_phase11_immutable_key_change();

-- Every existing tenant receives its own V1 configuration and method catalog.
insert into public.business_printing_settings(restaurant_id)
select id from public.restaurants on conflict (restaurant_id) do nothing;

insert into public.business_daily_closing_config(restaurant_id, timezone)
select id, coalesce(nullif(btrim(profile->>'timezone'), ''), 'Africa/Nairobi')
from public.restaurants on conflict (restaurant_id) do nothing;

insert into public.business_payment_methods(restaurant_id, method_code, display_name, enabled, display_order)
select restaurants.id, methods.code, methods.name, methods.code = 'cash', methods.position
from public.restaurants
cross join (values
  ('cash','Cash',10),('telebirr','Telebirr',20),('cbe_birr','CBE Birr',30),
  ('mobile_banking','Mobile Banking',40),('bank_transfer','Bank Transfer',50),
  ('credit_card','Credit Card',60)
) as methods(code, name, position)
on conflict (restaurant_id, method_code) do nothing;

create or replace function public.initialize_phase11_business_foundation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.business_printing_settings(restaurant_id) values (new.id)
  on conflict (restaurant_id) do nothing;
  insert into public.business_daily_closing_config(restaurant_id, timezone)
  values (new.id, coalesce(nullif(btrim(new.profile->>'timezone'), ''), 'Africa/Nairobi'))
  on conflict (restaurant_id) do nothing;
  insert into public.business_payment_methods(restaurant_id, method_code, display_name, enabled, display_order)
  values
    (new.id,'cash','Cash',true,10),(new.id,'telebirr','Telebirr',false,20),
    (new.id,'cbe_birr','CBE Birr',false,30),(new.id,'mobile_banking','Mobile Banking',false,40),
    (new.id,'bank_transfer','Bank Transfer',false,50),(new.id,'credit_card','Credit Card',false,60)
  on conflict (restaurant_id, method_code) do nothing;
  return new;
end;
$$;

drop trigger if exists initialize_phase11_business_foundation on public.restaurants;
create trigger initialize_phase11_business_foundation
after insert on public.restaurants for each row
execute function public.initialize_phase11_business_foundation();

-- Private tenant configuration: active owners only. No anon/public access.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'business_printing_settings','business_printers','printer_connections',
    'printer_capabilities','printer_station_mappings','printer_test_runs',
    'business_payment_methods','business_payment_accounts','business_daily_closing_config'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update on public.%I to authenticated', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.has_staff_role(restaurant_id, array[''owner'']::public.restaurant_staff_role[])) with check (public.has_staff_role(restaurant_id, array[''owner'']::public.restaurant_staff_role[]))',
      table_name || '_owner_all', table_name
    );
  end loop;
end $$;

revoke all on function public.set_phase11_foundation_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_phase11_tenant_reassignment() from public, anon, authenticated;
revoke all on function public.prevent_phase11_immutable_key_change() from public, anon, authenticated;
revoke all on function public.validate_phase11_station_printer_mapping() from public, anon, authenticated;
revoke all on function public.initialize_phase11_business_foundation() from public, anon, authenticated;

comment on table public.business_printing_settings is 'One tenant-owned active kitchen output and print behaviour configuration.';
comment on table public.business_printers is 'Tenant-private printer registry; Bluetooth is schema-only for a future release.';
comment on table public.business_payment_accounts is 'Tenant-private settlement account metadata; never exposed to anonymous users.';
comment on column public.restaurants.payment_policy is 'Canonical policy: pay_before_kitchen, kitchen_before_payment, or future mixed placeholder.';
