-- SERVEFLOW restaurant_staff grant hardening.
-- RLS already blocks anonymous staff access, but the table grants should not
-- expose mutation/read privileges to anon at all.

revoke select, insert, update, delete, truncate, references, trigger
on public.restaurant_staff
from anon;

grant select, insert, update
on public.restaurant_staff
to authenticated;
