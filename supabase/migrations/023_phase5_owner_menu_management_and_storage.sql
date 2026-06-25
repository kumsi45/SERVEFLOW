-- SERVEFLOW Phase 5 owner menu management and storage.
-- Allows authoritative restaurant owners to manage menu records and menu photos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-photos',
  'menu-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists categories_manage_admin_or_owner_same_restaurant on public.categories;
drop policy if exists categories_manage_admin_same_restaurant on public.categories;

create policy categories_manage_admin_or_owner_same_restaurant
on public.categories
for all
to authenticated
using (
  (
    public.is_restaurant_member(restaurant_id)
    and public.has_any_role(array['admin'::public.user_role])
  )
  or public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
)
with check (
  (
    public.is_restaurant_member(restaurant_id)
    and public.has_any_role(array['admin'::public.user_role])
  )
  or public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

drop policy if exists menu_items_manage_admin_or_owner_same_restaurant on public.menu_items;
drop policy if exists menu_items_manage_admin_same_restaurant on public.menu_items;

create policy menu_items_manage_admin_or_owner_same_restaurant
on public.menu_items
for all
to authenticated
using (
  (
    public.is_restaurant_member(restaurant_id)
    and public.has_any_role(array['admin'::public.user_role])
  )
  or public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
)
with check (
  (
    public.is_restaurant_member(restaurant_id)
    and public.has_any_role(array['admin'::public.user_role])
  )
  or public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

drop policy if exists menu_photos_select_public on storage.objects;
drop policy if exists menu_photos_insert_owner on storage.objects;
drop policy if exists menu_photos_update_owner on storage.objects;
drop policy if exists menu_photos_delete_owner on storage.objects;

create policy menu_photos_select_public
on storage.objects
for select
to public
using (bucket_id = 'menu-photos');

create policy menu_photos_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'menu-photos'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_photos_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'menu-photos'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
)
with check (
  bucket_id = 'menu-photos'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_photos_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'menu-photos'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);

update public.restaurant_staff staff
set email = lower(auth_users.email)
from auth.users auth_users
where staff.user_id = auth_users.id
  and staff.email is null
  and auth_users.email is not null;
