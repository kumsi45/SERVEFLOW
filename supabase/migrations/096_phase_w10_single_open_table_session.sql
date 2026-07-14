-- Phase W10 invariant: one open dining session per restaurant table.
with ranked as (
  select o.id,row_number() over(partition by o.restaurant_id,o.table_number order by o.created_at desc,o.id desc) position
  from public.orders o where o.dining_session_status='open'
), safe_terminal_duplicates as (
  select o.id from public.orders o join ranked r on r.id=o.id and r.position>1
  where o.status::text in('completed','cancelled')
    and not exists(select 1 from public.order_invoices i where i.order_id=o.id and i.status not in('verified','refunded','cancelled'))
)
update public.orders o set dining_session_status='closed',updated_at=now() from safe_terminal_duplicates d where o.id=d.id;

create unique index if not exists orders_one_open_dining_session_per_table
on public.orders(restaurant_id,table_number) where dining_session_status='open';
