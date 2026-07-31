-- Phase 10: optional draft imagery must never block publishing.
-- The Edge Function only copies Approved/Owner Upload assets. Pending Smart
-- Library selections remain in Review Studio and the menu publishes without
-- those images, allowing the canonical public placeholder/default to render.

do $migration$
declare
  function_definition text;
  updated_definition text;
  blocking_check constant text := $check$  if exists (
    select 1 from jsonb_array_elements(active_items) value
    where nullif(value#>>'{imageDraft,selectedVersionId}', '') is not null
      and not exists (
        select 1 from jsonb_array_elements(value#>'{imageDraft,versions}') version
        where version->>'id' = value#>>'{imageDraft,selectedVersionId}'
          and version->>'status' in ('Approved', 'Owner Upload')
      )
  ) then raise exception 'Only approved image versions may be published.'; end if;
$check$;
begin
  select pg_get_functiondef(
    'public.publish_ai_menu_draft(uuid,uuid,integer,jsonb)'::regprocedure
  ) into function_definition;

  updated_definition := replace(function_definition, blocking_check, '');
  if updated_definition = function_definition then
    raise exception 'publish_ai_menu_draft optional-image guard was not found';
  end if;

  execute updated_definition;
end;
$migration$;

comment on function public.publish_ai_menu_draft(uuid,uuid,integer,jsonb) is
  'Publishes approved menu content; optional unapproved draft images are omitted rather than blocking publication.';
