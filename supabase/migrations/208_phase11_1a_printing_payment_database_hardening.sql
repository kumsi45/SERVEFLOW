-- Phase 11.1A: final V1 hardening of the printing and payment foundation.
-- Database configuration only; no printer or payment runtime is introduced.

-- The Phase 11.1 printer_role column is the printer's purpose authority. Rename
-- it instead of adding a second column with overlapping meaning.
alter table public.business_printers
  drop constraint if exists business_printers_role_allowed;

alter table public.business_printers
  rename column printer_role to purpose;

drop index if exists public.business_printers_one_active_receipt_role_idx;

alter table public.business_printers
  add column if not exists brand text not null default 'Generic',
  add column if not exists model text,
  add column if not exists is_default boolean not null default false,
  add column if not exists priority integer not null default 100,
  add column if not exists backup_for_purpose text,
  add column if not exists physical_location text;

alter table public.business_printers
  drop constraint if exists business_printers_purpose_allowed,
  add constraint business_printers_purpose_allowed
    check (purpose in ('receipt', 'kitchen_order', 'station', 'backup', 'future', 'kds')),
  drop constraint if exists business_printers_brand_not_blank,
  add constraint business_printers_brand_not_blank
    check (length(btrim(brand)) between 1 and 80),
  drop constraint if exists business_printers_model_length,
  add constraint business_printers_model_length
    check (model is null or length(btrim(model)) between 1 and 120),
  drop constraint if exists business_printers_priority_range,
  add constraint business_printers_priority_range
    check (priority between 1 and 10000),
  drop constraint if exists business_printers_default_valid,
  add constraint business_printers_default_valid
    check (
      not is_default
      or (purpose in ('receipt', 'kitchen_order', 'station') and enabled and deleted_at is null)
    ),
  drop constraint if exists business_printers_backup_target_valid,
  add constraint business_printers_backup_target_valid
    check (
      (purpose = 'backup' and backup_for_purpose in ('receipt', 'kitchen_order', 'station'))
      or (purpose <> 'backup' and backup_for_purpose is null)
    ),
  drop constraint if exists business_printers_location_length,
  add constraint business_printers_location_length
    check (physical_location is null or length(btrim(physical_location)) between 1 and 160);

create unique index if not exists business_printers_one_default_purpose_idx
  on public.business_printers(restaurant_id, purpose)
  where is_default and enabled and deleted_at is null
    and purpose in ('receipt', 'kitchen_order', 'station');

create index if not exists business_printers_failover_priority_idx
  on public.business_printers(restaurant_id, purpose, priority, id)
  where enabled and deleted_at is null;

create index if not exists business_printers_backup_target_idx
  on public.business_printers(restaurant_id, backup_for_purpose, priority)
  where purpose = 'backup' and enabled and deleted_at is null;

-- Keep station mappings tied to the single printer-purpose authority.
create or replace function public.validate_phase11_station_printer_mapping()
returns trigger language plpgsql set search_path = public as $$
declare assigned_printer public.business_printers;
begin
  select * into assigned_printer
  from public.business_printers
  where restaurant_id = new.restaurant_id and id = new.printer_id;
  if assigned_printer.id is null then raise exception 'Printer does not belong to this business.'; end if;
  if assigned_printer.purpose <> 'station' then raise exception 'Kitchen stations require a station printer.'; end if;
  if new.active and (not assigned_printer.enabled or assigned_printer.deleted_at is not null) then
    raise exception 'An active station mapping requires an enabled printer.';
  end if;
  return new;
end;
$$;

alter table public.business_payment_accounts
  add column if not exists qr_image_url text,
  add column if not exists instructions text;

alter table public.business_payment_accounts
  drop constraint if exists business_payment_accounts_qr_image_immutable_url,
  add constraint business_payment_accounts_qr_image_immutable_url
    check (
      qr_image_url is null
      or (
        qr_image_url ~ '^https://[^[:space:]]+$'
        and position('?' in qr_image_url) = 0
        and position('#' in qr_image_url) = 0
      )
    ),
  drop constraint if exists business_payment_accounts_instructions_length,
  add constraint business_payment_accounts_instructions_length
    check (instructions is null or length(instructions) <= 2000);

alter table public.business_payment_methods
  add column if not exists is_default boolean not null default false,
  add column if not exists cash_change_limit numeric(12,2);

alter table public.business_payment_methods
  drop constraint if exists business_payment_methods_default_enabled,
  add constraint business_payment_methods_default_enabled
    check (not is_default or enabled),
  drop constraint if exists business_payment_methods_cash_change_limit_valid,
  add constraint business_payment_methods_cash_change_limit_valid
    check (
      cash_change_limit is null
      or (method_code = 'cash' and cash_change_limit >= 0)
    );

create unique index if not exists business_payment_methods_one_default_idx
  on public.business_payment_methods(restaurant_id)
  where is_default and enabled;

-- Existing tenants default to Cash only when they do not already have a default.
update public.business_payment_methods methods
set is_default = true
where methods.method_code = 'cash'
  and methods.enabled
  and not exists (
    select 1 from public.business_payment_methods configured
    where configured.restaurant_id = methods.restaurant_id
      and configured.is_default
  );

create table if not exists public.printer_templates (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  immutable_key uuid not null default gen_random_uuid(),
  template_type text not null,
  name text not null,
  version integer not null default 1,
  placeholder_schema jsonb not null default '{}'::jsonb,
  branding_options jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (immutable_key),
  unique (restaurant_id, id),
  unique (restaurant_id, template_type, name, version),
  constraint printer_templates_type_allowed check (
    template_type in ('receipt', 'kitchen_ticket', 'station_ticket')
  ),
  constraint printer_templates_name_not_blank check (length(btrim(name)) between 1 and 120),
  constraint printer_templates_version_range check (version between 1 and 100000),
  constraint printer_templates_placeholder_object check (jsonb_typeof(placeholder_schema) = 'object'),
  constraint printer_templates_branding_object check (jsonb_typeof(branding_options) = 'object'),
  constraint printer_templates_default_active check (not is_default or (active and deleted_at is null))
);

create unique index if not exists printer_templates_one_default_type_idx
  on public.printer_templates(restaurant_id, template_type)
  where is_default and active and deleted_at is null;

create index if not exists printer_templates_tenant_active_idx
  on public.printer_templates(restaurant_id, template_type, updated_at desc)
  where active and deleted_at is null;

alter table public.printer_templates enable row level security;
revoke all on public.printer_templates from public, anon, authenticated;
grant select, insert, update on public.printer_templates to authenticated;

drop policy if exists printer_templates_owner_all on public.printer_templates;
create policy printer_templates_owner_all
on public.printer_templates for all to authenticated
using (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]))
with check (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]));

drop trigger if exists set_printer_templates_updated_at on public.printer_templates;
create trigger set_printer_templates_updated_at before update on public.printer_templates
for each row execute function public.set_phase11_foundation_updated_at();

drop trigger if exists protect_printer_templates_tenant on public.printer_templates;
create trigger protect_printer_templates_tenant before update on public.printer_templates
for each row execute function public.prevent_phase11_tenant_reassignment();

drop trigger if exists protect_printer_templates_immutable_key on public.printer_templates;
create trigger protect_printer_templates_immutable_key before update on public.printer_templates
for each row execute function public.prevent_phase11_immutable_key_change();

-- Future tenants must receive the same default-method semantics as existing ones.
create or replace function public.initialize_phase11_business_foundation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.business_printing_settings(restaurant_id) values (new.id)
  on conflict (restaurant_id) do nothing;
  insert into public.business_daily_closing_config(restaurant_id, timezone)
  values (new.id, coalesce(nullif(btrim(new.profile->>'timezone'), ''), 'Africa/Nairobi'))
  on conflict (restaurant_id) do nothing;
  insert into public.business_payment_methods(
    restaurant_id, method_code, display_name, enabled, is_default, display_order
  ) values
    (new.id,'cash','Cash',true,true,10),(new.id,'telebirr','Telebirr',false,false,20),
    (new.id,'cbe_birr','CBE Birr',false,false,30),(new.id,'mobile_banking','Mobile Banking',false,false,40),
    (new.id,'bank_transfer','Bank Transfer',false,false,50),(new.id,'credit_card','Credit Card',false,false,60)
  on conflict (restaurant_id, method_code) do nothing;
  return new;
end;
$$;

revoke all on function public.initialize_phase11_business_foundation() from public, anon, authenticated;

comment on column public.business_printers.purpose is 'Single printer-purpose authority: receipt, kitchen_order, station, backup, future, or kds.';
comment on column public.business_printers.priority is 'Lower values are preferred by a future failover runtime.';
comment on column public.business_payment_methods.enabled is 'Canonical Cash Accepted flag when method_code is cash.';
comment on column public.business_payment_accounts.qr_image_url is 'Immutable HTTPS storage URL without temporary query or fragment tokens.';
comment on table public.printer_templates is 'Tenant-private template metadata only; no rendering runtime is implemented.';
