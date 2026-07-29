-- Phase 9.13.1: permanent provider-independent Smart Image Library foundation.
-- This migration creates infrastructure only. It does not generate or upload images.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('smart-menu-images', 'smart-menu-images', true, 10485760, array['image/avif', 'image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists smart_menu_images_public_read on storage.objects;
create policy smart_menu_images_public_read on storage.objects
for select to public using (bucket_id = 'smart-menu-images');
-- There is intentionally no client write policy. Future provider adapters write
-- immutable master assets with the service role after review approval.

do $$ begin
  create type public.smart_menu_image_status as enum ('PLACEHOLDER','GENERATING','PENDING_REVIEW','APPROVED','ARCHIVED');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.smart_menu_image_source as enum ('MASTER','CUSTOM','PLACEHOLDER');
exception when duplicate_object then null; end $$;

create table public.serveflow_smart_menu_images (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null,
  item_id uuid not null,
  base_storage_path text not null,
  placeholder_storage_path text not null default '_placeholders/default/v1/menu-item-640w.webp',
  status public.smart_menu_image_status not null default 'PLACEHOLDER',
  current_version integer not null default 0 check (current_version >= 0),
  provider_key text,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (library_id, item_id),
  unique (base_storage_path),
  foreign key (library_id, item_id) references public.serveflow_smart_menu_library_items(library_id, item_id) on delete cascade,
  check (base_storage_path ~ '^(restaurant|hotel|cafe|fast-food|bar-lounge|bakery)/[a-z0-9-]+/[a-z0-9-]+$'),
  check (placeholder_storage_path like '_placeholders/%')
);

create table public.serveflow_smart_menu_image_versions (
  id uuid primary key default gen_random_uuid(),
  smart_image_id uuid not null references public.serveflow_smart_menu_images(id) on delete cascade,
  version integer not null check (version > 0),
  status public.smart_menu_image_status not null,
  storage_path text not null,
  mime_type text not null check (mime_type in ('image/avif','image/webp','image/jpeg','image/png')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  byte_size bigint check (byte_size is null or byte_size > 0),
  checksum_sha256 text,
  provider_key text,
  provider_asset_id text,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  archived_at timestamptz,
  unique (smart_image_id, version, width, mime_type),
  unique (storage_path),
  check (storage_path ~ '^(restaurant|hotel|cafe|fast-food|bar-lounge|bakery)/[a-z0-9-]+/[a-z0-9-]+/v[0-9]{3}/[a-z0-9-]+-v[0-9]{3}-[0-9]+w\.(avif|webp|jpg|png)$')
);

create table public.restaurant_smart_menu_image_overrides (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  library_id uuid not null,
  item_id uuid not null,
  source public.smart_menu_image_source not null default 'MASTER',
  custom_image_url text,
  custom_thumbnail_url text,
  custom_version integer not null default 0 check (custom_version >= 0),
  status public.smart_menu_image_status not null default 'APPROVED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, library_id, item_id),
  foreign key (library_id, item_id) references public.serveflow_smart_menu_library_items(library_id, item_id) on delete restrict,
  check (
    (source = 'CUSTOM' and custom_image_url is not null)
    or (source in ('MASTER','PLACEHOLDER') and custom_image_url is null and custom_thumbnail_url is null)
  )
);

create index serveflow_smart_menu_image_versions_lookup_idx on public.serveflow_smart_menu_image_versions(smart_image_id, status, version desc);
create index restaurant_smart_menu_image_overrides_restaurant_idx on public.restaurant_smart_menu_image_overrides(restaurant_id);

create trigger serveflow_smart_menu_images_set_updated_at before update on public.serveflow_smart_menu_images for each row execute function public.set_updated_at();
create trigger restaurant_smart_menu_image_overrides_set_updated_at before update on public.restaurant_smart_menu_image_overrides for each row execute function public.set_updated_at();

alter table public.serveflow_smart_menu_images enable row level security;
alter table public.serveflow_smart_menu_image_versions enable row level security;
alter table public.restaurant_smart_menu_image_overrides enable row level security;
revoke all on public.serveflow_smart_menu_images, public.serveflow_smart_menu_image_versions from public, anon;
grant select on public.serveflow_smart_menu_images, public.serveflow_smart_menu_image_versions to authenticated;
grant select, insert, update, delete on public.restaurant_smart_menu_image_overrides to authenticated;

create policy serveflow_smart_menu_images_read on public.serveflow_smart_menu_images for select to authenticated using (true);
create policy serveflow_smart_menu_image_versions_read on public.serveflow_smart_menu_image_versions for select to authenticated using (status in ('PLACEHOLDER','APPROVED'));
create policy restaurant_smart_menu_image_overrides_owner on public.restaurant_smart_menu_image_overrides for all to authenticated
using (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]))
with check (public.has_staff_role(restaurant_id, array['owner']::public.restaurant_staff_role[]));

insert into public.serveflow_smart_menu_images (library_id, item_id, base_storage_path)
select mapping.library_id, mapping.item_id,
  case library.restaurant_type
    when 'Restaurant' then 'restaurant' when 'Hotel' then 'hotel' when 'Cafe' then 'cafe'
    when 'Fast Food' then 'fast-food' when 'Bar & Lounge' then 'bar-lounge' when 'Bakery' then 'bakery'
  end || '/' || category.slug || '/' || trim(both '-' from regexp_replace(lower(item.name), '[^a-z0-9]+', '-', 'g'))
from public.serveflow_smart_menu_library_items mapping
join public.serveflow_smart_menu_libraries library on library.id = mapping.library_id
join public.serveflow_master_menu_items item on item.id = mapping.item_id
join public.serveflow_master_menu_categories category on category.id = item.category_id
on conflict (library_id, item_id) do nothing;

comment on table public.serveflow_smart_menu_images is 'Provider-independent master image identity and lifecycle. No generation is performed by this model.';
comment on table public.serveflow_smart_menu_image_versions is 'Immutable responsive image variants with deterministic CDN-ready storage paths.';
comment on table public.restaurant_smart_menu_image_overrides is 'Restaurant-level MASTER, CUSTOM, or PLACEHOLDER selection. Restore Default sets source to MASTER.';
commit;
