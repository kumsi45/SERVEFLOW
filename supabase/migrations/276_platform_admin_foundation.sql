-- SA2 local candidate. NOT APPLIED. Platform data is deliberately outside exposed schemas.
begin;
create schema if not exists platform_private;
revoke all on schema platform_private from public, anon, authenticated, service_role;

create table platform_private.administrators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 2 and 100),
  active boolean not null default false,
  can_manage boolean not null default false,
  can_sensitive boolean not null default false,
  recovery_verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (not can_sensitive or can_manage)
);
create table platform_private.audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  action text not null,
  target_id uuid,
  target_restaurant_id uuid,
  outcome text not null check (outcome in ('succeeded','rejected')),
  reason text check (length(reason) between 3 and 500),
  request_id uuid not null,
  summary jsonb not null default '{}'::jsonb
);
create index platform_audit_time_idx on platform_private.audit_events(created_at desc,id desc);
create unique index platform_audit_request_idx on platform_private.audit_events(request_id);
create index platform_audit_actor_idx on platform_private.audit_events(actor_id,created_at desc,id desc);
create index platform_audit_action_idx on platform_private.audit_events(action,created_at desc,id desc);
create index platform_audit_target_idx on platform_private.audit_events(target_id,created_at desc,id desc);

create table platform_private.business_controls (
  restaurant_id uuid primary key references public.restaurants(id) on delete restrict,
  classification text not null check (classification in ('demo','live','unclassified')),
  version bigint not null default 1 check (version > 0),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default clock_timestamp()
);
create index platform_business_classification_idx on platform_private.business_controls(classification,restaurant_id);

create table platform_private.applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  business_name text not null check(length(btrim(business_name)) between 2 and 100),
  contact_name text not null check(length(btrim(contact_name)) between 2 and 100),
  contact_email text not null check(length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  business_type text not null check(business_type in ('restaurant','cafe','hotel','bar','lounge','other')),
  previous_application_id uuid references platform_private.applications(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  decided_at timestamptz,
  decided_by uuid,
  decision_reason text,
  decision_request_id uuid unique,
  check ((status='pending' and decided_at is null and decided_by is null and decision_reason is null and decision_request_id is null)
      or (status<>'pending' and decided_at is not null and decided_by is not null and decision_reason is not null and length(btrim(decision_reason)) between 3 and 500 and decision_request_id is not null))
);
create index platform_application_queue_idx on platform_private.applications(status,created_at desc,id desc);
-- This records an invitation INTENT, not a sent email or usable credential.
-- Delivery/acceptance/provisioning remain disabled pending retention/provider decisions.
create table platform_private.invitations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references platform_private.applications(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  delivery_status text not null default 'not_configured' check(delivery_status='not_configured'),
  token_digest bytea,
  expires_at timestamptz,
  consumed_at timestamptz,
  check(token_digest is null and expires_at is null and consumed_at is null)
);
create index platform_invitation_time_idx on platform_private.invitations(created_at desc,id desc);

create table platform_private.contracts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  kind text not null check(kind in ('trial','annual')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  approved_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  check ((kind='trial' and ends_at=starts_at+interval '168 hours') or (kind='annual' and ends_at=starts_at+interval '8760 hours'))
);
create index platform_contract_time_idx on platform_private.contracts(restaurant_id,ends_at desc);
create index platform_contract_expiry_idx on platform_private.contracts(kind,ends_at,starts_at);
create table platform_private.payment_reviews (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  submitted_by uuid not null,
  amount numeric(18,2) not null check(amount > 0),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  channel text not null check(length(btrim(channel)) between 2 and 80),
  paid_at timestamptz not null,
  reference text not null check(length(btrim(reference)) between 2 and 120),
  status text not null default 'pending' check(status in ('pending','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  reason text,
  request_id uuid not null unique,
  check ((status='pending' and reviewed_by is null and reviewed_at is null and reason is null)
      or (status='rejected' and reviewed_by is not null and reviewed_at is not null and reason is not null and length(btrim(reason)) between 3 and 500))
);
create index platform_payment_queue_idx on platform_private.payment_reviews(status,created_at desc,id desc);
create index platform_payment_restaurant_idx on platform_private.payment_reviews(restaurant_id,created_at desc);
create unique index platform_payment_reference_idx on platform_private.payment_reviews(restaurant_id,lower(channel),lower(reference));
create table platform_private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references platform_private.contracts(id) on delete restrict,
  milestone integer not null check(milestone in (30,15)),
  recipient_user_id uuid not null,
  due_at timestamptz not null,
  status text not null default 'delivery_disabled' check(status='delivery_disabled'),
  created_at timestamptz not null default clock_timestamp(),
  unique(contract_id,milestone,recipient_user_id)
);
create index platform_notification_time_idx on platform_private.notification_outbox(created_at desc,id desc);
create table platform_private.diagnostics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  request_id uuid not null unique,
  code text not null check(code in ('ADMIN_READ_FAILED','ADMIN_ACTION_FAILED')),
  source text not null default 'platform_admin_ui' check(source='platform_admin_ui'),
  environment text not null check(environment in ('local','deployed'))
);
create index platform_diagnostic_time_idx on platform_private.diagnostics(created_at desc,id desc);
create index platform_restaurant_page_idx on public.restaurants(created_at desc,id desc);
create index platform_restaurant_name_idx on public.restaurants(lower(name) text_pattern_ops);
create index platform_restaurant_slug_idx on public.restaurants(lower(slug) text_pattern_ops);
create index platform_staff_page_idx on public.restaurant_staff(created_at desc,id desc);
create index platform_staff_name_idx on public.restaurant_staff(lower(display_name) text_pattern_ops);
create index platform_application_name_idx on platform_private.applications(lower(business_name) text_pattern_ops);
create index platform_application_email_idx on platform_private.applications(lower(contact_email) text_pattern_ops);
create index platform_audit_action_prefix_idx on platform_private.audit_events(action text_pattern_ops);

-- No direct REST access, even if this schema is accidentally added to API exposure.
do $$ declare t text; begin
  foreach t in array array['administrators','audit_events','business_controls','applications','invitations','contracts','payment_reviews','notification_outbox','diagnostics'] loop
    execute format('alter table platform_private.%I enable row level security',t);
    execute format('revoke all on table platform_private.%I from public, anon, authenticated, service_role',t);
  end loop;
end $$;

create function platform_private.require_admin(required_permission text default 'inspect')
returns uuid language plpgsql security definer set search_path='' as $$
declare actor platform_private.administrators; factor_time timestamptz;
begin
  if required_permission not in ('inspect','manage','sensitive') then raise exception 'Invalid permission.' using errcode='42501'; end if;
  select * into actor from platform_private.administrators where user_id=auth.uid() and active and recovery_verified_at is not null;
  if actor.user_id is null or auth.jwt()->>'aal' is distinct from 'aal2' then
    raise exception 'Platform authorization and verified MFA/recovery required.' using errcode='42501';
  end if;
  if not exists(select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=actor.user_id)
    or not exists(select 1 from auth.mfa_factors f where f.user_id=actor.user_id and f.status::text='verified' and f.factor_type::text='totp') then
    raise exception 'Active session and verified TOTP factor required.' using errcode='42501';
  end if;
  if not exists(select 1 from auth.users u where u.id=actor.user_id and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then
    raise exception 'Verified active Auth identity required.' using errcode='42501';
  end if;
  if required_permission='manage' and not actor.can_manage then raise exception 'Manage permission required.' using errcode='42501'; end if;
  if required_permission='sensitive' then
    if not actor.can_sensitive then raise exception 'Sensitive permission required.' using errcode='42501'; end if;
    select max(to_timestamp((entry->>'timestamp')::double precision)) into factor_time
      from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) entry
      where entry->>'method'='totp' and entry->>'timestamp' ~ '^[0-9]{1,12}$';
    if factor_time is null or factor_time>clock_timestamp() or factor_time<clock_timestamp()-interval '5 minutes' then
      raise exception 'Verify MFA again before this sensitive action.' using errcode='42501';
    end if;
  end if;
  return actor.user_id;
end $$;

create function platform_private.audit(action_name text,target uuid,tenant uuid,reason_text text,request uuid,safe_summary jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into platform_private.audit_events(actor_id,action,target_id,target_restaurant_id,outcome,reason,request_id,summary)
  values(auth.uid(),action_name,target,tenant,'succeeded',reason_text,request,safe_summary);
  -- Any failure aborts the parent mutation. No exception swallowing.
end $$;

create function public.get_platform_admin_context()
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor platform_private.administrators;
begin
  select * into actor from platform_private.administrators where user_id=auth.uid() and active;
  if actor.user_id is null then raise exception 'Platform administrator access denied.' using errcode='42501'; end if;
  return jsonb_build_object('userId',actor.user_id,'displayName',actor.display_name,
    'recoveryVerified',actor.recovery_verified_at is not null,'mfaRequired',auth.jwt()->>'aal' is distinct from 'aal2',
    'canManage',actor.can_manage,'canSensitive',actor.can_sensitive);
end $$;

create function public.platform_admin_read(
  section text, search_text text default '', status_filter text default '',
  cursor_at timestamptz default null, cursor_id uuid default null,
  since_at timestamptz default null, before_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb; actor uuid; q text:=btrim(coalesce(search_text,'')); state text:=coalesce(status_filter,''); result jsonb; search_id uuid;
begin
  actor:=platform_private.require_admin('inspect');
  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then search_id:=q::uuid; end if;
  if length(q)>100 or length(state)>100 or (cursor_at is null)<>(cursor_id is null) then raise exception 'Invalid search or cursor.' using errcode='22023'; end if;
  if since_at is not null and before_at is not null and since_at>=before_at then raise exception 'Invalid date range.' using errcode='22023'; end if;
  if section='overview' then
    -- Only indexed control-plane queues are counted. No scans of orders/invoices.
    return jsonb_build_object('asOf',clock_timestamp(),'source','platform_control_plane',
      'pendingApplications',(select count(*) from platform_private.applications where status='pending'),
      'rejectedApplications',(select count(*) from platform_private.applications where status='rejected'),
      'pendingPayments',(select count(*) from platform_private.payment_reviews where status='pending'),
      'approvedBusinesses',null,'operationalBusinesses',null,'activeTrials',null,'activeContracts',null,
      'expiredContracts',null,'suspendedBusinesses',null,
      'limitation','Entitlement activation and enforcement cutover are not available. Existing businesses are not assumed entitled.');
  elsif section='businesses' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select r.id,r.name,r.slug,r.created_at,coalesce(c.classification,'unclassified') classification,
        coalesce(c.version,0) version, c.reviewed_at,
        (select jsonb_agg(jsonb_build_object('userId',s.user_id,'name',s.display_name)) from public.restaurant_staff s where s.restaurant_id=r.id and s.role::text='owner' and s.active) owners,
        'Not reviewed / enforcement unavailable'::text entitlement
      from public.restaurants r left join platform_private.business_controls c on c.restaurant_id=r.id
      where (q='' or lower(r.name) like lower(q)||'%' or lower(r.slug) like lower(q)||'%')
        and (state='' or coalesce(c.classification,'unclassified')=state)
        and (cursor_at is null or (r.created_at,r.id)<(cursor_at,cursor_id))
      order by r.created_at desc,r.id desc limit 51
    ) x;
  elsif section='applications' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select a.id,a.created_at,a.business_name,a.contact_name,a.contact_email,a.business_type,a.previous_application_id,a.status,a.decided_at,a.decision_reason
      from platform_private.applications a where (state='' or a.status=state)
        and (q='' or lower(a.business_name) like lower(q)||'%' or lower(a.contact_email) like lower(q)||'%')
        and (cursor_at is null or (a.created_at,a.id)<(cursor_at,cursor_id)) order by a.created_at desc,a.id desc limit 51
    ) x;
  elsif section='users' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select s.id,s.created_at,s.user_id,s.restaurant_id,s.display_name,s.role,s.active,r.name business_name
      from public.restaurant_staff s join public.restaurants r on r.id=s.restaurant_id
      where (q='' or lower(s.display_name) like lower(q)||'%' or lower(r.name) like lower(q)||'%')
        and (cursor_at is null or (s.created_at,s.id)<(cursor_at,cursor_id)) order by s.created_at desc,s.id desc limit 51
    ) x;
  elsif section='invitations' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select i.id,i.created_at,i.application_id,i.delivery_status,a.business_name from platform_private.invitations i
      join platform_private.applications a on a.id=i.application_id
      where (cursor_at is null or (i.created_at,i.id)<(cursor_at,cursor_id)) order by i.created_at desc,i.id desc limit 51
    ) x;
  elsif section='contracts' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select c.id,c.created_at,c.restaurant_id,c.kind,c.starts_at,c.ends_at,r.name business_name from platform_private.contracts c
      join public.restaurants r on r.id=c.restaurant_id where (q='' or r.name ilike '%'||q||'%')
        and (cursor_at is null or (c.created_at,c.id)<(cursor_at,cursor_id)) order by c.created_at desc,c.id desc limit 51
    ) x;
  elsif section='payments' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select p.id,p.created_at,p.restaurant_id,p.amount,p.currency,p.channel,p.paid_at,p.reference,p.status,p.reviewed_at,p.reason,r.name business_name
      from platform_private.payment_reviews p join public.restaurants r on r.id=p.restaurant_id
      where (state='' or p.status=state) and (q='' or r.name ilike '%'||q||'%' or p.reference ilike '%'||q||'%')
        and (cursor_at is null or (p.created_at,p.id)<(cursor_at,cursor_id)) order by p.created_at desc,p.id desc limit 51
    ) x;
  elsif section='notifications' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select id,created_at,contract_id,milestone,due_at,status from platform_private.notification_outbox
      where (cursor_at is null or (created_at,id)<(cursor_at,cursor_id)) order by created_at desc,id desc limit 51
    ) x;
  elsif section='audit-logs' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select id,created_at,actor_id,action,target_id,target_restaurant_id,outcome,reason,request_id,summary from platform_private.audit_events
      where (q='' or action like lower(q)||'%' or actor_id=search_id or target_id=search_id or request_id=search_id)
        and (state='' or outcome=state)
        and (since_at is null or created_at>=since_at) and (before_at is null or created_at<before_at)
        and (cursor_at is null or (created_at,id)<(cursor_at,cursor_id)) order by created_at desc,id desc limit 51
    ) x;
  elsif section='administrators' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select user_id id,created_at,display_name,active,can_manage,can_sensitive,recovery_verified_at is not null recovery_verified
      from platform_private.administrators where (cursor_at is null or (created_at,user_id)<(cursor_at,cursor_id)) order by created_at desc,user_id desc limit 51
    ) x;
  elsif section='diagnostics' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
      select id,created_at,request_id,code,source,environment from platform_private.diagnostics
      where (q='' or code ilike '%'||q||'%' or request_id::text=q)
        and (cursor_at is null or (created_at,id)<(cursor_at,cursor_id)) order by created_at desc,id desc limit 51
    ) x;
  elsif section='system-health' then
    return jsonb_build_object('asOf',clock_timestamp(),'source','authorized database RPC',
      'database',jsonb_build_object('status','Healthy','meaning','This authorized database query completed. Not a full service availability check.'),
      'auth','Unknown','storage','Unknown','realtime','Unknown','edgeFunctions','Unknown','frontend','Unknown');
  elsif section in ('integrations','backups','security') then
    return jsonb_build_object('asOf',clock_timestamp(),'source','SA2 capability boundary','status','Not configured',
      'invitationDelivery',false,'notificationDelivery',false,'backupConfigured',null,'lastBackupAt',null,'restoreTested',null,
      'trialActivation',false,'contractActivation',false,'tenantSuspension',false,'recoveryActions',false,
      'printer','Paused','mfa','Server requires AAL2 and an active TOTP factor; sensitive actions require TOTP within five minutes.');
  else raise exception 'Unsupported platform section.' using errcode='22023';
  end if;
  result:=jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) from jsonb_array_elements(rows) with ordinality a(value,ord) where ord<=50),
    'nextCursor',case when jsonb_array_length(rows)>50 then jsonb_build_object('at',rows->49->>'created_at','id',rows->49->>'id') else null end,
    'asOf',clock_timestamp(),'source','authorized platform query');
  return result;
end $$;

create function public.platform_admin_classify(target_restaurant_id uuid,classification text,expected_version bigint,reason text,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; current_row platform_private.business_controls; existing_event platform_private.audit_events;
begin
  actor:=platform_private.require_admin('manage');
  if classification not in ('demo','live','unclassified') or classification is null or length(btrim(coalesce(reason,''))) not between 3 and 500 or request_id is null then raise exception 'Classification, request ID and reason required.' using errcode='22023'; end if;
  perform 1 from public.restaurants where id=target_restaurant_id for update;
  if not found then raise exception 'Business not found.' using errcode='P0002'; end if;
  select * into existing_event from platform_private.audit_events where audit_events.request_id=platform_admin_classify.request_id and action='business_classified' limit 1;
  if found then
    if existing_event.actor_id<>actor or existing_event.target_id<>target_restaurant_id or existing_event.summary->>'classification'<>classification or existing_event.reason<>btrim(reason) or (existing_event.summary->>'expectedVersion')::bigint is distinct from expected_version then raise exception 'Request ID reused.' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true);
  end if;
  select * into current_row from platform_private.business_controls where restaurant_id=target_restaurant_id;
  if coalesce(current_row.version,0) is distinct from expected_version then raise exception 'Business changed; refresh before reviewing.' using errcode='40001'; end if;
  insert into platform_private.business_controls as controls(restaurant_id,classification,reviewed_by)
  values(target_restaurant_id,classification,actor) on conflict(restaurant_id) do update
    set classification=excluded.classification,version=controls.version+1,reviewed_by=actor,reviewed_at=clock_timestamp();
  perform platform_private.audit('business_classified',target_restaurant_id,target_restaurant_id,btrim(reason),request_id,
    jsonb_build_object('previous',coalesce(current_row.classification,'unclassified'),'classification',classification,'expectedVersion',expected_version));
  return jsonb_build_object('ok',true,'replayed',false);
end $$;

create function public.platform_admin_decide_application(application_id uuid,decision text,reason text,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; app platform_private.applications;
begin
  actor:=platform_private.require_admin('manage');
  if decision not in ('approved','rejected') or decision is null or length(btrim(coalesce(reason,''))) not between 3 and 500 or request_id is null then raise exception 'Decision, request ID and reason required.' using errcode='22023'; end if;
  select * into app from platform_private.applications where id=application_id for update;
  if not found then raise exception 'Application not found.' using errcode='P0002'; end if;
  if app.status<>'pending' then
    if app.decision_request_id=request_id and app.decided_by=actor and app.status=decision and app.decision_reason=btrim(reason) then return jsonb_build_object('ok',true,'replayed',true); end if;
    raise exception 'Application already decided.' using errcode='40001';
  end if;
  update platform_private.applications set status=decision,decided_at=clock_timestamp(),decided_by=actor,decision_reason=btrim(reason),decision_request_id=request_id where id=application_id;
  if decision='approved' then insert into platform_private.invitations(application_id) values(application_id); end if;
  perform platform_private.audit('application_'||decision,application_id,null,btrim(reason),request_id,jsonb_build_object('status',decision,'delivery','not_configured'));
  return jsonb_build_object('ok',true,'replayed',false,'invitationDelivery','not_configured');
end $$;

create function public.platform_admin_record_payment(target_restaurant_id uuid,amount numeric,currency text,channel text,paid_at timestamptz,reference text,reason text,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; payment platform_private.payment_reviews; payment_id uuid;
begin
  actor:=platform_private.require_admin('manage');
  if request_id is null or length(btrim(coalesce(reason,''))) not between 3 and 500 or paid_at is null or paid_at>clock_timestamp() or amount is null or amount<=0 or amount>9999999999999999.99 or amount<>round(amount,2)
    or currency is null or currency !~ '^[A-Z]{3}$' or length(btrim(coalesce(channel,''))) not between 2 and 80 or length(btrim(coalesce(reference,''))) not between 2 and 120 then raise exception 'Invalid payment review.' using errcode='22023'; end if;
  perform 1 from public.restaurants where id=target_restaurant_id for update;
  if not found then raise exception 'Business not found.' using errcode='P0002'; end if;
  select * into payment from platform_private.payment_reviews p where p.request_id=platform_admin_record_payment.request_id;
  if found then
    if payment.submitted_by<>actor or payment.restaurant_id<>target_restaurant_id or payment.amount<>amount or payment.currency<>currency or payment.reference<>btrim(reference) or payment.channel<>btrim(channel) or payment.paid_at<>paid_at then raise exception 'Request ID reused.' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'id',payment.id);
  end if;
  insert into platform_private.payment_reviews(restaurant_id,submitted_by,amount,currency,channel,paid_at,reference,request_id)
  values(target_restaurant_id,actor,amount,currency,btrim(channel),paid_at,btrim(reference),request_id) returning id into payment_id;
  perform platform_private.audit('payment_recorded',payment_id,target_restaurant_id,btrim(reason),request_id,jsonb_build_object('status','pending','currency',currency));
  return jsonb_build_object('ok',true,'id',payment_id);
end $$;

create function public.platform_admin_reject_payment(payment_id uuid,reason text,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; payment platform_private.payment_reviews;
begin
  actor:=platform_private.require_admin('sensitive');
  if request_id is null or length(btrim(coalesce(reason,''))) not between 3 and 500 then raise exception 'Request ID and reason required.' using errcode='22023'; end if;
  select * into payment from platform_private.payment_reviews where id=payment_id for update;
  if not found then raise exception 'Payment review not found.' using errcode='P0002'; end if;
  if payment.status<>'pending' then
    if exists(select 1 from platform_private.audit_events e where e.request_id=platform_admin_reject_payment.request_id and e.target_id=payment_id and e.actor_id=actor and e.action='payment_rejected') then return jsonb_build_object('ok',true,'replayed',true); end if;
    raise exception 'Payment already reviewed.' using errcode='40001';
  end if;
  update platform_private.payment_reviews set status='rejected',reviewed_by=actor,reviewed_at=clock_timestamp(),reason=btrim(platform_admin_reject_payment.reason) where id=payment_id;
  perform platform_private.audit('payment_rejected',payment_id,payment.restaurant_id,btrim(reason),request_id,jsonb_build_object('status','rejected'));
  return jsonb_build_object('ok',true);
end $$;

create function public.platform_admin_record_diagnostic(code text,environment text,request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=platform_private.require_admin('inspect');
  if request_id is null or code is null or code not in ('ADMIN_READ_FAILED','ADMIN_ACTION_FAILED') or environment is null or environment not in ('local','deployed') then raise exception 'Invalid diagnostic.' using errcode='22023'; end if;
  insert into platform_private.diagnostics(actor_id,request_id,code,environment) values(actor,request_id,code,environment) on conflict(request_id) do nothing;
end $$;

create function public.platform_admin_record_access(request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=platform_private.require_admin('inspect');
  if request_id is null then raise exception 'Request ID required.' using errcode='22023'; end if;
  perform platform_private.audit('administrator_access',actor,null,null,request_id,'{}'::jsonb);
end $$;

revoke all on all functions in schema platform_private from public, anon, authenticated, service_role;
revoke all on function public.get_platform_admin_context() from public,anon;
revoke all on function public.platform_admin_read(text,text,text,timestamptz,uuid,timestamptz,timestamptz) from public,anon;
revoke all on function public.platform_admin_classify(uuid,text,bigint,text,uuid) from public,anon;
revoke all on function public.platform_admin_decide_application(uuid,text,text,uuid) from public,anon;
revoke all on function public.platform_admin_record_payment(uuid,numeric,text,text,timestamptz,text,text,uuid) from public,anon;
revoke all on function public.platform_admin_reject_payment(uuid,text,uuid) from public,anon;
revoke all on function public.platform_admin_record_diagnostic(text,text,uuid) from public,anon;
revoke all on function public.platform_admin_record_access(uuid) from public,anon;
grant execute on function public.get_platform_admin_context(),public.platform_admin_read(text,text,text,timestamptz,uuid,timestamptz,timestamptz),
  public.platform_admin_classify(uuid,text,bigint,text,uuid),public.platform_admin_decide_application(uuid,text,text,uuid),
  public.platform_admin_record_payment(uuid,numeric,text,text,timestamptz,text,text,uuid),public.platform_admin_reject_payment(uuid,text,uuid),
  public.platform_admin_record_diagnostic(text,text,uuid),public.platform_admin_record_access(uuid) to authenticated;
commit;
