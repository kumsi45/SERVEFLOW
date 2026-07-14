-- ============================================================
-- 121_waiter_terminal_currency_settings.sql
-- Expose restaurant currency settings in waiter terminal context
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_waiter_terminal_context(
    target_restaurant_slug text
)
RETURNS TABLE (
    restaurant_id uuid,
    restaurant_slug text,
    restaurant_name text,
    logo_url text,
    currency_code text,
    currency_symbol text,
    locale text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH normalized_input AS (
    SELECT
        lower(trim(target_restaurant_slug)) AS raw_value,
        regexp_replace(lower(trim(target_restaurant_slug)), '[^a-z0-9]+', '-', 'g') AS slug_value
)
SELECT
    restaurants.id,
    restaurants.slug,
    restaurants.name,
    restaurants.branding->>'logo_url',
    COALESCE(restaurants.currency_code, 'ETB'),
    COALESCE(restaurants.currency_symbol, 'Br'),
    COALESCE(restaurants.locale, 'am-ET')
FROM public.restaurants restaurants
CROSS JOIN normalized_input
WHERE restaurants.active = true
  AND (
      restaurants.slug = normalized_input.raw_value
      OR restaurants.id::text = normalized_input.raw_value
      OR lower(trim(restaurants.name)) = normalized_input.raw_value
      OR restaurants.slug = trim(both '-' FROM normalized_input.slug_value)
  )
ORDER BY
    CASE
        WHEN restaurants.slug = normalized_input.raw_value THEN 0
        WHEN restaurants.id::text = normalized_input.raw_value THEN 1
        WHEN lower(trim(restaurants.name)) = normalized_input.raw_value THEN 2
        ELSE 3
    END
LIMIT 1;
$$;


CREATE OR REPLACE FUNCTION public.resolve_waiter_login_identity(
    target_restaurant_slug text,
    waiter_username text
)
RETURNS TABLE (
    staff_id uuid,
    user_id uuid,
    email text,
    display_name text,
    restaurant_id uuid,
    restaurant_slug text,
    restaurant_name text,
    logo_url text,
    currency_code text,
    currency_symbol text,
    locale text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH normalized_input AS (
    SELECT
        lower(trim(target_restaurant_slug)) AS raw_value,
        regexp_replace(lower(trim(target_restaurant_slug)), '[^a-z0-9]+', '-', 'g') AS slug_value,
        lower(trim(waiter_username)) AS waiter_value
),
target_restaurant AS (
    SELECT restaurants.*
    FROM public.restaurants restaurants
    CROSS JOIN normalized_input
    WHERE restaurants.active = true
      AND (
          restaurants.slug = normalized_input.raw_value
          OR restaurants.id::text = normalized_input.raw_value
          OR lower(trim(restaurants.name)) = normalized_input.raw_value
          OR restaurants.slug = trim(both '-' FROM normalized_input.slug_value)
      )
    ORDER BY
        CASE
            WHEN restaurants.slug = normalized_input.raw_value THEN 0
            WHEN restaurants.id::text = normalized_input.raw_value THEN 1
            WHEN lower(trim(restaurants.name)) = normalized_input.raw_value THEN 2
            ELSE 3
        END
    LIMIT 1
)
SELECT
    staff.id,
    staff.user_id,
    staff.email,
    staff.display_name,
    target_restaurant.id,
    target_restaurant.slug,
    target_restaurant.name,
    target_restaurant.branding->>'logo_url',
    COALESCE(target_restaurant.currency_code, 'ETB'),
    COALESCE(target_restaurant.currency_symbol, 'Br'),
    COALESCE(target_restaurant.locale, 'am-ET')
FROM public.restaurant_staff staff
JOIN target_restaurant
    ON target_restaurant.id = staff.restaurant_id
CROSS JOIN normalized_input
WHERE staff.active = true
  AND staff.role::text = 'waiter'
  AND (
      lower(COALESCE(staff.username, '')) = normalized_input.waiter_value
      OR lower(COALESCE(staff.email, '')) = normalized_input.waiter_value
      OR lower(staff.display_name) = normalized_input.waiter_value
  )
ORDER BY
    CASE
        WHEN lower(COALESCE(staff.username, '')) = normalized_input.waiter_value THEN 0
        WHEN lower(COALESCE(staff.email, '')) = normalized_input.waiter_value THEN 1
        ELSE 2
    END,
    staff.created_at
LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_waiter_terminal_context(text)
FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.resolve_waiter_login_identity(text, text)
FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_waiter_terminal_context(text)
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_waiter_login_identity(text, text)
TO anon, authenticated;