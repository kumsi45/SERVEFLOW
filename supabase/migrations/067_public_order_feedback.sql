-- Public QR customer feedback.
-- Feedback is written through a validating RPC so anonymous customers can
-- submit only once for the completed order attached to their scanned table QR.

create table if not exists public.public_order_feedback (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  table_number text,
  qr_token uuid,
  rating integer not null check (rating between 1 and 5),
  reactions text[] not null default array[]::text[],
  comment text,
  photo_url text,
  customer_session_key text,
  created_at timestamptz not null default now(),
  unique (restaurant_id, order_id)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-photos',
  'feedback-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_photos_select_public on storage.objects;
create policy feedback_photos_select_public
on storage.objects
for select
to public
using (bucket_id = 'feedback-photos');

drop policy if exists feedback_photos_insert_public on storage.objects;
create policy feedback_photos_insert_public
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'feedback-photos'
  and array_length(storage.foldername(name), 1) >= 2
);

create index if not exists public_order_feedback_restaurant_created_idx
on public.public_order_feedback (restaurant_id, created_at desc);

alter table public.public_order_feedback enable row level security;

revoke all on public.public_order_feedback from anon, authenticated;
grant select on public.public_order_feedback to authenticated;

drop policy if exists public_order_feedback_select_staff_same_restaurant on public.public_order_feedback;
create policy public_order_feedback_select_staff_same_restaurant
on public.public_order_feedback
for select
to authenticated
using (
  public.has_staff_role(
    restaurant_id,
    array['owner','cashier']::public.restaurant_staff_role[]
  )
);

create or replace function public.submit_public_order_feedback(
  target_restaurant_slug text,
  table_number text,
  qr_token text,
  target_order_id uuid,
  rating integer,
  reactions text[] default array[]::text[],
  comment text default null,
  photo_url text default null,
  customer_session_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_restaurant_id uuid;
  target_qr_token uuid;
  normalized_table_number text;
  target_order public.orders;
  allowed_reactions constant text[] := array[
    'Delicious',
    'Fast Service',
    'Friendly Staff',
    'Great Atmosphere',
    'Value for Money'
  ];
  normalized_reactions text[] := array[]::text[];
  reaction text;
  inserted_feedback public.public_order_feedback;
begin
  normalized_table_number := nullif(trim(table_number), '');

  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Restaurant slug is required.';
  end if;

  if normalized_table_number is null then
    raise exception 'Table number is required.';
  end if;

  if qr_token is null or length(trim(qr_token)) = 0 then
    raise exception 'A valid table QR code is required.';
  end if;

  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required.';
  end;

  if rating is null or rating < 1 or rating > 5 then
    raise exception 'Please choose a rating from 1 to 5.';
  end if;

  select r.id
  into target_restaurant_id
  from public.restaurants r
  where r.slug = target_restaurant_slug
  limit 1;

  if target_restaurant_id is null then
    raise exception 'Restaurant not found.';
  end if;

  if not exists (
    select 1
    from public.restaurant_tables rt
    where rt.restaurant_id = target_restaurant_id
      and rt.table_number::text = normalized_table_number
      and rt.qr_token = target_qr_token
      and rt.active = true
  ) then
    raise exception 'Invalid or expired table QR code.';
  end if;

  select *
  into target_order
  from public.orders orders
  where orders.id = target_order_id
    and orders.restaurant_id = target_restaurant_id
    and orders.table_number = normalized_table_number
    and orders.status::text = 'completed'
  limit 1;

  if target_order.id is null then
    raise exception 'Feedback is available after the order is served.';
  end if;

  foreach reaction in array coalesce(reactions, array[]::text[]) loop
    if reaction = any(allowed_reactions) and not reaction = any(normalized_reactions) then
      normalized_reactions := array_append(normalized_reactions, reaction);
    end if;
  end loop;

  insert into public.public_order_feedback (
    restaurant_id,
    order_id,
    table_number,
    qr_token,
    rating,
    reactions,
    comment,
    photo_url,
    customer_session_key
  )
  values (
    target_restaurant_id,
    target_order.id,
    normalized_table_number,
    target_qr_token,
    rating,
    normalized_reactions,
    nullif(left(coalesce(comment, ''), 1000), ''),
    nullif(left(coalesce(photo_url, ''), 1000), ''),
    nullif(left(coalesce(customer_session_key, ''), 200), '')
  )
  on conflict (restaurant_id, order_id) do nothing
  returning * into inserted_feedback;

  if inserted_feedback.id is null then
    return jsonb_build_object('submitted', false, 'duplicate', true);
  end if;

  return jsonb_build_object(
    'submitted', true,
    'duplicate', false,
    'feedback_id', inserted_feedback.id
  );
end;
$$;

revoke all on function public.submit_public_order_feedback(text, text, text, uuid, integer, text[], text, text, text) from public;
grant execute on function public.submit_public_order_feedback(text, text, text, uuid, integer, text[], text, text, text) to anon;
grant execute on function public.submit_public_order_feedback(text, text, text, uuid, integer, text[], text, text, text) to authenticated;
