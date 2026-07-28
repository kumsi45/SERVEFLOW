-- Supplier selection is optional for purchase orders.
-- Tenant-safe supplier validation remains enforced whenever a supplier is provided.

alter table public.purchase_orders
  alter column supplier_id drop not null;

do $$
declare
  definition text;
  updated_definition text;
begin
  definition := pg_get_functiondef('public.save_purchase_order_draft(uuid,jsonb)'::regprocedure);
  updated_definition := replace(
    definition,
    'if target_supplier_id is null or not exists (',
    'if target_supplier_id is not null and not exists ('
  );
  if updated_definition = definition then
    raise exception 'save_purchase_order_draft supplier validation signature was not found';
  end if;
  execute updated_definition;
end;
$$;

do $$
declare
  definition text;
  updated_definition text;
begin
  definition := pg_get_functiondef('public.receive_purchase_order(uuid,uuid,uuid,jsonb,text)'::regprocedure);
  updated_definition := replace(
    definition,
    'if not exists (' || chr(10) || '    select 1 from public.inventory_suppliers supplier' || chr(10) || '    where supplier.id = purchase_order_row.supplier_id',
    'if purchase_order_row.supplier_id is not null and not exists (' || chr(10) || '    select 1 from public.inventory_suppliers supplier' || chr(10) || '    where supplier.id = purchase_order_row.supplier_id'
  );
  if updated_definition = definition then
    raise exception 'receive_purchase_order supplier validation signature was not found';
  end if;
  execute updated_definition;
end;
$$;

do $$
declare
  signature regprocedure;
  definition text;
  updated_definition text;
begin
  foreach signature in array array[
    'public.get_purchase_orders(uuid)'::regprocedure,
    'public.get_purchase_order_drafts(uuid)'::regprocedure,
    'public.get_purchase_history(uuid)'::regprocedure
  ] loop
    definition := pg_get_functiondef(signature);
    updated_definition := replace(
      definition,
      '  join public.inventory_suppliers supplier',
      '  left join public.inventory_suppliers supplier'
    );
    if updated_definition = definition then
      raise exception '% supplier join signature was not found', signature;
    end if;
    execute updated_definition;
  end loop;
end;
$$;
