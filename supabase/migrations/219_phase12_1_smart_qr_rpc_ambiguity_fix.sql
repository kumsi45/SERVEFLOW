-- Phase 12.1 Hotfix 2: the RPC parameter and subscription column intentionally
-- share the public contract name browser_session_token. Resolve unqualified
-- identifiers as columns inside this function so ON CONFLICT targets the
-- existing unique subscription key without renaming either contract.
do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.get_smart_qr_portal_state(text,text,text,text)'::regprocedure
  ) into definition;

  definition := replace(
    definition,
    E'\ndeclare\n',
    E'\n#variable_conflict use_column\ndeclare\n'
  );

  if definition not like '%#variable_conflict use_column%' then
    raise exception 'Smart QR RPC variable resolution could not be qualified safely.';
  end if;

  execute definition;
end;
$$;

comment on function public.get_smart_qr_portal_state(text,text,text,text) is
  'Resolves Smart QR state; column-preferred PL/pgSQL resolution disambiguates the browser subscription conflict key from the RPC parameter.';
