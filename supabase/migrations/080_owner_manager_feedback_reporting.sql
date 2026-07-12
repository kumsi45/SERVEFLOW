-- ServeFlow repair: make public QR feedback visible in owner/manager reports.

alter type public.restaurant_staff_role add value if not exists 'manager';

drop policy if exists public_order_feedback_select_staff_same_restaurant on public.public_order_feedback;
create policy public_order_feedback_select_staff_same_restaurant
on public.public_order_feedback
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff staff
    where staff.restaurant_id = public_order_feedback.restaurant_id
      and staff.user_id = auth.uid()
      and staff.active = true
      and staff.role::text in ('owner', 'manager')
  )
);

create index if not exists public_order_feedback_restaurant_rating_idx
on public.public_order_feedback (restaurant_id, rating, created_at desc);
