-- Phase 8.3.1 runtime correction: disambiguate the RPC tenant variable from
-- the recipes.restaurant_id column. No schema or integration changes.
create or replace function public.manage_recipe(recipe_action text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_restaurant_id uuid := nullif(payload->>'restaurant_id','')::uuid;
  target_id uuid := nullif(payload->>'recipe_id','')::uuid;
  source public.recipes;
  saved public.recipes;
  action text := lower(btrim(recipe_action));
begin
  if target_restaurant_id is null or not public.recipe_can_manage(target_restaurant_id) then
    raise exception 'Only owners and managers may manage recipes.';
  end if;
  if action in ('create','update') then
    if nullif(btrim(payload->>'name'),'') is null then raise exception 'Recipe name is required.'; end if;
    if nullif(btrim(payload->>'yield_unit'),'') is null then raise exception 'Yield unit is required.'; end if;
    if coalesce((payload->>'yield_quantity')::numeric,0)<=0 then raise exception 'Yield quantity must be greater than zero.'; end if;
    if action='create' then
      insert into public.recipes(restaurant_id,recipe_code,name,description,category_id,preparation_time_minutes,yield_quantity,yield_unit,status)
      values(target_restaurant_id,'GENERATED',payload->>'name',payload->>'description',nullif(payload->>'category_id','')::uuid,
        coalesce((payload->>'preparation_time_minutes')::integer,0),(payload->>'yield_quantity')::numeric,payload->>'yield_unit',
        coalesce(nullif(payload->>'status',''),'draft')) returning * into saved;
    else
      update public.recipes set name=payload->>'name',description=payload->>'description',category_id=nullif(payload->>'category_id','')::uuid,
        preparation_time_minutes=coalesce((payload->>'preparation_time_minutes')::integer,0),yield_quantity=(payload->>'yield_quantity')::numeric,
        yield_unit=payload->>'yield_unit',status=coalesce(nullif(payload->>'status',''),status)
      where id=target_id and recipes.restaurant_id=target_restaurant_id and deleted_at is null returning * into saved;
    end if;
  elsif action='duplicate' then
    select * into source from public.recipes where id=target_id and recipes.restaurant_id=target_restaurant_id and deleted_at is null;
    if source.id is null then raise exception 'Recipe not found.'; end if;
    insert into public.recipes(restaurant_id,recipe_code,name,description,category_id,preparation_time_minutes,yield_quantity,yield_unit,status)
    values(target_restaurant_id,'GENERATED',left(source.name||' Copy',160),source.description,source.category_id,
      source.preparation_time_minutes,source.yield_quantity,source.yield_unit,'draft') returning * into saved;
  elsif action in ('archive','restore','delete') then
    update public.recipes set status=case when action='archive' then 'archived' when action='restore' then 'draft' else status end,
      deleted_at=case when action='delete' then clock_timestamp() when action='restore' then null else deleted_at end
    where id=target_id and recipes.restaurant_id=target_restaurant_id and (action='restore' or deleted_at is null) returning * into saved;
  else raise exception 'Unsupported recipe action.'; end if;
  if saved.id is null then raise exception 'Recipe not found.'; end if;
  return to_jsonb(saved);
exception when unique_violation then raise exception 'Recipe name or code already exists.';
end;
$$;

revoke all on function public.manage_recipe(text,jsonb) from public,anon;
grant execute on function public.manage_recipe(text,jsonb) to authenticated,service_role;
