-- Phase 9.15D: one-time repair for restaurants published before migration 204.
-- Uses the latest immutable publish snapshot and existing draft-to-canonical links.

with latest as (
  select distinct on (version.restaurant_id)
    version.restaurant_id,
    version.draft_id,
    version.review_snapshot
  from public.ai_menu_publish_versions version
  order by version.restaurant_id, version.published_at desc, version.published_version desc
), active as (
  select
    latest.restaurant_id,
    link.menu_item_id,
    snapshot_item,
    selected_version.payload as selected_version
  from latest
  cross join lateral jsonb_array_elements(latest.review_snapshot->'items') snapshot_item
  join public.ai_menu_publish_item_links link
    on link.draft_id = latest.draft_id
   and link.draft_item_id = snapshot_item->>'id'
  left join lateral (
    select version as payload
    from jsonb_array_elements(snapshot_item#>'{imageDraft,versions}') version
    where version->>'id' = snapshot_item#>>'{imageDraft,selectedVersionId}'
    limit 1
  ) selected_version on true
  where coalesce((snapshot_item->>'approved')::boolean, false)
    and not coalesce((snapshot_item->>'deleted')::boolean, false)
    and not coalesce((snapshot_item->>'hidden')::boolean, false)
    and not coalesce((snapshot_item->>'rejected')::boolean, false)
)
update public.menu_items item
set image_url = case
  when lower(coalesce(active.selected_version->>'status', '')) in ('approved', 'owner upload')
    and active.selected_version->>'imageUrl' like '%/storage/v1/object/public/%'
  then nullif(btrim(active.selected_version->>'imageUrl'), '')
  else null
end,
available = true,
archived_at = null
from active
where item.restaurant_id = active.restaurant_id
  and item.id = active.menu_item_id;

with latest as (
  select distinct on (version.restaurant_id)
    version.restaurant_id,
    version.draft_id,
    version.review_snapshot
  from public.ai_menu_publish_versions version
  order by version.restaurant_id, version.published_at desc, version.published_version desc
), active_ids as (
  select latest.restaurant_id, array_agg(link.menu_item_id) as menu_item_ids
  from latest
  cross join lateral jsonb_array_elements(latest.review_snapshot->'items') snapshot_item
  join public.ai_menu_publish_item_links link
    on link.draft_id = latest.draft_id
   and link.draft_item_id = snapshot_item->>'id'
  where coalesce((snapshot_item->>'approved')::boolean, false)
    and not coalesce((snapshot_item->>'deleted')::boolean, false)
    and not coalesce((snapshot_item->>'hidden')::boolean, false)
    and not coalesce((snapshot_item->>'rejected')::boolean, false)
  group by latest.restaurant_id
)
update public.menu_items item
set available = false,
    archived_at = coalesce(item.archived_at, now())
from active_ids
where item.restaurant_id = active_ids.restaurant_id
  and not (item.id = any(active_ids.menu_item_ids));

update public.restaurants restaurant
set setup_status = coalesce(restaurant.setup_status, '{}'::jsonb) || jsonb_build_object(
  'completed', true,
  'completed_at', coalesce(restaurant.setup_status->'completed_at', to_jsonb(now()))
)
where exists (
  select 1
  from public.ai_menu_import_drafts draft
  where draft.restaurant_id = restaurant.id
    and draft.publish_status = 'published'
);
