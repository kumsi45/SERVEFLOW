-- Phase 9.15D: reconcile the canonical customer menu to the exact approved snapshot.
-- This wraps the existing transactional publisher without changing tables or RLS.

create or replace function public.publish_ai_menu_draft_exact(
  target_restaurant_id uuid,
  target_draft_id uuid,
  target_review_revision integer,
  published_images jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  state jsonb;
  active_item_ids uuid[];
begin
  result := public.publish_ai_menu_draft(
    target_restaurant_id,
    target_draft_id,
    target_review_revision,
    published_images
  );

  select draft.review_state into state
  from public.ai_menu_import_drafts draft
  where draft.id = target_draft_id
    and draft.restaurant_id = target_restaurant_id;

  -- The published image map is authoritative. A null entry deliberately clears
  -- an older image so the shared resolver uses the ServeFlow placeholder.
  update public.menu_items item
  set image_url = nullif(btrim(published_images->>link.draft_item_id), '')
  from public.ai_menu_publish_item_links link
  where link.draft_id = target_draft_id
    and link.menu_item_id = item.id
    and item.restaurant_id = target_restaurant_id
    and exists (
      select 1
      from jsonb_array_elements(state->'items') snapshot_item
      where snapshot_item->>'id' = link.draft_item_id
        and coalesce((snapshot_item->>'approved')::boolean, false)
        and not coalesce((snapshot_item->>'deleted')::boolean, false)
        and not coalesce((snapshot_item->>'hidden')::boolean, false)
        and not coalesce((snapshot_item->>'rejected')::boolean, false)
    );

  select coalesce(array_agg(link.menu_item_id), array[]::uuid[]) into active_item_ids
  from public.ai_menu_publish_item_links link
  where link.draft_id = target_draft_id
    and exists (
      select 1
      from jsonb_array_elements(state->'items') snapshot_item
      where snapshot_item->>'id' = link.draft_item_id
        and coalesce((snapshot_item->>'approved')::boolean, false)
        and not coalesce((snapshot_item->>'deleted')::boolean, false)
        and not coalesce((snapshot_item->>'hidden')::boolean, false)
        and not coalesce((snapshot_item->>'rejected')::boolean, false)
    );

  update public.menu_items item
  set available = false,
      archived_at = coalesce(item.archived_at, now())
  where item.restaurant_id = target_restaurant_id
    and not (item.id = any(active_item_ids));

  -- A confirmed publish is the terminal onboarding event. Persist it inside
  -- the same transaction so later logins cannot reopen the wizard.
  update public.restaurants restaurant
  set setup_status = coalesce(restaurant.setup_status, '{}'::jsonb) || jsonb_build_object(
    'completed', true,
    'completed_at', coalesce(restaurant.setup_status->'completed_at', to_jsonb(now())),
    'completed_by', coalesce(restaurant.setup_status->'completed_by', to_jsonb(auth.uid()))
  )
  where restaurant.id = target_restaurant_id;

  return result;
end;
$$;

revoke all on function public.publish_ai_menu_draft_exact(uuid,uuid,integer,jsonb) from public, anon;
grant execute on function public.publish_ai_menu_draft_exact(uuid,uuid,integer,jsonb) to authenticated, service_role;
