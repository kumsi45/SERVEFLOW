-- Phase 9.8.5: private AI food image draft storage only.
-- Generated assets remain Review Studio drafts and are never published to menu,
-- ordering, payment, kitchen, inventory, recipe, QR, theme, or OCR workflows.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-item-image-drafts',
  'menu-item-image-drafts',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists menu_item_image_drafts_storage_select_owner on storage.objects;
drop policy if exists menu_item_image_drafts_storage_insert_owner on storage.objects;
drop policy if exists menu_item_image_drafts_storage_update_owner on storage.objects;
drop policy if exists menu_item_image_drafts_storage_delete_owner on storage.objects;

create policy menu_item_image_drafts_storage_select_owner
on storage.objects
for select
to authenticated
using (
  bucket_id = 'menu-item-image-drafts'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner', 'manager']::public.restaurant_staff_role[]
  )
);

create policy menu_item_image_drafts_storage_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'menu-item-image-drafts'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner', 'manager']::public.restaurant_staff_role[]
  )
);

create policy menu_item_image_drafts_storage_update_owner
on storage.objects
for update
to authenticated
using (false)
with check (false);

create policy menu_item_image_drafts_storage_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'menu-item-image-drafts'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner', 'manager']::public.restaurant_staff_role[]
  )
);
