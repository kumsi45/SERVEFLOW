-- SERVEFLOW owner menu file uploads.
-- Stores full menu image/PDF uploads separately from individual menu item photos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-files',
  'menu-files',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.menu_uploads (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null,
  file_name text not null,
  file_path text not null,
  file_url text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (file_path),
  constraint menu_uploads_file_name_required
    check (length(trim(file_name)) > 0),
  constraint menu_uploads_file_path_restaurant_prefix
    check (file_path like restaurant_id::text || '/%'),
  constraint menu_uploads_allowed_mime_type
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'))
);

create index if not exists menu_uploads_restaurant_created_idx
on public.menu_uploads (restaurant_id, created_at desc);

alter table public.menu_uploads enable row level security;

grant select, insert, update, delete on public.menu_uploads to authenticated;

drop policy if exists menu_uploads_select_owner_same_restaurant on public.menu_uploads;
drop policy if exists menu_uploads_insert_owner_same_restaurant on public.menu_uploads;
drop policy if exists menu_uploads_update_owner_same_restaurant on public.menu_uploads;
drop policy if exists menu_uploads_delete_owner_same_restaurant on public.menu_uploads;

create policy menu_uploads_select_owner_same_restaurant
on public.menu_uploads
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

create policy menu_uploads_insert_owner_same_restaurant
on public.menu_uploads
for insert
to authenticated
with check (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
  and uploaded_by = auth.uid()
);

create policy menu_uploads_update_owner_same_restaurant
on public.menu_uploads
for update
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
)
with check (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

create policy menu_uploads_delete_owner_same_restaurant
on public.menu_uploads
for delete
to authenticated
using (
  public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[])
);

drop policy if exists menu_files_select_public on storage.objects;
drop policy if exists menu_files_insert_owner on storage.objects;
drop policy if exists menu_files_update_owner on storage.objects;
drop policy if exists menu_files_delete_owner on storage.objects;

create policy menu_files_select_public
on storage.objects
for select
to public
using (bucket_id = 'menu-files');

create policy menu_files_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'menu-files'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_files_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'menu-files'
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
  bucket_id = 'menu-files'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_files_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'menu-files'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);
