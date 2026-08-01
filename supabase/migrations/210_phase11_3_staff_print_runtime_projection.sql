-- Role-checked operational projection for printer routing. No schema changes.
create or replace function public.get_staff_print_runtime(target_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_staff_role(
    target_restaurant_id,
    array['owner','manager','cashier','kitchen','waiter']::public.restaurant_staff_role[]
  ) then
    raise exception 'Not authorized for this business.';
  end if;

  return jsonb_build_object(
    'kitchen_output_mode', coalesce((select settings.kitchen_output_mode from public.business_printing_settings settings where settings.restaurant_id = target_restaurant_id), 'kds'),
    'printers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', printer.id, 'purpose', printer.purpose, 'status', printer.status,
        'enabled', printer.enabled, 'priority', printer.priority
      ) order by printer.priority, printer.created_at)
      from public.business_printers printer
      where printer.restaurant_id = target_restaurant_id and printer.enabled and printer.deleted_at is null
    ), '[]'::jsonb),
    'station_mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kitchen_station_id', mapping.kitchen_station_id,
        'printer_id', mapping.printer_id,
        'active', mapping.active
      ))
      from public.printer_station_mappings mapping
      where mapping.restaurant_id = target_restaurant_id and mapping.active and mapping.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_staff_print_runtime(uuid) from public, anon;
grant execute on function public.get_staff_print_runtime(uuid) to authenticated;

comment on function public.get_staff_print_runtime(uuid) is
  'Tenant-checked operational printer IDs and routing state for authorized staff; excludes connection credentials and owner-only metadata.';
