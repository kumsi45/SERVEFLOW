-- Phase 9.8.1: private AI Menu Builder upload drafts only.
-- No OCR, extraction, menu publishing, inventory, recipe, payment, or order
-- behavior is introduced by this migration.

create table if not exists public.menu_import_drafts (
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  object_path text not null,
  mime_type text not null check (
    mime_type in (
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  file_size bigint not null check (file_size > 0),
  status text not null default 'uploaded' check (status = 'uploaded'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, object_path)
);

comment on table public.menu_import_drafts is
  'Private source-file drafts for the setup wizard. Rows never create or publish menu, inventory, or recipe data.';

alter table public.menu_import_drafts enable row level security;

drop policy if exists menu_import_drafts_select_owner on public.menu_import_drafts;
drop policy if exists menu_import_drafts_insert_owner on public.menu_import_drafts;
drop policy if exists menu_import_drafts_update_owner on public.menu_import_drafts;
drop policy if exists menu_import_drafts_delete_owner on public.menu_import_drafts;

create policy menu_import_drafts_select_owner
on public.menu_import_drafts
for select
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_import_drafts_insert_owner
on public.menu_import_drafts
for insert
to authenticated
with check (
  public.has_staff_role(
    restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_import_drafts_update_owner
on public.menu_import_drafts
for update
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  )
)
with check (
  public.has_staff_role(
    restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_import_drafts_delete_owner
on public.menu_import_drafts
for delete
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  )
);

revoke all on public.menu_import_drafts from public, anon;
grant select, insert, update, delete on public.menu_import_drafts to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-import-drafts',
  'menu-import-drafts',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists menu_import_drafts_storage_select_owner on storage.objects;
drop policy if exists menu_import_drafts_storage_insert_owner on storage.objects;
drop policy if exists menu_import_drafts_storage_update_owner on storage.objects;
drop policy if exists menu_import_drafts_storage_delete_owner on storage.objects;

create policy menu_import_drafts_storage_select_owner
on storage.objects
for select
to authenticated
using (
  bucket_id = 'menu-import-drafts'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_import_drafts_storage_insert_owner
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'menu-import-drafts'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_import_drafts_storage_update_owner
on storage.objects
for update
to authenticated
using (
  bucket_id = 'menu-import-drafts'
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
  bucket_id = 'menu-import-drafts'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);

create policy menu_import_drafts_storage_delete_owner
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'menu-import-drafts'
  and public.has_staff_role(
    case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then ((storage.foldername(name))[1])::uuid
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    array['owner']::public.restaurant_staff_role[]
  )
);
