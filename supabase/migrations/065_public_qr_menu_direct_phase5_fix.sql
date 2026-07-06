-- SERVEFLOW Phase 5 fix: table QR scans must open the digital menu directly.
-- The ordering route remains available, but generated QR URLs now target /r/:slug.

create or replace function public.build_public_order_path(
  restaurant_slug text,
  table_number integer,
  qr_token uuid
)
returns text
language plpgsql
immutable
as $$
begin
  if restaurant_slug is null or btrim(restaurant_slug) = '' then
    raise exception 'Restaurant slug is required.';
  end if;

  if table_number is null or table_number < 1 then
    raise exception 'Table number is required.';
  end if;

  if qr_token is null then
    raise exception 'QR token is required.';
  end if;

  return '/r/' || btrim(restaurant_slug) || '?t=' || table_number::text || '&qr=' || qr_token::text;
end;
$$;

do $$
begin
  perform public.rebuild_public_qr_urls();
end;
$$;

revoke all on function public.build_public_order_path(text, integer, uuid) from public, anon, authenticated;
