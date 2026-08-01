-- Phase 11.2.1 hotfix: transactional default-printer assignment.
-- Runtime function only; no table, column, constraint, index, or RLS change.
create or replace function public.save_business_printer(
  target_restaurant_id uuid,
  printer_payload jsonb
)
returns public.business_printers
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_id uuid := (printer_payload->>'id')::uuid;
  requested_purpose text := printer_payload->>'purpose';
  requested_default boolean := coalesce((printer_payload->>'is_default')::boolean, false);
  saved_printer public.business_printers;
begin
  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then
    raise exception 'Only an active owner can configure printers.';
  end if;

  if requested_default then
    update public.business_printers
    set is_default = false
    where restaurant_id = target_restaurant_id
      and purpose = requested_purpose
      and is_default
      and id <> requested_id;
  end if;

  insert into public.business_printers(
    id, restaurant_id, name, purpose, brand, model, printer_type, paper_size,
    status, enabled, is_default, priority, backup_for_purpose, physical_location
  ) values (
    requested_id, target_restaurant_id, printer_payload->>'name', requested_purpose,
    coalesce(nullif(btrim(printer_payload->>'brand'), ''), 'Generic'), nullif(btrim(printer_payload->>'model'), ''),
    coalesce(printer_payload->>'printer_type', 'thermal'), coalesce(printer_payload->>'paper_size', '80mm'),
    coalesce(printer_payload->>'status', 'not_configured'), coalesce((printer_payload->>'enabled')::boolean, true),
    requested_default, coalesce((printer_payload->>'priority')::integer, 100),
    nullif(printer_payload->>'backup_for_purpose', ''), nullif(btrim(printer_payload->>'physical_location'), '')
  )
  on conflict (id) do update set
    name = excluded.name, purpose = excluded.purpose, brand = excluded.brand, model = excluded.model,
    printer_type = excluded.printer_type, paper_size = excluded.paper_size, status = excluded.status,
    enabled = excluded.enabled, is_default = excluded.is_default, priority = excluded.priority,
    backup_for_purpose = excluded.backup_for_purpose, physical_location = excluded.physical_location
  where business_printers.restaurant_id = target_restaurant_id
  returning * into saved_printer;

  if saved_printer.id is null then raise exception 'Printer does not belong to this business.'; end if;
  return saved_printer;
end;
$$;

revoke all on function public.save_business_printer(uuid, jsonb) from public, anon;
grant execute on function public.save_business_printer(uuid, jsonb) to authenticated;

comment on function public.save_business_printer(uuid, jsonb) is
  'Owner-only atomic printer upsert that clears the previous tenant-purpose default before assigning a new one.';
