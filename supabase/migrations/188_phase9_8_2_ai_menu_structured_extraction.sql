-- Phase 9.8.2: provider-neutral structured extraction drafts.
-- Extraction results are isolated from menu, category, inventory, recipe,
-- ordering, payment, QR, and publishing tables.

create table if not exists public.ai_menu_import_drafts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  source_draft_id uuid not null references public.menu_import_drafts(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  provider text not null check (length(btrim(provider)) between 1 and 40),
  model text not null check (length(btrim(model)) between 1 and 100),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  source_updated_at timestamptz not null,
  structured_result jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_draft_id),
  check (
    (status = 'completed' and structured_result is not null and error_message is null and completed_at is not null)
    or (status = 'failed' and structured_result is null and error_message is not null and completed_at is not null)
    or (status = 'processing' and structured_result is null and error_message is null and completed_at is null)
  )
);

comment on table public.ai_menu_import_drafts is
  'AI-extracted import drafts for owner review only. These rows never create or publish operational menu data.';
comment on column public.ai_menu_import_drafts.structured_result is
  'Provider-neutral extraction JSON with per-field confidence, unrecognized text, and deterministic duplicate flags.';

create index if not exists ai_menu_import_drafts_restaurant_id_idx
  on public.ai_menu_import_drafts (restaurant_id, created_at);

drop trigger if exists ai_menu_import_drafts_set_updated_at
  on public.ai_menu_import_drafts;
create trigger ai_menu_import_drafts_set_updated_at
before update on public.ai_menu_import_drafts
for each row execute function public.set_updated_at();

alter table public.ai_menu_import_drafts enable row level security;

drop policy if exists ai_menu_import_drafts_select_owner
  on public.ai_menu_import_drafts;

create policy ai_menu_import_drafts_select_owner
on public.ai_menu_import_drafts
for select
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['owner']::public.restaurant_staff_role[]
  )
);

-- Only the service-role Edge Function writes extraction lifecycle/results.
revoke all on public.ai_menu_import_drafts from public, anon, authenticated;
grant select on public.ai_menu_import_drafts to authenticated;

