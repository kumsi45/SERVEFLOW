-- Align public feedback with the canonical operational lifecycle and require
-- the same browser-session bearer token that created the public QR order.

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
  normalized_table_number text := nullif(trim(table_number), '');
  normalized_browser_token text := nullif(left(trim(coalesce(customer_session_key, '')), 200), '');
  target_order public.orders;
  allowed_reactions constant text[] := array[
    'Delicious', 'Fast Service', 'Friendly Staff', 'Great Atmosphere', 'Value for Money'
  ];
  normalized_reactions text[] := array[]::text[];
  reaction text;
  inserted_feedback public.public_order_feedback;
begin
  if target_restaurant_slug is null or length(trim(target_restaurant_slug)) = 0 then
    raise exception 'Business slug is required.';
  end if;
  if normalized_table_number is null then raise exception 'Table number is required.'; end if;
  if qr_token is null or length(trim(qr_token)) = 0 then raise exception 'A valid table QR code is required.'; end if;
  if normalized_browser_token is null then raise exception 'Customer session is required.'; end if;
  begin
    target_qr_token := trim(qr_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid table QR code is required.';
  end;
  if rating is null or rating < 1 or rating > 5 then raise exception 'Please choose a rating from 1 to 5.'; end if;

  select restaurants.id into target_restaurant_id
  from public.restaurants
  where restaurants.slug = target_restaurant_slug
  limit 1;
  if target_restaurant_id is null then raise exception 'Business not found.'; end if;

  if not exists (
    select 1 from public.restaurant_tables
    where restaurant_tables.restaurant_id = target_restaurant_id
      and restaurant_tables.table_number::text = normalized_table_number
      and restaurant_tables.qr_token = target_qr_token
      and restaurant_tables.active = true
  ) then raise exception 'Invalid or expired table QR code.'; end if;

  select orders.* into target_order
  from public.orders
  where orders.id = target_order_id
    and orders.restaurant_id = target_restaurant_id
    and orders.table_number = normalized_table_number
    and orders.browser_session_token = normalized_browser_token
    and (
      orders.operational_status in ('served', 'closed')
      or orders.status::text = 'completed'
    )
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
    restaurant_id, order_id, table_number, qr_token, rating, reactions,
    comment, photo_url, customer_session_key
  ) values (
    target_restaurant_id, target_order.id, normalized_table_number,
    target_qr_token, rating, normalized_reactions,
    nullif(left(coalesce(comment, ''), 1000), ''),
    nullif(left(coalesce(photo_url, ''), 1000), ''),
    normalized_browser_token
  )
  on conflict (restaurant_id, order_id) do nothing
  returning * into inserted_feedback;

  if inserted_feedback.id is null then
    return jsonb_build_object('submitted', false, 'duplicate', true);
  end if;
  return jsonb_build_object('submitted', true, 'duplicate', false, 'feedback_id', inserted_feedback.id);
end;
$$;

revoke all on function public.submit_public_order_feedback(text, text, text, uuid, integer, text[], text, text, text) from public;
grant execute on function public.submit_public_order_feedback(text, text, text, uuid, integer, text[], text, text, text) to anon, authenticated;

comment on function public.submit_public_order_feedback(text, text, text, uuid, integer, text[], text, text, text) is
  'Accepts one review for a canonically served QR order owned by the same browser session.';
