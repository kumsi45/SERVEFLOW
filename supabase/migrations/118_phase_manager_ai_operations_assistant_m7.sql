-- ServeFlow Manager Dashboard M7: AI Operations Assistant.
-- Advisory only. No automatic operational actions. All interactions are restaurant-scoped.

alter type public.staff_activity_action add value if not exists 'manager_ai_recommendation_applied';
alter type public.staff_activity_action add value if not exists 'manager_ai_recommendation_ignored';
alter type public.staff_activity_action add value if not exists 'manager_ai_recommendation_reminder_scheduled';

create table if not exists public.manager_ai_recommendation_decisions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  manager_staff_id uuid references public.restaurant_staff(id) on delete set null,
  recommendation_id text not null,
  recommendation_type text not null,
  decision text not null,
  title text not null,
  reason text,
  confidence integer,
  reminder_at timestamptz,
  created_at timestamptz not null default now(),
  constraint manager_ai_decision_check check (decision in ('applied', 'ignored', 'remind_later')),
  constraint manager_ai_confidence_check check (confidence is null or (confidence >= 0 and confidence <= 100))
);

create index if not exists manager_ai_recommendation_decisions_restaurant_idx
on public.manager_ai_recommendation_decisions (restaurant_id, created_at desc);

alter table public.manager_ai_recommendation_decisions enable row level security;

grant select on public.manager_ai_recommendation_decisions to authenticated;

drop policy if exists manager_ai_decisions_select_manager_same_restaurant on public.manager_ai_recommendation_decisions;
create policy manager_ai_decisions_select_manager_same_restaurant
on public.manager_ai_recommendation_decisions
for select
to authenticated
using (
  public.has_staff_role(restaurant_id, array['manager']::public.restaurant_staff_role[])
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'manager_ai_recommendation_decisions'
     ) then
    alter publication supabase_realtime add table public.manager_ai_recommendation_decisions;
  end if;
end;
$$;

create or replace function public.log_manager_ai_recommendation_decision(
  target_restaurant_id uuid,
  recommendation_id text,
  recommendation_type text,
  decision text,
  title text,
  reason text default null,
  confidence integer default null,
  reminder_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  manager_staff_id uuid;
  audit_action public.staff_activity_action;
begin
  manager_staff_id := public.get_manager_staff_id(target_restaurant_id);
  if manager_staff_id is null then raise exception 'Permission denied.'; end if;
  if decision not in ('applied', 'ignored', 'remind_later') then raise exception 'Invalid AI recommendation decision.'; end if;

  audit_action := case decision
    when 'applied' then 'manager_ai_recommendation_applied'::public.staff_activity_action
    when 'ignored' then 'manager_ai_recommendation_ignored'::public.staff_activity_action
    else 'manager_ai_recommendation_reminder_scheduled'::public.staff_activity_action
  end;

  insert into public.manager_ai_recommendation_decisions (
    restaurant_id,
    manager_staff_id,
    recommendation_id,
    recommendation_type,
    decision,
    title,
    reason,
    confidence,
    reminder_at
  )
  values (
    target_restaurant_id,
    manager_staff_id,
    nullif(left(btrim(coalesce(recommendation_id, '')), 160), ''),
    nullif(left(btrim(coalesce(recommendation_type, '')), 80), ''),
    decision,
    nullif(left(btrim(coalesce(title, '')), 240), ''),
    nullif(left(btrim(coalesce(reason, '')), 1000), ''),
    confidence,
    reminder_at
  );

  insert into public.staff_activity_log (restaurant_id, action, performed_by_staff_id, details)
  values (
    target_restaurant_id,
    audit_action,
    manager_staff_id,
    jsonb_build_object(
      'recommendation_id', recommendation_id,
      'recommendation_type', recommendation_type,
      'decision', decision,
      'title', title,
      'reason', reason,
      'confidence', confidence,
      'reminder_at', reminder_at,
      'timestamp', now()
    )
  );
end;
$$;

revoke all on function public.log_manager_ai_recommendation_decision(uuid, text, text, text, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.log_manager_ai_recommendation_decision(uuid, text, text, text, text, text, integer, timestamptz) to authenticated;
