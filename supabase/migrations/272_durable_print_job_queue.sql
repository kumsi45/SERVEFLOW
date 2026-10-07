-- Printer P2: durable, tenant-owned print jobs and future local-agent queue.
-- This migration does not implement physical transport. A dispatched job means
-- that an authenticated local agent accepted responsibility for the payload;
-- it does not prove that paper emerged from a printer.

create table public.print_queue_activations (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  activated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp()
);

create table public.print_agents (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint print_agents_restaurant_id_id_key unique (restaurant_id, id),
  constraint print_agents_auth_user_id_key unique (auth_user_id),
  constraint print_agents_name_not_blank check (length(btrim(name)) between 1 and 120),
  constraint print_agents_revocation_consistent check (enabled or revoked_at is not null)
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  job_type text not null,
  printer_purpose text not null,
  request_kind text not null default 'automatic',
  automatic_key text,
  order_id uuid not null,
  invoice_id uuid not null,
  kitchen_station_id uuid,
  kitchen_batch_key text,
  target_printer_id uuid,
  template_id uuid,
  template_version integer,
  payload_version integer not null default 1,
  payload jsonb not null,
  dispatch_mode text not null default 'automatic',
  status text not null default 'pending',
  priority integer not null default 100,
  attempt_count integer not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claimed_by_agent_id uuid,
  dispatched_at timestamptz,
  acknowledged_at timestamptz,
  last_error_code text,
  last_error_message text,
  original_job_id uuid,
  reprint_reason text,
  requested_by_staff_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint print_jobs_restaurant_id_id_key unique (restaurant_id, id),
  constraint print_jobs_job_type_allowed check (job_type in ('kitchen_ticket', 'receipt')),
  constraint print_jobs_printer_purpose_allowed check (printer_purpose in ('kitchen', 'cashier')),
  constraint print_jobs_request_kind_allowed check (request_kind in ('automatic', 'manual_reprint')),
  constraint print_jobs_dispatch_mode_allowed check (dispatch_mode in ('automatic', 'on_demand')),
  constraint print_jobs_status_allowed check (status in ('pending', 'claimed', 'dispatched', 'failed', 'cancelled')),
  constraint print_jobs_priority_range check (priority between 1 and 10000),
  constraint print_jobs_attempt_count_nonnegative check (attempt_count >= 0),
  constraint print_jobs_payload_version_positive check (payload_version > 0),
  constraint print_jobs_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint print_jobs_error_code_format check (last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint print_jobs_automatic_identity check (
    (request_kind = 'automatic' and automatic_key is not null and original_job_id is null
      and reprint_reason is null and requested_by_staff_id is null)
    or
    (request_kind = 'manual_reprint' and automatic_key is null and original_job_id is not null
      and length(btrim(reprint_reason)) between 1 and 500 and requested_by_staff_id is not null)
  ),
  constraint print_jobs_kitchen_shape check (
    (job_type = 'kitchen_ticket' and printer_purpose = 'kitchen'
      and kitchen_station_id is not null and kitchen_batch_key is not null)
    or
    (job_type = 'receipt' and printer_purpose = 'cashier'
      and kitchen_station_id is null and kitchen_batch_key is null)
  ),
  constraint print_jobs_claim_shape check (
    (status = 'claimed' and claimed_at is not null and claim_expires_at is not null
      and claimed_by_agent_id is not null and claim_expires_at > claimed_at)
    or
    (status <> 'claimed' and claimed_at is null and claim_expires_at is null
      and claimed_by_agent_id is null)
  ),
  constraint print_jobs_dispatch_shape check (
    (status = 'dispatched' and dispatched_at is not null and acknowledged_at is not null)
    or (status <> 'dispatched')
  ),
  constraint print_jobs_order_same_restaurant foreign key (restaurant_id, order_id)
    references public.orders(restaurant_id, id) on delete restrict,
  constraint print_jobs_invoice_same_restaurant foreign key (restaurant_id, invoice_id)
    references public.order_invoices(restaurant_id, id) on delete restrict,
  constraint print_jobs_station_same_restaurant foreign key (restaurant_id, kitchen_station_id)
    references public.kitchen_stations(restaurant_id, id) on delete restrict,
  constraint print_jobs_printer_same_restaurant foreign key (restaurant_id, target_printer_id)
    references public.business_printers(restaurant_id, id) on delete restrict,
  constraint print_jobs_template_same_restaurant foreign key (restaurant_id, template_id)
    references public.printer_templates(restaurant_id, id) on delete restrict,
  constraint print_jobs_agent_same_restaurant foreign key (restaurant_id, claimed_by_agent_id)
    references public.print_agents(restaurant_id, id) on delete restrict,
  constraint print_jobs_requester_same_restaurant foreign key (restaurant_id, requested_by_staff_id)
    references public.restaurant_staff(restaurant_id, id) on delete restrict,
  constraint print_jobs_original_same_restaurant foreign key (restaurant_id, original_job_id)
    references public.print_jobs(restaurant_id, id) on delete restrict,
  constraint print_jobs_automatic_key_unique unique (restaurant_id, automatic_key)
);

create table public.print_job_order_items (
  restaurant_id uuid not null,
  print_job_id uuid not null,
  order_item_id uuid not null,
  line_position integer not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (print_job_id, order_item_id),
  constraint print_job_order_items_position_positive check (line_position > 0),
  constraint print_job_order_items_job_same_restaurant foreign key (restaurant_id, print_job_id)
    references public.print_jobs(restaurant_id, id) on delete cascade,
  constraint print_job_order_items_item_same_restaurant foreign key (restaurant_id, order_item_id)
    references public.order_items(restaurant_id, id) on delete restrict,
  constraint print_job_order_items_job_position_unique unique (print_job_id, line_position)
);

create table public.print_job_attempts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  print_job_id uuid not null,
  agent_id uuid not null,
  attempt_number integer not null,
  outcome text not null default 'started',
  claimed_at timestamptz not null default clock_timestamp(),
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default clock_timestamp(),
  constraint print_job_attempts_restaurant_id_id_key unique (restaurant_id, id),
  constraint print_job_attempts_number_positive check (attempt_number > 0),
  constraint print_job_attempts_outcome_allowed check (outcome in (
    'started', 'lease_expired', 'dispatched', 'retryable_failure', 'terminal_failure')),
  constraint print_job_attempts_error_code_format check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint print_job_attempts_completion_shape check (
    (outcome = 'started' and completed_at is null)
    or (outcome <> 'started' and completed_at is not null)),
  constraint print_job_attempts_job_same_restaurant foreign key (restaurant_id, print_job_id)
    references public.print_jobs(restaurant_id, id) on delete cascade,
  constraint print_job_attempts_agent_same_restaurant foreign key (restaurant_id, agent_id)
    references public.print_agents(restaurant_id, id) on delete restrict,
  constraint print_job_attempts_job_number_unique unique (print_job_id, attempt_number)
);

create index print_jobs_claim_queue_idx on public.print_jobs
  (restaurant_id, priority, available_at, created_at)
  where status = 'pending' and dispatch_mode = 'automatic' and target_printer_id is not null;
create index print_jobs_expired_claim_idx on public.print_jobs
  (restaurant_id, claim_expires_at) where status = 'claimed';
create index print_jobs_printer_status_idx on public.print_jobs
  (restaurant_id, target_printer_id, status, created_at desc);
create index print_jobs_kitchen_trace_idx on public.print_jobs
  (restaurant_id, invoice_id, kitchen_station_id, kitchen_batch_key)
  where job_type = 'kitchen_ticket';
create index print_jobs_created_idx on public.print_jobs (restaurant_id, created_at desc);
create index print_jobs_original_idx on public.print_jobs (restaurant_id, original_job_id)
  where original_job_id is not null;
create index print_job_attempts_trace_idx on public.print_job_attempts
  (restaurant_id, print_job_id, attempt_number desc);
create index print_agents_tenant_idx on public.print_agents (restaurant_id, enabled)
  where revoked_at is null;

alter table public.print_queue_activations enable row level security;
alter table public.print_queue_activations force row level security;
alter table public.print_agents enable row level security;
alter table public.print_agents force row level security;
alter table public.print_jobs enable row level security;
alter table public.print_jobs force row level security;
alter table public.print_job_order_items enable row level security;
alter table public.print_job_order_items force row level security;
alter table public.print_job_attempts enable row level security;
alter table public.print_job_attempts force row level security;

revoke all on public.print_queue_activations, public.print_agents, public.print_jobs,
  public.print_job_order_items, public.print_job_attempts from public, anon, authenticated;
grant all on public.print_queue_activations, public.print_agents, public.print_jobs,
  public.print_job_order_items, public.print_job_attempts to service_role;

comment on table public.print_jobs is
  'Durable immutable print snapshots. dispatched means the local agent reports transport/spooler acceptance, not confirmed paper output.';
comment on column public.print_jobs.target_printer_id is
  'Nullable while no valid configured route exists. Stored printer status is not treated as hardware truth.';
comment on table public.print_queue_activations is
  'Per-tenant no-backfill boundary. Automatic reconciliation ignores eligibility events older than activated_at.';
comment on table public.print_job_attempts is
  'One durable row per lease. Failures and lease expiry remain available for support diagnosis.';

insert into public.print_queue_activations (restaurant_id, activated_at)
select id, clock_timestamp() from public.restaurants
on conflict (restaurant_id) do nothing;

create function public.ensure_print_queue_activation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.print_queue_activations (restaurant_id, activated_at)
  values (new.id, clock_timestamp()) on conflict (restaurant_id) do nothing;
  return new;
end;
$$;

create trigger restaurants_create_print_queue_activation
after insert on public.restaurants for each row execute function public.ensure_print_queue_activation();

create function public.resolve_print_job_printer(
  target_restaurant_id uuid, target_job_type text, target_station_id uuid default null
) returns uuid language plpgsql stable security definer set search_path = public as $$
declare selected_printer_id uuid; output_mode text;
begin
  if target_job_type = 'kitchen_ticket' then
    select settings.kitchen_output_mode into output_mode
    from public.business_printing_settings settings
    where settings.restaurant_id = target_restaurant_id;

    output_mode := coalesce(output_mode, 'kds');
    if output_mode = 'kds' then return null; end if;

    if output_mode in ('station_printers', 'kds_and_printers') then
      select printers.id into selected_printer_id
      from public.printer_station_mappings mappings
      join public.business_printers printers
        on printers.restaurant_id = mappings.restaurant_id and printers.id = mappings.printer_id
      where mappings.restaurant_id = target_restaurant_id
        and mappings.kitchen_station_id = target_station_id
        and mappings.active and mappings.deleted_at is null
        and printers.enabled and printers.deleted_at is null
        and printers.purpose in ('station', 'kitchen_order')
      order by printers.is_default desc, printers.priority, printers.created_at, printers.id
      limit 1;
      if selected_printer_id is not null then return selected_printer_id; end if;
    end if;

    if output_mode not in ('single_kitchen_printer', 'kds_and_printers') then
      return null;
    end if;
    select printers.id into selected_printer_id from public.business_printers printers
    where printers.restaurant_id = target_restaurant_id
      and printers.enabled and printers.deleted_at is null
      and printers.purpose = 'kitchen_order'
    order by printers.is_default desc, printers.priority, printers.created_at, printers.id limit 1;
    return selected_printer_id;
  elsif target_job_type = 'receipt' then
    select printers.id into selected_printer_id from public.business_printers printers
    where printers.restaurant_id = target_restaurant_id
      and printers.enabled and printers.deleted_at is null
      and printers.purpose = 'receipt'
    order by printers.is_default desc, printers.priority, printers.created_at, printers.id limit 1;
    return selected_printer_id;
  end if;
  raise exception 'Unsupported print job type.';
end;
$$;

create function public.resolve_print_job_template(
  target_restaurant_id uuid, target_job_type text
) returns uuid language sql stable security definer set search_path = public as $$
  select templates.id from public.printer_templates templates
  where templates.restaurant_id = target_restaurant_id
    and templates.template_type = case when target_job_type = 'kitchen_ticket'
      then 'kitchen_ticket' else 'receipt' end
    and templates.active and templates.deleted_at is null
  order by templates.is_default desc, templates.version desc, templates.created_at desc, templates.id
  limit 1
$$;

create function public.print_creator_snapshot(
  target_restaurant_id uuid, target_invoice_id uuid
) returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when invoices.invoice_source = 'public_qr' then
      jsonb_build_object('kind', 'customer_qr', 'role_label', 'Customer QR', 'display_name', null)
    when invoices.invoice_source in ('cashier','waiter') and staff.id is not null then
      jsonb_build_object('kind', invoices.invoice_source,
        'role_label', initcap(invoices.invoice_source), 'display_name', staff.display_name)
    else jsonb_build_object('kind', 'unknown', 'role_label', 'Unknown', 'display_name', null)
  end
  from public.order_invoices invoices
  left join public.restaurant_staff staff
    on staff.restaurant_id = invoices.restaurant_id
   and staff.id = invoices.created_by_staff_id
   and staff.role::text = invoices.invoice_source
  where invoices.restaurant_id = target_restaurant_id and invoices.id = target_invoice_id
$$;

create function public.enqueue_kitchen_print_jobs(
  target_restaurant_id uuid, target_invoice_id uuid
) returns integer language plpgsql security definer set search_path = public as $$
declare
  activation_at timestamptz;
  batch record;
  selected_printer uuid;
  selected_template public.printer_templates;
  selected_job_id uuid;
  selected_dispatch_mode text;
  inserted_count integer := 0;
begin
  select activated_at into activation_at from public.print_queue_activations
  where restaurant_id = target_restaurant_id;
  if activation_at is null then return 0; end if;

  select coalesce(settings.default_print_behaviour, 'on_demand') into selected_dispatch_mode
  from public.business_printing_settings settings
  where settings.restaurant_id = target_restaurant_id;
  selected_dispatch_mode := coalesce(selected_dispatch_mode, 'on_demand');

  for batch in
    select orders.id order_id, invoices.id invoice_id, invoices.invoice_number,
      invoices.kitchen_ticket_number, orders.display_number order_display_number,
      orders.table_number, orders.order_note, orders.created_at order_created_at,
      items.kitchen_station_id, stations.name station_name,
      coalesce(case when items.appended_at is null then null
        else ((extract(epoch from items.appended_at) * 1000000)::bigint)::text end, 'initial') batch_key,
      coalesce(items.appended_at, case when invoices.invoice_source = 'public_qr'
        then invoices.paid_at else invoices.created_at end) eligible_at,
      jsonb_agg(jsonb_build_object(
        'order_item_id', items.id, 'menu_item_id', items.menu_item_id,
        'name', menu.name, 'quantity', items.quantity, 'notes', items.notes
      ) order by items.created_at, items.id) item_lines,
      array_agg(items.id order by items.created_at, items.id) item_ids
    from public.order_invoices invoices
    join public.orders orders on orders.restaurant_id = invoices.restaurant_id
      and orders.id = invoices.order_id
    join public.order_items items on items.restaurant_id = invoices.restaurant_id
      and items.invoice_id = invoices.id and items.order_id = orders.id
    join public.kitchen_stations stations on stations.restaurant_id = items.restaurant_id
      and stations.id = items.kitchen_station_id
    join public.menu_items menu on menu.restaurant_id = items.restaurant_id
      and menu.id = items.menu_item_id
    where invoices.restaurant_id = target_restaurant_id and invoices.id = target_invoice_id
      and orders.dining_session_status = 'open' and orders.table_released_at is null
      and orders.operational_status in ('accepted','preparing','ready')
      and public.invoice_is_kitchen_eligible(invoices.restaurant_id, invoices.id)
      and items.kitchen_status in ('accepted','preparing','ready')
      and items.kitchen_station_id is not null
    group by orders.id, invoices.id, items.kitchen_station_id, stations.name, items.appended_at
  loop
    if batch.eligible_at is null or batch.eligible_at < activation_at then continue; end if;
    selected_printer := public.resolve_print_job_printer(
      target_restaurant_id, 'kitchen_ticket', batch.kitchen_station_id);
    select * into selected_template from public.printer_templates templates
    where templates.id = public.resolve_print_job_template(target_restaurant_id, 'kitchen_ticket')
      and templates.restaurant_id = target_restaurant_id;

    insert into public.print_jobs (
      restaurant_id, job_type, printer_purpose, request_kind, automatic_key,
      order_id, invoice_id, kitchen_station_id, kitchen_batch_key,
      target_printer_id, template_id, template_version, payload_version, payload,
      dispatch_mode, status, priority, available_at
    ) values (
      target_restaurant_id, 'kitchen_ticket', 'kitchen', 'automatic',
      'kitchen:' || batch.invoice_id::text || ':' || batch.kitchen_station_id::text || ':' || batch.batch_key,
      batch.order_id, batch.invoice_id, batch.kitchen_station_id, batch.batch_key,
      selected_printer, selected_template.id, selected_template.version, 1,
      jsonb_build_object(
        'schema', 'serveflow.kitchen_ticket.v1',
        'restaurant', jsonb_build_object('id', target_restaurant_id,
          'display_name', (select name from public.restaurants where id = target_restaurant_id)),
        'order', jsonb_build_object('id', batch.order_id,
          'display_number', batch.order_display_number, 'table_number', batch.table_number,
          'order_note', batch.order_note),
        'invoice', jsonb_build_object('id', batch.invoice_id,
          'invoice_number', batch.invoice_number, 'kitchen_ticket_number', batch.kitchen_ticket_number),
        'station', jsonb_build_object('id', batch.kitchen_station_id, 'name', batch.station_name),
        'kitchen_batch_key', batch.batch_key,
        'creator', public.print_creator_snapshot(target_restaurant_id, batch.invoice_id),
        'eligible_at', batch.eligible_at,
        'items', batch.item_lines,
        'template', case when selected_template.id is null then null else jsonb_build_object(
          'id', selected_template.id, 'immutable_key', selected_template.immutable_key,
          'version', selected_template.version, 'name', selected_template.name,
          'placeholder_schema', selected_template.placeholder_schema,
          'branding_options', selected_template.branding_options) end
      ), selected_dispatch_mode, 'pending', 100, clock_timestamp()
    ) on conflict (restaurant_id, automatic_key) do update set
      target_printer_id = case when public.print_jobs.status = 'pending'
        then excluded.target_printer_id else public.print_jobs.target_printer_id end,
      dispatch_mode = case when public.print_jobs.status = 'pending'
        then case when public.print_jobs.dispatch_mode = 'automatic' then 'automatic'
          else excluded.dispatch_mode end else public.print_jobs.dispatch_mode end,
      updated_at = clock_timestamp()
    returning id into selected_job_id;

    if not exists (select 1 from public.print_job_order_items where print_job_id = selected_job_id) then
      insert into public.print_job_order_items (restaurant_id, print_job_id, order_item_id, line_position)
      select target_restaurant_id, selected_job_id, item_id, ordinal::integer
      from unnest(batch.item_ids) with ordinality as associated(item_id, ordinal)
      on conflict do nothing;
      inserted_count := inserted_count + 1;
    end if;
  end loop;
  return inserted_count;
end;
$$;

create function public.enqueue_receipt_print_job(
  target_restaurant_id uuid, target_invoice_id uuid
) returns integer language plpgsql security definer set search_path = public as $$
declare
  activation_at timestamptz;
  receipt record;
  selected_printer uuid;
  selected_template public.printer_templates;
  selected_job_id uuid;
  selected_dispatch_mode text;
  was_new boolean;
begin
  select activated_at into activation_at from public.print_queue_activations
  where restaurant_id = target_restaurant_id;
  if activation_at is null then return 0; end if;

  select invoices.*, orders.table_number, orders.display_number order_display_number,
    restaurants.name restaurant_name, restaurants.currency_code, restaurants.currency_symbol,
    events.id receipt_event_id, events.created_at receipt_event_created_at,
    jsonb_agg(jsonb_build_object(
      'order_item_id', items.id, 'menu_item_id', items.menu_item_id,
      'name', menu.name, 'quantity', items.quantity, 'unit_price', items.price,
      'line_total', items.price * items.quantity, 'notes', items.notes
    ) order by items.created_at, items.id) item_lines,
    array_agg(items.id order by items.created_at, items.id) item_ids
  into receipt
  from public.order_invoices invoices
  join public.orders orders on orders.restaurant_id = invoices.restaurant_id and orders.id = invoices.order_id
  join public.restaurants restaurants on restaurants.id = invoices.restaurant_id
  join public.receipt_generation_events events on events.restaurant_id = invoices.restaurant_id
    and events.invoice_id = invoices.id and events.order_id = orders.id
  join public.order_items items on items.restaurant_id = invoices.restaurant_id
    and items.invoice_id = invoices.id and items.order_id = orders.id
  join public.menu_items menu on menu.restaurant_id = items.restaurant_id and menu.id = items.menu_item_id
  where invoices.restaurant_id = target_restaurant_id and invoices.id = target_invoice_id
    and invoices.payment_status = 'paid' and invoices.paid_at is not null
  group by invoices.id, orders.id, restaurants.id, events.id;
  if receipt.id is null or receipt.paid_at < activation_at then return 0; end if;

  selected_printer := public.resolve_print_job_printer(target_restaurant_id, 'receipt', null);
  select * into selected_template from public.printer_templates templates
  where templates.id = public.resolve_print_job_template(target_restaurant_id, 'receipt')
    and templates.restaurant_id = target_restaurant_id;
  select coalesce(settings.default_print_behaviour, 'on_demand') into selected_dispatch_mode
  from public.business_printing_settings settings where settings.restaurant_id = target_restaurant_id;
  selected_dispatch_mode := coalesce(selected_dispatch_mode, 'on_demand');

  was_new := not exists (select 1 from public.print_jobs jobs
    where jobs.restaurant_id = target_restaurant_id
      and jobs.automatic_key = 'receipt:' || target_invoice_id::text || ':v1');
  insert into public.print_jobs (
    restaurant_id, job_type, printer_purpose, request_kind, automatic_key,
    order_id, invoice_id, target_printer_id, template_id, template_version,
    payload_version, payload, dispatch_mode, status, priority, available_at
  ) values (
    target_restaurant_id, 'receipt', 'cashier', 'automatic',
    'receipt:' || target_invoice_id::text || ':v1', receipt.order_id, receipt.id,
    selected_printer, selected_template.id, selected_template.version, 1,
    jsonb_build_object(
      'schema', 'serveflow.receipt.v1',
      'restaurant', jsonb_build_object('id', target_restaurant_id,
        'display_name', receipt.restaurant_name, 'currency_code', receipt.currency_code,
        'currency_symbol', receipt.currency_symbol),
      'order', jsonb_build_object('id', receipt.order_id,
        'display_number', receipt.order_display_number, 'table_number', receipt.table_number),
      'invoice', jsonb_build_object('id', receipt.id, 'invoice_number', receipt.invoice_number,
        'reference_number', receipt.reference_number, 'paid_at', receipt.paid_at,
        'payment_method', receipt.payment_method, 'subtotal', receipt.subtotal,
        'vat_rate', receipt.vat_rate, 'vat_amount', receipt.vat_amount,
        'service_charge_rate', receipt.service_charge_rate,
        'service_charge_amount', receipt.service_charge_amount,
        'discount_amount', receipt.discount_amount, 'grand_total', receipt.grand_total,
        'financial_snapshot_version', receipt.financial_snapshot_version),
      'receipt_generation_event_id', receipt.receipt_event_id,
      'creator', public.print_creator_snapshot(target_restaurant_id, receipt.id),
      'items', receipt.item_lines,
      'template', case when selected_template.id is null then null else jsonb_build_object(
        'id', selected_template.id, 'immutable_key', selected_template.immutable_key,
        'version', selected_template.version, 'name', selected_template.name,
        'placeholder_schema', selected_template.placeholder_schema,
        'branding_options', selected_template.branding_options) end
    ), selected_dispatch_mode, 'pending', 100, clock_timestamp()
  ) on conflict (restaurant_id, automatic_key) do update set
    target_printer_id = case when public.print_jobs.status = 'pending'
      then excluded.target_printer_id else public.print_jobs.target_printer_id end,
    dispatch_mode = case when public.print_jobs.status = 'pending'
      then case when public.print_jobs.dispatch_mode = 'automatic' then 'automatic'
        else excluded.dispatch_mode end else public.print_jobs.dispatch_mode end,
    updated_at = clock_timestamp()
  returning id into selected_job_id;

  if not exists (select 1 from public.print_job_order_items where print_job_id = selected_job_id) then
    insert into public.print_job_order_items (restaurant_id, print_job_id, order_item_id, line_position)
    select target_restaurant_id, selected_job_id, item_id, ordinal::integer
    from unnest(receipt.item_ids) with ordinality as associated(item_id, ordinal)
    on conflict do nothing;
  end if;
  return case when was_new then 1 else 0 end;
end;
$$;

create function public.enqueue_print_jobs_from_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_restaurant uuid; target_invoice uuid;
begin
  target_restaurant := coalesce(new.restaurant_id, old.restaurant_id);
  if tg_table_name = 'receipt_generation_events' then
    target_invoice := coalesce(new.invoice_id, old.invoice_id);
    perform public.enqueue_receipt_print_job(target_restaurant, target_invoice);
  elsif tg_table_name = 'order_invoices' then
    target_invoice := coalesce(new.id, old.id);
    perform public.enqueue_kitchen_print_jobs(target_restaurant, target_invoice);
    perform public.enqueue_receipt_print_job(target_restaurant, target_invoice);
  else
    target_invoice := coalesce(new.invoice_id, old.invoice_id);
    if target_invoice is not null then
      perform public.enqueue_kitchen_print_jobs(target_restaurant, target_invoice);
    end if;
  end if;
  return null;
exception when others then
  -- Printing is downstream of payment and Kitchen release. Reconciliation can
  -- repair missed work without rolling back those business transactions.
  raise warning 'Print queue enqueue deferred for restaurant %, invoice %: %',
    target_restaurant, target_invoice, sqlerrm;
  return null;
end;
$$;

create constraint trigger order_items_enqueue_print_jobs
after insert or update on public.order_items deferrable initially deferred
for each row execute function public.enqueue_print_jobs_from_change();
create constraint trigger order_invoices_enqueue_print_jobs
after insert or update on public.order_invoices deferrable initially deferred
for each row execute function public.enqueue_print_jobs_from_change();
create constraint trigger receipt_events_enqueue_print_jobs
after insert or update on public.receipt_generation_events deferrable initially deferred
for each row execute function public.enqueue_print_jobs_from_change();

create function public.reconcile_print_jobs(
  target_restaurant_id uuid, target_invoice_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor public.restaurant_staff; invoice record; kitchen_count integer := 0; receipt_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id and staff.user_id = auth.uid()
    and staff.active and staff.role::text in ('owner','manager') limit 1;
  if actor.id is null then raise exception 'Only active owners and managers may reconcile print jobs.'; end if;
  for invoice in select id from public.order_invoices
    where restaurant_id = target_restaurant_id
      and (target_invoice_id is null or id = target_invoice_id)
  loop
    kitchen_count := kitchen_count + public.enqueue_kitchen_print_jobs(target_restaurant_id, invoice.id);
    receipt_count := receipt_count + public.enqueue_receipt_print_job(target_restaurant_id, invoice.id);
  end loop;
  return jsonb_build_object('kitchen_jobs_created', kitchen_count,
    'receipt_jobs_created', receipt_count, 'activation_boundary_preserved', true);
end;
$$;

create function public.register_print_agent(
  target_restaurant_id uuid, target_auth_user_id uuid, agent_name text
) returns uuid language plpgsql security definer set search_path = public as $$
declare agent_id uuid;
begin
  if target_restaurant_id is null or target_auth_user_id is null
    or nullif(btrim(agent_name), '') is null then raise exception 'Complete agent registration is required.'; end if;
  if exists (select 1 from public.restaurant_staff where user_id = target_auth_user_id) then
    raise exception 'A dedicated non-staff authentication identity is required for a print agent.';
  end if;
  insert into public.print_agents (restaurant_id, auth_user_id, name)
  values (target_restaurant_id, target_auth_user_id, btrim(agent_name)) returning id into agent_id;
  return agent_id;
end;
$$;

create function public.revoke_print_agent(target_agent_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.print_agents set enabled = false, revoked_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = target_agent_id;
  if not found then raise exception 'Print agent not found.'; end if;
end;
$$;

create function public.claim_print_jobs(
  target_restaurant_id uuid, requested_limit integer default 10,
  requested_lease_seconds integer default 60
) returns table (
  job_id uuid, attempt_id uuid, attempt_number integer, job_type text,
  printer_purpose text, target_printer_id uuid, payload_version integer,
  template_id uuid, template_version integer, payload jsonb, claim_expires_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare agent public.print_agents;
begin
  if auth.uid() is null then raise exception 'Print agent authentication is required.'; end if;
  if requested_limit not between 1 and 50 then raise exception 'Claim limit must be between 1 and 50.'; end if;
  if requested_lease_seconds not between 15 and 300 then raise exception 'Lease must be between 15 and 300 seconds.'; end if;
  select * into agent from public.print_agents agents
  where agents.auth_user_id = auth.uid() and agents.restaurant_id = target_restaurant_id
    and agents.enabled and agents.revoked_at is null limit 1;
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
    where jobs.restaurant_id = target_restaurant_id and jobs.status = 'pending'
      and jobs.dispatch_mode = 'automatic' and jobs.target_printer_id is not null
      and jobs.available_at <= clock_timestamp()
    order by jobs.priority, jobs.available_at, jobs.created_at, jobs.id
    for update skip locked limit requested_limit
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
end;
$$;

create function public.get_claimed_print_job_connection(target_job_id uuid)
returns table (
  printer_id uuid, connection_type text, usb_vendor_id text, usb_product_id text,
  network_host inet, network_port integer, connection_options jsonb
) language plpgsql stable security definer set search_path = public as $$
declare agent public.print_agents;
begin
  select * into agent from public.print_agents agents
  where agents.auth_user_id = auth.uid() and agents.enabled and agents.revoked_at is null limit 1;
  if agent.id is null then raise exception 'Registered print agent access is required.'; end if;
  return query select printers.id, connections.connection_type, connections.usb_vendor_id,
    connections.usb_product_id, connections.network_host, connections.network_port,
    connections.connection_options
  from public.print_jobs jobs
  join public.business_printers printers on printers.restaurant_id = jobs.restaurant_id
    and printers.id = jobs.target_printer_id and printers.enabled and printers.deleted_at is null
  join public.printer_connections connections on connections.restaurant_id = printers.restaurant_id
    and connections.printer_id = printers.id and connections.active and connections.deleted_at is null
  where jobs.id = target_job_id and jobs.restaurant_id = agent.restaurant_id
    and jobs.status = 'claimed' and jobs.claimed_by_agent_id = agent.id
    and jobs.claim_expires_at > clock_timestamp()
  order by connections.created_at, connections.id limit 1;
end;
$$;

create function public.acknowledge_print_job(
  target_job_id uuid, target_attempt_id uuid, reported_outcome text,
  reported_error_code text default null, reported_error_message text default null,
  retry_after_seconds integer default 30
) returns jsonb language plpgsql security definer set search_path = public as $$
declare agent public.print_agents; target_job public.print_jobs; target_attempt public.print_job_attempts;
begin
  select * into agent from public.print_agents agents
  where agents.auth_user_id = auth.uid() and agents.enabled and agents.revoked_at is null limit 1;
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
end;
$$;

create function public.request_print_job_reprint(target_original_job_id uuid, reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare original public.print_jobs; actor public.restaurant_staff; new_job_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if length(btrim(coalesce(reason, ''))) not between 1 and 500 then
    raise exception 'A reprint reason between 1 and 500 characters is required.';
  end if;
  select * into original from public.print_jobs where id = target_original_job_id;
  if original.id is null then raise exception 'Original print job not found.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = original.restaurant_id and staff.user_id = auth.uid() and staff.active limit 1;
  if actor.id is null or not (
    actor.role::text in ('owner','manager')
    or (actor.role::text = 'cashier' and original.job_type = 'receipt')
    or (actor.role::text = 'kitchen' and original.job_type = 'kitchen_ticket'
      and actor.assigned_kitchen_station_id = original.kitchen_station_id)
  ) then raise exception 'This staff role is not authorized to reprint the selected job.'; end if;
  if original.status not in ('dispatched','failed') then
    raise exception 'Only dispatched or terminally failed jobs may be reprinted.';
  end if;

  insert into public.print_jobs (
    restaurant_id, job_type, printer_purpose, request_kind, automatic_key,
    order_id, invoice_id, kitchen_station_id, kitchen_batch_key, target_printer_id,
    template_id, template_version, payload_version, payload, dispatch_mode,
    status, priority, available_at, original_job_id, reprint_reason, requested_by_staff_id
  ) values (
    original.restaurant_id, original.job_type, original.printer_purpose, 'manual_reprint', null,
    original.order_id, original.invoice_id, original.kitchen_station_id,
    original.kitchen_batch_key, original.target_printer_id, original.template_id,
    original.template_version, original.payload_version, original.payload, 'automatic',
    'pending', original.priority, clock_timestamp(), original.id, btrim(reason), actor.id
  ) returning id into new_job_id;
  insert into public.print_job_order_items (restaurant_id, print_job_id, order_item_id, line_position)
  select items.restaurant_id, new_job_id, items.order_item_id, items.line_position
  from public.print_job_order_items items where items.print_job_id = original.id;
  return new_job_id;
end;
$$;

create function public.request_print_job_dispatch(target_job_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare target_job public.print_jobs; actor public.restaurant_staff;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into target_job from public.print_jobs jobs where jobs.id = target_job_id for update;
  if target_job.id is null then raise exception 'Print job not found.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target_job.restaurant_id and staff.user_id = auth.uid()
    and staff.active limit 1;
  if actor.id is null or not (
    actor.role::text in ('owner','manager')
    or (actor.role::text = 'cashier' and target_job.job_type = 'receipt')
    or (actor.role::text = 'kitchen' and target_job.job_type = 'kitchen_ticket'
      and actor.assigned_kitchen_station_id = target_job.kitchen_station_id)
  ) then raise exception 'This staff role is not authorized to dispatch the selected job.'; end if;
  if target_job.status <> 'pending' then
    raise exception 'Only pending jobs can be requested for dispatch.';
  end if;
  update public.print_jobs set dispatch_mode = 'automatic', updated_at = clock_timestamp()
  where id = target_job.id;
  return target_job.id;
end;
$$;

create function public.get_print_jobs(target_restaurant_id uuid, requested_limit integer default 100)
returns setof public.print_jobs language plpgsql stable security definer set search_path = public as $$
declare actor public.restaurant_staff;
begin
  if requested_limit not between 1 and 500 then raise exception 'Read limit must be between 1 and 500.'; end if;
  select * into actor from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id and staff.user_id = auth.uid()
    and staff.active limit 1;
  if actor.id is null or actor.role::text not in ('owner','manager','cashier','kitchen') then
    raise exception 'Authorized print operations staff are required.';
  end if;
  return query select jobs.* from public.print_jobs jobs
  where jobs.restaurant_id = target_restaurant_id and (
    actor.role::text in ('owner','manager')
    or (actor.role::text = 'cashier' and jobs.job_type = 'receipt')
    or (actor.role::text = 'kitchen' and jobs.job_type = 'kitchen_ticket'
      and jobs.kitchen_station_id = actor.assigned_kitchen_station_id)
  ) order by jobs.created_at desc, jobs.id limit requested_limit;
end;
$$;

create function public.protect_print_job_snapshot()
returns trigger language plpgsql set search_path = public as $$
begin
  if row(old.restaurant_id, old.job_type, old.printer_purpose, old.request_kind,
    old.automatic_key, old.order_id, old.invoice_id, old.kitchen_station_id,
    old.kitchen_batch_key, old.template_id, old.template_version, old.payload_version,
    old.payload, old.original_job_id, old.reprint_reason, old.requested_by_staff_id, old.created_at)
    is distinct from
    row(new.restaurant_id, new.job_type, new.printer_purpose, new.request_kind,
    new.automatic_key, new.order_id, new.invoice_id, new.kitchen_station_id,
    new.kitchen_batch_key, new.template_id, new.template_version, new.payload_version,
    new.payload, new.original_job_id, new.reprint_reason, new.requested_by_staff_id, new.created_at)
  then raise exception 'Print job identity and payload snapshots are immutable.'; end if;
  return new;
end;
$$;
create trigger print_jobs_protect_snapshot before update on public.print_jobs
for each row execute function public.protect_print_job_snapshot();

revoke all on function public.ensure_print_queue_activation() from public, anon, authenticated;
revoke all on function public.resolve_print_job_printer(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.resolve_print_job_template(uuid,text) from public, anon, authenticated;
revoke all on function public.print_creator_snapshot(uuid,uuid) from public, anon, authenticated;
revoke all on function public.enqueue_kitchen_print_jobs(uuid,uuid) from public, anon, authenticated;
revoke all on function public.enqueue_receipt_print_job(uuid,uuid) from public, anon, authenticated;
revoke all on function public.enqueue_print_jobs_from_change() from public, anon, authenticated;
revoke all on function public.protect_print_job_snapshot() from public, anon, authenticated;
grant execute on function public.enqueue_kitchen_print_jobs(uuid,uuid) to service_role;
grant execute on function public.enqueue_receipt_print_job(uuid,uuid) to service_role;

revoke all on function public.reconcile_print_jobs(uuid,uuid) from public, anon;
grant execute on function public.reconcile_print_jobs(uuid,uuid) to authenticated, service_role;
revoke all on function public.register_print_agent(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.register_print_agent(uuid,uuid,text) to service_role;
revoke all on function public.revoke_print_agent(uuid) from public, anon, authenticated;
grant execute on function public.revoke_print_agent(uuid) to service_role;
revoke all on function public.claim_print_jobs(uuid,integer,integer) from public, anon;
grant execute on function public.claim_print_jobs(uuid,integer,integer) to authenticated, service_role;
revoke all on function public.get_claimed_print_job_connection(uuid) from public, anon;
grant execute on function public.get_claimed_print_job_connection(uuid) to authenticated, service_role;
revoke all on function public.acknowledge_print_job(uuid,uuid,text,text,text,integer) from public, anon;
grant execute on function public.acknowledge_print_job(uuid,uuid,text,text,text,integer) to authenticated, service_role;
revoke all on function public.request_print_job_reprint(uuid,text) from public, anon;
grant execute on function public.request_print_job_reprint(uuid,text) to authenticated, service_role;
revoke all on function public.request_print_job_dispatch(uuid) from public, anon;
grant execute on function public.request_print_job_dispatch(uuid) to authenticated, service_role;
revoke all on function public.get_print_jobs(uuid,integer) from public, anon;
grant execute on function public.get_print_jobs(uuid,integer) to authenticated, service_role;

-- Correct legacy grant drift without changing the browser-print implementation.
revoke all on function public.print_final_dining_bill(uuid,text) from public, anon;
grant execute on function public.print_final_dining_bill(uuid,text) to authenticated, service_role;

comment on function public.claim_print_jobs(uuid,integer,integer) is
  'Claims tenant jobs with row locks and expiring leases. Returned payload contains no printer connection secrets.';
comment on function public.get_claimed_print_job_connection(uuid) is
  'Exposes connection configuration only to the registered agent holding the active tenant job lease.';
comment on function public.acknowledge_print_job(uuid,uuid,text,text,text,integer) is
  'dispatched means agent-reported transport or spooler acceptance; paper_output_confirmed is always false.';
comment on function public.reconcile_print_jobs(uuid,uuid) is
  'Repeatable deterministic repair bounded by the tenant activation timestamp; it never backfills historical eligibility.';

-- Retention is deliberately policy-only in P2: keep dispatched jobs and attempts
-- for at least 90 days and failed jobs for at least 180 days. A later scheduled
-- cleanup must be tenant-scoped, auditable, and separately reviewed.
