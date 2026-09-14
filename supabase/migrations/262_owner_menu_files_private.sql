-- Owner Menu Phase 1A: private source documents, not customer menu photos.
-- No metadata rewrite: file_path is the durable object identity.
update storage.buckets set public = false where id = 'menu-files';

drop policy if exists menu_files_select_public on storage.objects;
drop policy if exists menu_files_select_owner on storage.objects;
create policy menu_files_select_owner
on storage.objects for select to authenticated
using (
  bucket_id = 'menu-files'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else null::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);
-- Existing INSERT/UPDATE/DELETE already enforce this same Owner authority.
-- All other buckets, policies, grants, RPCs and realtime remain unchanged.
