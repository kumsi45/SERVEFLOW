-- SERVEFLOW Phase 4E public QR hardening.
-- Restaurant table rows are managed through security-definer RPCs only.

revoke all on public.restaurant_tables from anon;
revoke all on public.restaurant_tables from authenticated;

grant select on public.restaurant_tables to anon;
grant select on public.restaurant_tables to authenticated;

grant select, insert, update, delete on public.restaurant_tables to service_role;
