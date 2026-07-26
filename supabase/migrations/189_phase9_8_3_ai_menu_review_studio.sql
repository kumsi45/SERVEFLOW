-- Phase 9.8.3: versioned AI Import Draft review state only.
-- No operational menu, category, inventory, recipe, ordering, payment,
-- realtime, QR, or publishing tables are changed.

alter table public.ai_menu_import_drafts
  add column if not exists review_state jsonb,
  add column if not exists review_revision integer not null default 0,
  add column if not exists review_updated_by uuid references auth.users(id) on delete set null,
  add column if not exists review_updated_at timestamptz;

alter table public.ai_menu_import_drafts
  drop constraint if exists ai_menu_import_drafts_review_revision_check;
alter table public.ai_menu_import_drafts
  add constraint ai_menu_import_drafts_review_revision_check
  check (review_revision >= 0);

alter table public.ai_menu_import_drafts
  drop constraint if exists ai_menu_import_drafts_review_state_check;
alter table public.ai_menu_import_drafts
  add constraint ai_menu_import_drafts_review_state_check
  check (review_state is null or jsonb_typeof(review_state) = 'object');

comment on column public.ai_menu_import_drafts.review_state is
  'Owner-edited Review Studio state. Draft-only data; never an operational or published menu.';
comment on column public.ai_menu_import_drafts.review_revision is
  'Optimistic concurrency revision for autosaved Review Studio edits.';

drop policy if exists ai_menu_import_drafts_select_owner
  on public.ai_menu_import_drafts;
drop policy if exists ai_menu_import_drafts_select_reviewer
  on public.ai_menu_import_drafts;

create policy ai_menu_import_drafts_select_reviewer
on public.ai_menu_import_drafts
for select
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['owner', 'manager']::public.restaurant_staff_role[]
  )
);

-- Authenticated users remain read-only at the table boundary. Owner writes
-- are validated and revision-checked by the menu-review-draft Edge Function.
revoke insert, update, delete on public.ai_menu_import_drafts from authenticated;
grant select on public.ai_menu_import_drafts to authenticated;

