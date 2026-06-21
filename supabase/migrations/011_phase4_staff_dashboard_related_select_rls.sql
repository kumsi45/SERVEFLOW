-- SERVEFLOW Phase 4 staff dashboard related-select RLS correction.
-- Staff dashboard queries read restaurant and menu item rows through embedded
-- relationships. These related rows must be visible to active restaurant staff,
-- even when public.users is not the source of their restaurant membership.

drop policy if exists restaurants_select_own on public.restaurants;

create policy restaurants_select_own_or_active_staff
on public.restaurants
for select
to authenticated
using (
  id = public.current_user_restaurant_id()
  or public.is_active_restaurant_staff_member(id)
);

drop policy if exists menu_items_select_same_restaurant on public.menu_items;

create policy menu_items_select_same_restaurant_or_active_staff
on public.menu_items
for select
to authenticated
using (
  public.is_restaurant_member(restaurant_id)
  or public.is_active_restaurant_staff_member(restaurant_id)
);
