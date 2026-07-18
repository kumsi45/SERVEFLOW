-- Customer feedback images contain tenant/customer data and must never be a
-- public bucket. Anonymous QR customers may upload, but only same-restaurant
-- staff can read the resulting object.
update storage.buckets
set public = false
where id = 'feedback-photos';

drop policy if exists feedback_photos_select_public on storage.objects;
drop policy if exists feedback_photos_select_staff_same_restaurant on storage.objects;
create policy feedback_photos_select_staff_same_restaurant
on storage.objects
for select
to authenticated
using (
  bucket_id = 'feedback-photos'
  and array_length(storage.foldername(name), 1) >= 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and public.has_staff_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'cashier']::public.restaurant_staff_role[]
  )
);

-- Normalize legacy public URLs to private object paths before enforcing the
-- tenant prefix. The bucket privacy change makes old public URLs inaccessible.
update public.public_order_feedback
set photo_url = substring(photo_url from '/feedback-photos/(.+)$')
where photo_url like '%/feedback-photos/%';

update public.public_order_feedback
set photo_url = null
where photo_url is not null
  and photo_url not like restaurant_id::text || '/%';

alter table public.public_order_feedback
  drop constraint if exists public_order_feedback_photo_tenant_path,
  add constraint public_order_feedback_photo_tenant_path
  check (photo_url is null or photo_url like restaurant_id::text || '/%');
