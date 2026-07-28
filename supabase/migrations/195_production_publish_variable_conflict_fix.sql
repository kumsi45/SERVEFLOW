-- Phase 9.10: fix ambiguous PL/pgSQL publish variables without changing the RPC contract.
-- This is the corrected Phase 9.8.6 function definition; local variables no longer shadow columns.

create or replace function public.publish_ai_menu_draft(
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
  draft public.ai_menu_import_drafts;
  state jsonb;
  category_entry jsonb;
  item_entry jsonb;
  localization_entry record;
  target_category_id uuid;
  target_menu_item_id uuid;
  canonical_name text;
  canonical_description text;
  category_name text;
  target_image_url text;
  next_version integer;
  categories_count integer := 0;
  items_count integer := 0;
  images_count integer := 0;
  languages_count integer := 0;
  active_items jsonb;
  actor_role text;
begin
  select staff.role::text into actor_role
  from public.restaurant_staff staff
  where staff.restaurant_id = target_restaurant_id
    and staff.user_id = auth.uid()
    and staff.role = 'owner'
    and staff.active = true
  limit 1;
  if actor_role is null then raise exception 'Only the restaurant owner may publish a menu.'; end if;
  if target_review_revision is null or target_review_revision < 0 then raise exception 'A valid draft revision is required.'; end if;
  if published_images is null or jsonb_typeof(published_images) <> 'object' then raise exception 'Published image map is invalid.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_draft_id::text, 986));
  select source.* into draft from public.ai_menu_import_drafts source
  where source.id = target_draft_id and source.restaurant_id = target_restaurant_id
  for update;
  if not found then raise exception 'Review Studio draft was not found.'; end if;
  if draft.status <> 'completed' or draft.review_state is null then raise exception 'Review Studio must be completed before publishing.'; end if;
  if draft.review_revision <> target_review_revision then raise exception 'A newer Review Studio revision exists. Reload before publishing.'; end if;
  if draft.publish_status = 'publishing' then raise exception 'This menu is already publishing.'; end if;

  state := draft.review_state;
  if state->>'schemaVersion' <> '2' or jsonb_typeof(state->'categories') <> 'array' or jsonb_typeof(state->'items') <> 'array' then
    raise exception 'Review Studio state is invalid.';
  end if;
  select coalesce(jsonb_agg(value), '[]'::jsonb) into active_items
  from jsonb_array_elements(state->'items')
  where not coalesce((value->>'deleted')::boolean, false)
    and not coalesce((value->>'hidden')::boolean, false)
    and not coalesce((value->>'rejected')::boolean, false);
  if jsonb_array_length(active_items) = 0 then raise exception 'At least one approved menu item is required.'; end if;
  if exists (select 1 from jsonb_array_elements(active_items) value where not coalesce((value->>'approved')::boolean, false)) then
    raise exception 'Approve every active Review Studio item before publishing.';
  end if;
  if exists (select 1 from jsonb_array_elements(active_items) value where nullif(btrim(value#>>'{name,value}'), '') is null or (value#>>'{price,value}') is null or nullif(value->>'categoryId', '') is null) then
    raise exception 'Every published item requires a name, price, and category.';
  end if;
  if exists (select 1 from jsonb_array_elements(active_items) value where (value#>>'{price,value}')::numeric < 0) then raise exception 'Menu prices cannot be negative.'; end if;
  if exists (select 1 from jsonb_array_elements(state->'categories') value group by lower(btrim(value->>'name')) having count(*) > 1) then raise exception 'Duplicate categories must be resolved before publishing.'; end if;
  if exists (select 1 from jsonb_array_elements(active_items) value group by lower(btrim(value#>>'{name,value}')) having count(*) > 1) then raise exception 'Duplicate menu items must be resolved before publishing.'; end if;
  if exists (
    select 1 from jsonb_array_elements(active_items) value
    where nullif(value#>>'{imageDraft,selectedVersionId}', '') is not null
      and not exists (
        select 1 from jsonb_array_elements(value#>'{imageDraft,versions}') version
        where version->>'id' = value#>>'{imageDraft,selectedVersionId}'
          and version->>'status' in ('Approved', 'Owner Upload')
      )
  ) then raise exception 'Only approved image versions may be published.'; end if;

  update public.ai_menu_import_drafts set publish_status = 'publishing' where id = target_draft_id;

  for category_entry in select value from jsonb_array_elements(state->'categories') order by coalesce((value->>'order')::integer, 0)
  loop
    if not exists (select 1 from jsonb_array_elements(active_items) item where item->>'categoryId' = category_entry->>'id') then continue; end if;
    category_name := nullif(btrim(category_entry->>'name'), '');
    if category_name is null then raise exception 'Every published category requires a name.'; end if;
    select link.category_id into target_category_id from public.ai_menu_publish_category_links link
      where link.draft_id = target_draft_id and link.draft_category_id = category_entry->>'id';
    if target_category_id is null then
      select existing.id into target_category_id from public.categories existing
      where existing.restaurant_id = target_restaurant_id and lower(btrim(existing.name)) = lower(category_name) limit 1;
    end if;
    if target_category_id is null then
      insert into public.categories(restaurant_id, name, display_order)
      values (target_restaurant_id, category_name, coalesce((category_entry->>'order')::integer, 0)) returning id into target_category_id;
    end if;
    insert into public.ai_menu_publish_category_links(draft_id, draft_category_id, category_id)
    values (target_draft_id, category_entry->>'id', target_category_id)
    on conflict (draft_id, draft_category_id) do update set category_id = excluded.category_id;
    categories_count := categories_count + 1;
    for localization_entry in select key as language, value from jsonb_each(category_entry#>'{localization,values}')
    loop
      if localization_entry.language in ('en','om','am') and nullif(btrim(localization_entry.value->>'value'), '') is not null then
        insert into public.menu_category_localizations(category_id, language, name, name_origin, name_owner_edited)
        values (target_category_id, localization_entry.language, localization_entry.value->>'value', 'owner', coalesce((category_entry#>>array['localization','ownerEdited',localization_entry.language])::boolean, false))
        on conflict (category_id, language) do update set
          name = case when menu_category_localizations.name_owner_edited then menu_category_localizations.name else excluded.name end,
          name_origin = case when menu_category_localizations.name_owner_edited then menu_category_localizations.name_origin else excluded.name_origin end,
          name_owner_edited = menu_category_localizations.name_owner_edited or excluded.name_owner_edited;
        languages_count := languages_count + 1;
      end if;
    end loop;
  end loop;

  for item_entry in select value from jsonb_array_elements(active_items) order by coalesce((value->>'order')::integer, 0)
  loop
    canonical_name := btrim(item_entry#>>'{name,value}');
    canonical_description := nullif(btrim(item_entry#>>'{description,value}'), '');
    select link.category_id into target_category_id from public.ai_menu_publish_category_links link where link.draft_id = target_draft_id and link.draft_category_id = item_entry->>'categoryId';
    if target_category_id is null then raise exception 'A published item references a missing category.'; end if;
    target_image_url := nullif(btrim(published_images->>(item_entry->>'id')), '');
    select link.menu_item_id into target_menu_item_id from public.ai_menu_publish_item_links link where link.draft_id = target_draft_id and link.draft_item_id = item_entry->>'id';
    if target_menu_item_id is null then
      select existing.id into target_menu_item_id from public.menu_items existing
      where existing.restaurant_id = target_restaurant_id and existing.category_id = target_category_id
        and lower(btrim(existing.name)) = lower(canonical_name) limit 1;
    end if;
    if target_menu_item_id is null then
      insert into public.menu_items(restaurant_id, category_id, name, description, price, image_url, available, display_order, recipe_id, direct_inventory_item_id)
      values (target_restaurant_id, target_category_id, canonical_name, canonical_description, (item_entry#>>'{price,value}')::numeric, target_image_url, true, coalesce((item_entry->>'order')::integer, 0), null, null) returning id into target_menu_item_id;
    end if;
    insert into public.ai_menu_publish_item_links(draft_id, draft_item_id, menu_item_id) values (target_draft_id, item_entry->>'id', target_menu_item_id)
    on conflict (draft_id, draft_item_id) do update set menu_item_id = excluded.menu_item_id;
    update public.menu_items set category_id = (select link.category_id from public.ai_menu_publish_category_links link where link.draft_id = target_draft_id and link.draft_category_id = item_entry->>'categoryId'), name = canonical_name, description = canonical_description,
      price = (item_entry#>>'{price,value}')::numeric, image_url = coalesce(target_image_url, menu_items.image_url), available = true,
      display_order = coalesce((item_entry->>'order')::integer, 0), archived_at = null
    where id = target_menu_item_id and restaurant_id = target_restaurant_id;
    items_count := items_count + 1;
    if target_image_url is not null then images_count := images_count + 1; end if;
    for localization_entry in select key as language, value from jsonb_each(item_entry#>'{nameLocalization,values}')
    loop
      if localization_entry.language in ('en','om','am') and (nullif(btrim(localization_entry.value->>'value'), '') is not null or nullif(btrim(item_entry#>>array['descriptionLocalization','values',localization_entry.language,'value']), '') is not null) then
        insert into public.menu_item_localizations(menu_item_id, language, name, description, name_origin, description_origin, name_owner_edited, description_owner_edited)
        values (target_menu_item_id, localization_entry.language, nullif(btrim(localization_entry.value->>'value'), ''), nullif(btrim(item_entry#>>array['descriptionLocalization','values',localization_entry.language,'value']), ''), 'owner', 'owner', coalesce((item_entry#>>array['nameLocalization','ownerEdited',localization_entry.language])::boolean, false), coalesce((item_entry#>>array['descriptionLocalization','ownerEdited',localization_entry.language])::boolean, false))
        on conflict (menu_item_id, language) do update set
          name = case when menu_item_localizations.name_owner_edited then menu_item_localizations.name else excluded.name end,
          description = case when menu_item_localizations.description_owner_edited then menu_item_localizations.description else excluded.description end,
          name_owner_edited = menu_item_localizations.name_owner_edited or excluded.name_owner_edited,
          description_owner_edited = menu_item_localizations.description_owner_edited or excluded.description_owner_edited;
        languages_count := languages_count + 1;
      end if;
    end loop;
  end loop;

  next_version := draft.published_version + 1;
  insert into public.ai_menu_publish_versions(restaurant_id, draft_id, review_revision, published_version, review_snapshot,
    categories_published, items_published, images_published, languages_published, published_by, published_role)
  values (target_restaurant_id, target_draft_id, target_review_revision, next_version, state,
    categories_count, items_count, images_count, languages_count, auth.uid(), actor_role);
  update public.ai_menu_import_drafts set publish_status = 'published', published_at = now(), published_version = next_version where id = target_draft_id;
  return jsonb_build_object('publishedVersion', next_version, 'categoriesPublished', categories_count, 'itemsPublished', items_count,
    'imagesPublished', images_count, 'languagesPublished', languages_count, 'skippedItems', jsonb_array_length(state->'items') - jsonb_array_length(active_items), 'warnings', '[]'::jsonb);
exception when others then
  raise;
end;
$$;

