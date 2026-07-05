-- SERVEFLOW Kitchen Stations Phase 4A.1.
-- Owner Staff Management station assignment audit labels only.

alter type public.staff_activity_action add value if not exists 'kitchen_staff_station_assigned';
alter type public.staff_activity_action add value if not exists 'kitchen_staff_station_changed';
