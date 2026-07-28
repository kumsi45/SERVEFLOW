create or replace function public.restore_ai_menu_publish_version(target_restaurant_id uuid, target_draft_id uuid, target_version_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare restored_state jsonb; next_revision integer;
begin
  if not public.has_staff_role(target_restaurant_id, array['owner']::public.restaurant_staff_role[]) then raise exception 'Only the restaurant owner may restore a menu draft.'; end if;
  select version.review_snapshot into restored_state from public.ai_menu_publish_versions version
  where version.id = target_version_id and version.restaurant_id = target_restaurant_id and version.draft_id = target_draft_id;
  if restored_state is null then raise exception 'Published draft version was not found.'; end if;
  update public.ai_menu_import_drafts set review_state = restored_state, review_revision = review_revision + 1,
    review_updated_by = auth.uid(), review_updated_at = now(), publish_status = 'draft'
  where id = target_draft_id and restaurant_id = target_restaurant_id returning review_revision into next_revision;
  if next_revision is null then raise exception 'Review Studio draft was not found.'; end if;
  return next_revision;
end;
$$;

revoke all on function public.restore_ai_menu_publish_version(uuid,uuid,uuid) from public, anon;
grant execute on function public.restore_ai_menu_publish_version(uuid,uuid,uuid) to authenticated, service_role;
