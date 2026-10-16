-- Forward-only SA2 verification repair. Apply only after 276 and 277.
-- Business conflicts are terminal HTTP 409 responses, not retryable serialization failures.
-- A repeated payment request must preserve its original audit rationale.
begin;
create or replace function public.platform_admin_classify(target_restaurant_id uuid,classification text,expected_version bigint,reason text,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; current_row platform_private.business_controls; existing_event platform_private.audit_events;
begin
  actor:=platform_private.require_admin('manage');
  if classification not in ('demo','live','unclassified') or classification is null or length(btrim(coalesce(reason,''))) not between 3 and 500 or request_id is null then raise exception 'Classification, request ID and reason required.' using errcode='22023'; end if;
  perform 1 from public.restaurants where id=target_restaurant_id for update;
  if not found then raise exception 'Business not found.' using errcode='P0002'; end if;
  select * into existing_event from platform_private.audit_events where audit_events.request_id=platform_admin_classify.request_id and action='business_classified' limit 1;
  if found then
    if existing_event.actor_id<>actor or existing_event.target_id<>target_restaurant_id or existing_event.summary->>'classification'<>classification or existing_event.reason<>btrim(reason) or (existing_event.summary->>'expectedVersion')::bigint is distinct from expected_version then raise exception 'Request ID reused.' using errcode='PT409'; end if;
    return jsonb_build_object('ok',true,'replayed',true);
  end if;
  select * into current_row from platform_private.business_controls where restaurant_id=target_restaurant_id;
  if coalesce(current_row.version,0) is distinct from expected_version then raise exception 'Business changed; refresh before reviewing.' using errcode='PT409'; end if;
  insert into platform_private.business_controls as controls(restaurant_id,classification,reviewed_by)
  values(target_restaurant_id,classification,actor) on conflict(restaurant_id) do update
    set classification=excluded.classification,version=controls.version+1,reviewed_by=actor,reviewed_at=clock_timestamp();
  perform platform_private.audit('business_classified',target_restaurant_id,target_restaurant_id,btrim(reason),request_id,
    jsonb_build_object('previous',coalesce(current_row.classification,'unclassified'),'classification',classification,'expectedVersion',expected_version));
  return jsonb_build_object('ok',true,'replayed',false);
end $$;

create or replace function public.platform_admin_decide_application(application_id uuid,decision text,reason text,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; app platform_private.applications;
begin
  actor:=platform_private.require_admin('manage');
  if decision not in ('approved','rejected') or decision is null or length(btrim(coalesce(reason,''))) not between 3 and 500 or request_id is null then raise exception 'Decision, request ID and reason required.' using errcode='22023'; end if;
  select * into app from platform_private.applications where id=application_id for update;
  if not found then raise exception 'Application not found.' using errcode='P0002'; end if;
  if app.status<>'pending' then
    if app.decision_request_id=request_id and app.decided_by=actor and app.status=decision and app.decision_reason=btrim(reason) then return jsonb_build_object('ok',true,'replayed',true); end if;
    raise exception 'Application already decided.' using errcode='PT409';
  end if;
  update platform_private.applications set status=decision,decided_at=clock_timestamp(),decided_by=actor,decision_reason=btrim(reason),decision_request_id=request_id where id=application_id;
  if decision='approved' then insert into platform_private.invitations(application_id) values(application_id); end if;
  perform platform_private.audit('application_'||decision,application_id,null,btrim(reason),request_id,jsonb_build_object('status',decision,'delivery','not_configured'));
  return jsonb_build_object('ok',true,'replayed',false,'invitationDelivery','not_configured');
end $$;

create or replace function public.platform_admin_record_payment(target_restaurant_id uuid,amount numeric,currency text,channel text,paid_at timestamptz,reference text,reason text,request_id uuid)
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
    if payment.submitted_by<>actor or payment.restaurant_id<>target_restaurant_id or payment.amount<>amount or payment.currency<>currency or payment.reference<>btrim(reference) or payment.channel<>btrim(channel) or payment.paid_at<>paid_at
      or not exists(select 1 from platform_private.audit_events e where e.request_id=platform_admin_record_payment.request_id and e.action='payment_recorded' and e.actor_id=actor and e.target_id=payment.id and e.reason=btrim(platform_admin_record_payment.reason)) then raise exception 'Request ID reused.' using errcode='PT409'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'id',payment.id);
  end if;
  insert into platform_private.payment_reviews(restaurant_id,submitted_by,amount,currency,channel,paid_at,reference,request_id)
  values(target_restaurant_id,actor,amount,currency,btrim(channel),paid_at,btrim(reference),request_id) returning id into payment_id;
  perform platform_private.audit('payment_recorded',payment_id,target_restaurant_id,btrim(reason),request_id,jsonb_build_object('status','pending','currency',currency));
  return jsonb_build_object('ok',true,'id',payment_id);
end $$;

create or replace function public.platform_admin_reject_payment(payment_id uuid,reason text,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; payment platform_private.payment_reviews;
begin
  actor:=platform_private.require_admin('sensitive');
  if request_id is null or length(btrim(coalesce(reason,''))) not between 3 and 500 then raise exception 'Request ID and reason required.' using errcode='22023'; end if;
  select * into payment from platform_private.payment_reviews where id=payment_id for update;
  if not found then raise exception 'Payment review not found.' using errcode='P0002'; end if;
  if payment.status<>'pending' then
    if exists(select 1 from platform_private.audit_events e where e.request_id=platform_admin_reject_payment.request_id and e.target_id=payment_id and e.actor_id=actor and e.action='payment_rejected' and e.reason=btrim(platform_admin_reject_payment.reason)) then return jsonb_build_object('ok',true,'replayed',true); end if;
    raise exception 'Payment already reviewed.' using errcode='PT409';
  end if;
  update platform_private.payment_reviews set status='rejected',reviewed_by=actor,reviewed_at=clock_timestamp(),reason=btrim(platform_admin_reject_payment.reason) where id=payment_id;
  perform platform_private.audit('payment_rejected',payment_id,payment.restaurant_id,btrim(reason),request_id,jsonb_build_object('status','rejected'));
  return jsonb_build_object('ok',true);
end $$;


commit;

