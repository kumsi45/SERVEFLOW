-- Deliver Smart QR assistance requests through the existing waiter realtime channel.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'waiter_assistance_requests'
  ) then
    alter publication supabase_realtime add table public.waiter_assistance_requests;
  end if;
end;
$$;

alter table public.waiter_assistance_requests replica identity full;
