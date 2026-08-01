-- Phase 9.15E: selected Smart Library masters become approved assets when the
-- owner publishes an approved menu item. This aligns Owner Preview and Customer Menu.

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
  select draft.review_state into state
  from public.ai_menu_import_drafts draft
  where draft.id = target_draft_id
    and draft.restaurant_id = target_restaurant_id
  for update;

  if state is null then raise exception 'Review Studio draft was not found.'; end if;

  select jsonb_set(state, '{items}', coalesce(jsonb_agg(
    case
      when coalesce((item->>'approved')::boolean, false)
        and nullif(item#>>'{imageDraft,selectedVersionId}', '') is not null
        and exists (
          select 1 from jsonb_array_elements(item#>'{imageDraft,versions}') candidate
          where candidate->>'id' = item#>>'{imageDraft,selectedVersionId}'
            and lower(coalesce(candidate->>'source', '')) = 'master'
            and lower(coalesce(candidate->>'status', '')) in ('pending_review', 'ready')
            and candidate->>'imageUrl' like '%/storage/v1/object/public/smart-menu-images/%'
        )
      then jsonb_set(
        jsonb_set(item, '{imageDraft,status}', '"Approved"'::jsonb),
        '{imageDraft,versions}',
        coalesce((
          select jsonb_agg(
            case
              when version->>'id' = item#>>'{imageDraft,selectedVersionId}'
                and lower(coalesce(version->>'source', '')) = 'master'
                and lower(coalesce(version->>'status', '')) in ('pending_review', 'ready')
                and version->>'imageUrl' like '%/storage/v1/object/public/smart-menu-images/%'
              then jsonb_set(version, '{status}', '"Approved"'::jsonb)
              else version
            end
          )
          from jsonb_array_elements(item#>'{imageDraft,versions}') version
        ), '[]'::jsonb)
      )
      else item
    end
  ), '[]'::jsonb)) into state
  from jsonb_array_elements(state->'items') item;

  update public.ai_menu_import_drafts
  set review_state = state
  where id = target_draft_id
    and restaurant_id = target_restaurant_id
    and review_revision = target_review_revision;

  result := public.publish_ai_menu_draft(target_restaurant_id, target_draft_id, target_review_revision, published_images);

  update public.menu_items item
  set image_url = nullif(btrim(published_images->>link.draft_item_id), '')
  from public.ai_menu_publish_item_links link
  where link.draft_id = target_draft_id
    and link.menu_item_id = item.id
    and item.restaurant_id = target_restaurant_id
    and exists (
      select 1 from jsonb_array_elements(state->'items') snapshot_item
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
      select 1 from jsonb_array_elements(state->'items') snapshot_item
      where snapshot_item->>'id' = link.draft_item_id
        and coalesce((snapshot_item->>'approved')::boolean, false)
        and not coalesce((snapshot_item->>'deleted')::boolean, false)
        and not coalesce((snapshot_item->>'hidden')::boolean, false)
        and not coalesce((snapshot_item->>'rejected')::boolean, false)
    );

  update public.menu_items item set available = false, archived_at = coalesce(item.archived_at, now())
  where item.restaurant_id = target_restaurant_id and not (item.id = any(active_item_ids));

  update public.restaurants restaurant
  set setup_status = coalesce(restaurant.setup_status, '{}'::jsonb) || jsonb_build_object(
    'completed', true,
    'completed_at', coalesce(restaurant.setup_status->'completed_at', to_jsonb(now())),
    'completed_by', coalesce(restaurant.setup_status->'completed_by', to_jsonb(auth.uid()))
  ) where restaurant.id = target_restaurant_id;

  return result;
end;
$$;

revoke all on function public.publish_ai_menu_draft_exact(uuid,uuid,integer,jsonb) from public, anon;
grant execute on function public.publish_ai_menu_draft_exact(uuid,uuid,integer,jsonb) to authenticated, service_role;

-- Repair existing latest snapshots without requiring a manual republish.
with latest as (
  select distinct on (version.restaurant_id) version.restaurant_id, version.draft_id, version.review_snapshot
  from public.ai_menu_publish_versions version
  order by version.restaurant_id, version.published_at desc, version.published_version desc
), selected as (
  select latest.restaurant_id, link.menu_item_id, selected_version.payload
  from latest
  cross join lateral jsonb_array_elements(latest.review_snapshot->'items') item
  join public.ai_menu_publish_item_links link on link.draft_id = latest.draft_id and link.draft_item_id = item->>'id'
  left join lateral (
    select version as payload from jsonb_array_elements(item#>'{imageDraft,versions}') version
    where version->>'id' = item#>>'{imageDraft,selectedVersionId}' limit 1
  ) selected_version on true
  where coalesce((item->>'approved')::boolean, false)
    and not coalesce((item->>'deleted')::boolean, false)
    and not coalesce((item->>'hidden')::boolean, false)
    and not coalesce((item->>'rejected')::boolean, false)
)
update public.menu_items item
set image_url = nullif(btrim(selected.payload->>'imageUrl'), '')
from selected
where item.restaurant_id = selected.restaurant_id
  and item.id = selected.menu_item_id
  and selected.payload->>'imageUrl' like '%/storage/v1/object/public/%'
  and lower(coalesce(selected.payload->>'status', '')) in ('approved', 'owner upload', 'pending_review', 'ready');
