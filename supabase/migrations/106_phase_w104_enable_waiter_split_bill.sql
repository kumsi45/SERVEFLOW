-- Split Bill is now exposed in the waiter POS.
grant execute on function public.split_waiter_bill(uuid, uuid[]) to authenticated, service_role;
