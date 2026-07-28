-- ServeFlow Phase 9.11: one private Review Studio draft architecture for
-- uploaded menus, starter templates, and owner-created manual menus.
-- Production menu and publishing tables are intentionally unchanged.

alter table public.ai_menu_import_drafts
  alter column source_draft_id drop not null;

alter table public.ai_menu_import_drafts
  add column if not exists source_kind text not null default 'upload',
  add column if not exists source_reference text;

alter table public.ai_menu_import_drafts
  drop constraint if exists ai_menu_import_drafts_source_kind_check;

alter table public.ai_menu_import_drafts
  add constraint ai_menu_import_drafts_source_kind_check
  check (source_kind in ('upload', 'starter', 'manual'));

alter table public.ai_menu_import_drafts
  drop constraint if exists ai_menu_import_drafts_source_identity_check;

alter table public.ai_menu_import_drafts
  add constraint ai_menu_import_drafts_source_identity_check
  check (
    (source_kind = 'upload' and source_draft_id is not null)
    or
    (source_kind in ('starter', 'manual') and source_draft_id is null)
  );

create index if not exists ai_menu_import_drafts_source_kind_idx
  on public.ai_menu_import_drafts (restaurant_id, source_kind, created_at desc);

comment on column public.ai_menu_import_drafts.source_kind is
  'Private Review Studio source: uploaded menu, starter template, or manual menu.';

comment on column public.ai_menu_import_drafts.source_reference is
  'Non-sensitive source label such as a starter template key. Never contains uploaded menu content.';
