-- Phase P7.8: created_by_staff_id is the authoritative staff invoice identity.
-- created_by_display_name remains an immutable-at-creation presentation snapshot.

-- Future sources use stable machine identifiers without requiring schema changes.
alter table public.order_invoices
  drop constraint if exists order_invoices_invoice_source_allowed,
  add constraint order_invoices_invoice_source_allowed
    check (invoice_source is null or invoice_source ~ '^[a-z][a-z0-9_]{0,63}$');

-- A staff record may be deactivated and its auth user may be removed, but the
-- identity row cannot be hard-deleted while historical invoices reference it.
alter table public.order_invoices
  drop constraint if exists order_invoices_created_by_staff_same_restaurant,
  add constraint order_invoices_created_by_staff_same_restaurant
    foreign key (restaurant_id, created_by_staff_id)
    references public.restaurant_staff (restaurant_id, id)
    on delete restrict;

-- P7.7's broad backfill could copy an order waiter onto a QR invoice. QR has no
-- staff creator, so this is deterministic cleanup rather than inferred identity.
update public.order_invoices
set created_by_staff_id = null,
    updated_at = now()
where invoice_source = 'public_qr'
  and created_by_staff_id is not null;

create or replace function public.enforce_authoritative_invoice_creator()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  creator public.restaurant_staff;
begin
  new.invoice_source := coalesce(nullif(lower(trim(new.invoice_source)), ''), 'unknown');

  if new.invoice_source in ('public_qr', 'authenticated') then
    if new.created_by_staff_id is not null then
      raise exception '% invoices cannot have a staff creator.', new.invoice_source;
    end if;
    return new;
  end if;

  if new.invoice_source in ('waiter', 'cashier') then
    if new.created_by_staff_id is null then
      raise exception '% invoices require created_by_staff_id.', new.invoice_source;
    end if;

    select * into creator
    from public.restaurant_staff staff
    where staff.restaurant_id = new.restaurant_id
      and staff.id = new.created_by_staff_id;

    if creator.id is null then
      raise exception 'Invoice creator does not belong to this restaurant.';
    end if;

    if creator.role::text <> new.invoice_source then
      raise exception '% invoice creator must have the % role.', new.invoice_source, new.invoice_source;
    end if;
  elsif new.created_by_staff_id is not null then
    select * into creator
    from public.restaurant_staff staff
    where staff.restaurant_id = new.restaurant_id
      and staff.id = new.created_by_staff_id;
    if creator.id is null then
      raise exception 'Invoice creator does not belong to this restaurant.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_authoritative_invoice_creator_before_write on public.order_invoices;
create trigger enforce_authoritative_invoice_creator_before_write
before insert or update of invoice_source, created_by_staff_id on public.order_invoices
for each row execute function public.enforce_authoritative_invoice_creator();

-- Cashier presentation resolves the authoritative identity first and falls back
-- to the stored snapshot only when no staff row can be resolved.
do $$
declare
  queue_definition text;
begin
  select pg_get_functiondef('public.get_cashier_invoice_queue(uuid)'::regprocedure)
  into queue_definition;
  queue_definition := replace(
    queue_definition,
    'COALESCE(invoices.created_by_display_name, creator.display_name,',
    'COALESCE(creator.display_name, invoices.created_by_display_name,'
  );
  queue_definition := replace(
    queue_definition,
    'coalesce(invoices.created_by_display_name, creator.display_name,',
    'coalesce(creator.display_name, invoices.created_by_display_name,'
  );
  queue_definition := replace(
    queue_definition,
    'COALESCE(invoices.created_by_display_name, creator.display_name) AS waiter_name',
    'COALESCE(creator.display_name, invoices.created_by_display_name) AS waiter_name'
  );
  queue_definition := replace(
    queue_definition,
    'coalesce(invoices.created_by_display_name, creator.display_name) AS waiter_name',
    'coalesce(creator.display_name, invoices.created_by_display_name) AS waiter_name'
  );
  execute queue_definition;
end;
$$;

create or replace function public.get_owner_invoice_creator_performance(
  target_restaurant_id uuid,
  range_start timestamptz,
  range_end timestamptz
)
returns table (
  staff_id uuid,
  display_name text,
  role text,
  invoice_count bigint,
  verified_invoice_count bigint,
  revenue numeric,
  average_ticket numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only an active owner may view creator performance.';
  end if;

  return query
  select
    invoices.created_by_staff_id,
    coalesce(staff.display_name, max(invoices.created_by_display_name)) as display_name,
    coalesce(staff.role::text, 'former_staff') as role,
    count(*) as invoice_count,
    count(*) filter (where invoices.status = 'verified') as verified_invoice_count,
    coalesce(sum(invoices.total_price) filter (where invoices.status = 'verified'), 0)::numeric as revenue,
    coalesce(avg(invoices.total_price) filter (where invoices.status = 'verified'), 0)::numeric as average_ticket
  from public.order_invoices invoices
  left join public.restaurant_staff staff
    on staff.restaurant_id = invoices.restaurant_id
   and staff.id = invoices.created_by_staff_id
  where invoices.restaurant_id = target_restaurant_id
    and invoices.created_by_staff_id is not null
    and invoices.created_at >= range_start
    and invoices.created_at < range_end
  group by invoices.created_by_staff_id, staff.display_name, staff.role;
end;
$$;

revoke all on function public.enforce_authoritative_invoice_creator() from public, anon, authenticated;
revoke all on function public.get_owner_invoice_creator_performance(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.enforce_authoritative_invoice_creator() to service_role;
grant execute on function public.get_owner_invoice_creator_performance(uuid, timestamptz, timestamptz) to authenticated, service_role;
