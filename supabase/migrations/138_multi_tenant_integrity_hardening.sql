-- ServeFlow Phase 1 multi-tenant integrity hardening.
--
-- Postgres Changes DELETE events cannot be filtered by restaurant_id and RLS
-- cannot authorize a row after deletion. ServeFlow uses soft-delete/archive
-- lifecycle fields for tenant data, so DELETE/TRUNCATE events must never leave
-- the database publication. INSERT and UPDATE remain realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime set (publish = 'insert, update');
  end if;
end
$$;

-- Fail deployment if any public tenant-owned table has drifted away from the
-- minimum isolation contract. This automatically covers future tables that add
-- restaurant_id; it is intentionally not a hand-maintained restaurant list.
do $$
declare
  tenant_table record;
begin
  for tenant_table in
    select
      c.oid,
      n.nspname as schema_name,
      c.relname as table_name,
      c.relrowsecurity,
      a.attnotnull
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a
      on a.attrelid = c.oid
     and a.attname = 'restaurant_id'
     and not a.attisdropped
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    -- public.users is the sole mixed-scope identity table: super_admin rows are
    -- intentionally global, while the validated check below requires every
    -- tenant role to carry restaurant_id. All business-data tables remain
    -- unconditionally NOT NULL.
    if not tenant_table.attnotnull
       and not (
         tenant_table.table_name = 'users'
         and exists (
           select 1
           from pg_constraint constraint_row
           where constraint_row.conrelid = tenant_table.oid
             and constraint_row.conname = 'users_restaurant_required_for_tenant_roles'
             and constraint_row.contype = 'c'
             and constraint_row.convalidated
             and pg_get_constraintdef(constraint_row.oid) like '%role = ''super_admin''%restaurant_id IS NOT NULL%'
         )
       ) then
      raise exception 'Tenant integrity audit failed: %.%.restaurant_id must be NOT NULL',
        tenant_table.schema_name, tenant_table.table_name;
    end if;

    if not tenant_table.relrowsecurity then
      raise exception 'Tenant integrity audit failed: RLS is disabled on %.%',
        tenant_table.schema_name, tenant_table.table_name;
    end if;

    -- Zero policies is a valid deny-all posture for internal counter/event
    -- tables. Any client-visible table adds an explicit tenant policy.
  end loop;
end
$$;

-- Production verification view. It exposes structural status only (never
-- tenant rows) and is restricted to service_role for deployment checks.
create or replace view public.tenant_isolation_verification
with (security_invoker = true)
as
select
  c.relname as table_name,
  a.attnotnull as restaurant_id_not_null,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  count(p.polname)::integer as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a
  on a.attrelid = c.oid
 and a.attname = 'restaurant_id'
 and not a.attisdropped
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
group by c.relname, a.attnotnull, c.relrowsecurity, c.relforcerowsecurity;

revoke all on public.tenant_isolation_verification from public, anon, authenticated;
grant select on public.tenant_isolation_verification to service_role;
