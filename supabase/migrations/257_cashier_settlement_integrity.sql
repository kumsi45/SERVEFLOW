-- Cashier theft-prevention Phase A: settlement integrity.
-- Restaurant obligations remain independent of shifts. Every new cashier
-- settlement is owned by the authenticated cashier's own locked open shift.

-- Replace the legacy simple shift FK with tenant and cashier-owner integrity.
-- Nullable historical links remain allowed; terminal settlement completeness
-- is staged below because legacy paid rows may have no defensible shift.
alter table public.order_invoices
  drop constraint if exists order_invoices_cashier_shift_id_fkey;

alter table public.order_invoices
  drop constraint if exists order_invoices_cashier_shift_same_restaurant,
  add constraint order_invoices_cashier_shift_same_restaurant
    foreign key (restaurant_id, cashier_shift_id)
    references public.cashier_shifts (restaurant_id, id)
    on delete restrict
    not valid;

alter table public.order_invoices
  validate constraint order_invoices_cashier_shift_same_restaurant;

alter table public.order_invoices
  drop constraint if exists order_invoices_cashier_shift_owner_same_restaurant,
  add constraint order_invoices_cashier_shift_owner_same_restaurant
    foreign key (restaurant_id, verified_by, cashier_shift_id)
    references public.cashier_shifts (restaurant_id, opened_by, id)
    on delete restrict
    not valid;

alter table public.order_invoices
  validate constraint order_invoices_cashier_shift_owner_same_restaurant;

-- Existing verified identity/timestamps are complete and can be validated.
alter table public.order_invoices
  drop constraint if exists order_invoices_terminal_cashier_audit_complete,
  add constraint order_invoices_terminal_cashier_audit_complete
    check (
      not (status in ('paid', 'verified') or payment_status = 'paid')
      or (
        verified_by is not null
        and verified_at is not null
        and paid_at is not null
      )
    ) not valid;

alter table public.order_invoices
  validate constraint order_invoices_terminal_cashier_audit_complete;

-- This constraint is deliberately NOT VALID. PostgreSQL enforces it for new
-- inserts/updates while preserving ambiguous legacy paid rows with null shifts.
-- After explicit legacy remediation it can be validated in a later migration.
alter table public.order_invoices
  drop constraint if exists order_invoices_terminal_cashier_shift_required,
  add constraint order_invoices_terminal_cashier_shift_required
    check (
      not (status in ('paid', 'verified') or payment_status = 'paid')
      or cashier_shift_id is not null
    ) not valid;

comment on constraint order_invoices_terminal_cashier_shift_required
on public.order_invoices is
  'Prospective Phase A invariant. NOT VALID only because ambiguous legacy paid rows may have no cashier shift; all new or updated terminal cashier settlements require one.';

-- The former trigger guessed a restaurant-wide shift. It now validates the
-- explicit shift written by the settlement RPC and never infers ownership.
create or replace function public.stamp_verified_invoice_shift()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_shift public.cashier_shifts;
  terminal_settlement boolean;
  entering_terminal_settlement boolean := false;
begin
  terminal_settlement := new.status in ('paid', 'verified')
    or new.payment_status = 'paid';

  if terminal_settlement then
    if tg_op = 'INSERT' then
      entering_terminal_settlement := true;
    else
      entering_terminal_settlement := not (
        old.status in ('paid', 'verified') or old.payment_status = 'paid'
      );
    end if;
  end if;

  if new.cashier_shift_id is not null then
    select *
    into target_shift
    from public.cashier_shifts shifts
    where shifts.id = new.cashier_shift_id;

    if target_shift.id is null
      or target_shift.restaurant_id <> new.restaurant_id
    then
      raise exception 'Cashier shift does not belong to this business.';
    end if;

    if new.verified_by is not null
      and target_shift.opened_by <> new.verified_by
    then
      raise exception 'Payment must belong to the verifying cashier shift.';
    end if;
  end if;

  if entering_terminal_settlement then
    if new.cashier_shift_id is null
      or new.verified_by is null
      or new.verified_at is null
      or new.paid_at is null
    then
      raise exception 'Cashier settlement audit is incomplete.';
    end if;

    if target_shift.id is null
      or target_shift.opened_by <> new.verified_by
    then
      raise exception 'Payment must belong to the verifying cashier shift.';
    end if;

    if target_shift.closed_at is not null then
      raise exception 'Cashier shift is already closed.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists stamp_verified_invoice_shift_trigger
on public.order_invoices;

create trigger stamp_verified_invoice_shift_trigger
before insert or update of
  status,
  payment_status,
  cashier_shift_id,
  verified_by,
  verified_at,
  paid_at
on public.order_invoices
for each row
execute function public.stamp_verified_invoice_shift();

revoke all on function public.stamp_verified_invoice_shift()
from public, anon, authenticated;

-- Protect the finalized financial identity while leaving status-only future
-- refund/exception transitions possible through controlled RPCs.
create or replace function public.protect_finalized_cashier_invoice_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('paid', 'verified') or old.payment_status = 'paid' then
    if new.restaurant_id is distinct from old.restaurant_id
      or new.order_id is distinct from old.order_id
      or new.invoice_number is distinct from old.invoice_number
      or new.total_price is distinct from old.total_price
      or new.subtotal is distinct from old.subtotal
      or new.vat_rate is distinct from old.vat_rate
      or new.vat_amount is distinct from old.vat_amount
      or new.service_charge_rate is distinct from old.service_charge_rate
      or new.service_charge_amount is distinct from old.service_charge_amount
      or new.discount_amount is distinct from old.discount_amount
      or new.grand_total is distinct from old.grand_total
      or new.payment_method is distinct from old.payment_method
      or new.paid_at is distinct from old.paid_at
      or new.paid_by is distinct from old.paid_by
      or new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by
      or new.cashier_shift_id is distinct from old.cashier_shift_id
      or new.reference_number is distinct from old.reference_number
      or new.transaction_id is distinct from old.transaction_id
      or new.screenshot_url is distinct from old.screenshot_url
      or new.payment_recorded_at is distinct from old.payment_recorded_at
    then
      raise exception 'Finalized cashier settlement identity is immutable.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_finalized_cashier_invoice_identity_trigger
on public.order_invoices;

create trigger protect_finalized_cashier_invoice_identity_trigger
before update on public.order_invoices
for each row
execute function public.protect_finalized_cashier_invoice_identity();

revoke all on function public.protect_finalized_cashier_invoice_identity()
from public, anon, authenticated;

create or replace function public.cashier_payment_method_requires_evidence(
  payment_method text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(public.normalize_payment_method(payment_method) <> 'Cash', true)
$$;

revoke all on function public.cashier_payment_method_requires_evidence(text)
from public, anon, authenticated;

-- Direct invoice settlement remains available for existing internal consumers,
-- but now owns and locks the acting cashier's exact shift before invoice state
-- can become terminal.
alter function public.verify_order_payment(uuid, text, text, text, boolean)
rename to verify_order_payment_phase257_base;

revoke all on function public.verify_order_payment_phase257_base(
  uuid, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.verify_order_payment_phase257_base(
  uuid, text, text, text, boolean
) to service_role;

create or replace function public.verify_order_payment(
  target_invoice_id uuid,
  payment_reference_number text default null,
  payment_transaction_id text default null,
  payment_screenshot_url text default null,
  owner_duplicate_override boolean default false
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_hint public.order_invoices;
  target_invoice public.order_invoices;
  target_order public.orders;
  acting_cashier public.restaurant_staff;
  acting_shift public.cashier_shifts;
  verified_order public.orders;
  normalized_method text;
  effective_reference text;
  effective_transaction text;
  effective_screenshot text;
  related_evidence_exists boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to verify payment.';
  end if;

  select * into invoice_hint
  from public.order_invoices invoices
  where invoices.id = target_invoice_id;

  if invoice_hint.id is null then
    raise exception 'Payment batch not found.';
  end if;

  select * into acting_cashier
  from public.restaurant_staff staff
  where staff.restaurant_id = invoice_hint.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role = 'cashier'
  limit 1;

  if acting_cashier.id is null then
    raise exception 'Only an active cashier may verify payment.';
  end if;

  select * into acting_shift
  from public.cashier_shifts shifts
  where shifts.restaurant_id = invoice_hint.restaurant_id
    and shifts.opened_by = acting_cashier.id
    and shifts.closed_at is null
  order by shifts.opened_at desc
  limit 1
  for update;

  if acting_shift.id is null then
    raise exception 'No open cashier shift. Open your shift before collecting payment.';
  end if;

  select * into target_invoice
  from public.order_invoices invoices
  where invoices.id = target_invoice_id
    and invoices.restaurant_id = acting_shift.restaurant_id
  for update;

  if target_invoice.id is null then
    raise exception 'Payment batch not found.';
  end if;

  select * into target_order
  from public.orders orders
  where orders.id = target_invoice.order_id
    and orders.restaurant_id = target_invoice.restaurant_id;

  if target_order.id is null then
    raise exception 'Dining session not found.';
  end if;

  if target_invoice.status in ('paid', 'verified')
    or target_invoice.payment_status = 'paid'
  then
    if target_invoice.verified_by = acting_cashier.id
      and target_invoice.cashier_shift_id = acting_shift.id
    then
      return target_order;
    end if;

    raise exception 'Payment has already been settled.';
  end if;

  if owner_duplicate_override then
    raise exception 'Duplicate payment evidence cannot be approved from the cashier workflow.';
  end if;

  normalized_method := public.normalize_payment_method(
    coalesce(target_invoice.payment_method, target_order.payment_method)
  );
  effective_reference := coalesce(
    nullif(left(trim(coalesce(payment_reference_number, '')), 120), ''),
    target_invoice.reference_number
  );
  effective_transaction := coalesce(
    nullif(left(trim(coalesce(payment_transaction_id, '')), 120), ''),
    target_invoice.transaction_id
  );
  effective_screenshot := coalesce(
    nullif(left(trim(coalesce(payment_screenshot_url, '')), 500), ''),
    target_invoice.screenshot_url
  );

  select exists (
    select 1
    from public.order_invoices related
    where related.restaurant_id = target_invoice.restaurant_id
      and related.order_id = target_invoice.order_id
      and related.id <> target_invoice.id
      and public.normalize_payment_method(related.payment_method) = normalized_method
      and (
        nullif(trim(coalesce(related.reference_number, '')), '') is not null
        or nullif(trim(coalesce(related.transaction_id, '')), '') is not null
        or nullif(trim(coalesce(related.screenshot_url, '')), '') is not null
      )
  ) into related_evidence_exists;

  if public.cashier_payment_method_requires_evidence(normalized_method)
    and effective_reference is null
    and effective_transaction is null
    and effective_screenshot is null
    and not related_evidence_exists
  then
    raise exception 'Digital payment evidence is required before verification.';
  end if;

  -- Explicitly stamp the locked acting shift before the legacy atomic gateway
  -- moves the invoice to paid/verified state. No trigger guesses ownership.
  update public.order_invoices
  set cashier_shift_id = acting_shift.id,
      updated_at = clock_timestamp()
  where id = target_invoice.id
    and restaurant_id = acting_shift.restaurant_id;

  verified_order := public.verify_order_payment_phase257_base(
    target_invoice.id,
    effective_reference,
    effective_transaction,
    effective_screenshot,
    false
  );

  select * into target_invoice
  from public.order_invoices invoices
  where invoices.id = target_invoice_id;

  if target_invoice.payment_status <> 'paid'
    or target_invoice.cashier_shift_id <> acting_shift.id
    or target_invoice.verified_by <> acting_cashier.id
    or target_invoice.restaurant_id <> acting_shift.restaurant_id
  then
    raise exception 'Payment settlement ownership could not be verified.';
  end if;

  return verified_order;
end;
$$;

revoke all on function public.verify_order_payment(
  uuid, text, text, text, boolean
) from public, anon;

grant execute on function public.verify_order_payment(
  uuid, text, text, text, boolean
) to authenticated;

comment on function public.verify_order_payment(
  uuid, text, text, text, boolean
) is 'Cashier-only invoice settlement on the acting cashier own locked open shift with method-appropriate evidence and idempotent same-owner replay.';

-- The public dining-session entry point locks the same shift before delegating
-- to the existing service-location/session transaction. close_cashier_shift
-- already locks this row, so close and settlement now serialize deterministically.
alter function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) rename to verify_dining_session_payment_phase257_base;

revoke all on function public.verify_dining_session_payment_phase257_base(
  uuid, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.verify_dining_session_payment_phase257_base(
  uuid, text, text, text, text, boolean
) to service_role;

create or replace function public.verify_dining_session_payment(
  target_dining_session_id uuid,
  selected_payment_method text,
  payment_reference_number text default null,
  payment_transaction_id text default null,
  payment_screenshot_url text default null,
  owner_duplicate_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session public.orders;
  acting_cashier public.restaurant_staff;
  acting_shift public.cashier_shifts;
  normalized_method text;
  due_count integer := 0;
  stored_evidence_exists boolean := false;
  payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to collect payment.';
  end if;

  select * into target_session
  from public.orders orders
  where orders.id = target_dining_session_id;

  if target_session.id is null then
    raise exception 'Dining session not found.';
  end if;

  select * into acting_cashier
  from public.restaurant_staff staff
  where staff.restaurant_id = target_session.restaurant_id
    and staff.user_id = auth.uid()
    and staff.active
    and staff.role = 'cashier'
  limit 1;

  if acting_cashier.id is null then
    raise exception 'Only an active cashier may settle a dining session.';
  end if;

  select * into acting_shift
  from public.cashier_shifts shifts
  where shifts.restaurant_id = target_session.restaurant_id
    and shifts.opened_by = acting_cashier.id
    and shifts.closed_at is null
  order by shifts.opened_at desc
  limit 1
  for update;

  if acting_shift.id is null then
    raise exception 'No open cashier shift. Open your shift before collecting payment.';
  end if;

  normalized_method := public.normalize_payment_method(selected_payment_method);

  select count(*) into due_count
  from public.order_invoices invoices
  where invoices.restaurant_id = target_session.restaurant_id
    and invoices.order_id = target_session.id
    and invoices.payment_status in ('pending', 'held');

  if due_count > 0 and public.cashier_payment_method_requires_evidence(normalized_method) then
    select exists (
      select 1
      from public.order_invoices invoices
      where invoices.restaurant_id = target_session.restaurant_id
        and invoices.order_id = target_session.id
        and invoices.payment_status in ('pending', 'held')
        and (
          nullif(trim(coalesce(invoices.reference_number, '')), '') is not null
          or nullif(trim(coalesce(invoices.transaction_id, '')), '') is not null
          or nullif(trim(coalesce(invoices.screenshot_url, '')), '') is not null
        )
    ) into stored_evidence_exists;

    if nullif(trim(coalesce(payment_reference_number, '')), '') is null
      and nullif(trim(coalesce(payment_transaction_id, '')), '') is null
      and nullif(trim(coalesce(payment_screenshot_url, '')), '') is null
      and not stored_evidence_exists
    then
      raise exception 'Digital payment evidence is required before verification.';
    end if;
  end if;

  payload := public.verify_dining_session_payment_phase257_base(
    target_dining_session_id,
    selected_payment_method,
    payment_reference_number,
    payment_transaction_id,
    payment_screenshot_url,
    owner_duplicate_override
  );

  if exists (
    select 1
    from public.order_invoices invoices
    where invoices.restaurant_id = target_session.restaurant_id
      and invoices.order_id = target_session.id
      and invoices.payment_status = 'paid'
      and invoices.verified_by = acting_cashier.id
      and invoices.verified_at >= transaction_timestamp()
      and (
        invoices.cashier_shift_id is distinct from acting_shift.id
        or invoices.restaurant_id is distinct from acting_shift.restaurant_id
      )
  ) then
    raise exception 'Payment settlement ownership could not be verified.';
  end if;

  return payload || jsonb_build_object('cashier_shift_id', acting_shift.id);
end;
$$;

revoke all on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) from public, anon;

grant execute on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) to authenticated;

comment on function public.verify_dining_session_payment(
  uuid, text, text, text, text, boolean
) is 'Cashier-only dining-session settlement serialized against close on the acting cashier own open shift; digital methods require existing or submitted evidence.';
