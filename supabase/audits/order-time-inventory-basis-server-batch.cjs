// Same final migration, one server-side rollback batch to avoid hundreds of
// network round trips. Every helper lives in pg_temp and rolls back too.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/263_order_time_inventory_deduction_basis.sql'), 'utf8');
// Validate the exact body without letting the deployment-only COMMIT persist it.
assert.match(migration, /\nBEGIN;\n/);
assert.match(migration, /\nCOMMIT;\s*$/);
const rollbackMigration = migration.replace(/\nBEGIN;\n/, '\n').replace(/\nCOMMIT;\s*$/, '\n');
const names = ['build_inventory_deduction_plan', 'deduct_inventory_for_order_item', 'inventory_food_consumption_audit_row',
  'inventory_movement_validate_row', 'split_waiter_bill_quantities'];
const prologue = `
create temp table basis_audit_context(f jsonb);
create temp table basis_audit_results(label text primary key);
create function pg_temp.basis_check(label_value text, condition_value boolean) returns void language plpgsql as $$
begin
  if condition_value is distinct from true then raise exception 'AUDIT FAILED: %', label_value; end if;
  insert into pg_temp.basis_audit_results values(label_value);
end; $$;
create function pg_temp.basis_actor(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  set local role authenticated;
end; $$;
create function pg_temp.basis_mode(f jsonb, recipe_id uuid default null, direct_id uuid default null) returns void language plpgsql as $$
begin
  perform pg_temp.basis_actor((f->>'owner')::uuid);
  update public.menu_items set recipe_id=basis_mode.recipe_id,direct_inventory_item_id=direct_id where id=(f->>'menu')::uuid;
  reset role;
end; $$;
create function pg_temp.basis_order(f jsonb, entry_path text, table_value integer, quantity_value integer default 2) returns jsonb language plpgsql as $$
declare payload jsonb; requested jsonb; item_id uuid; token text; request_id uuid := gen_random_uuid();
begin
  requested := jsonb_build_array(jsonb_build_object('menu_item_id',f->>'menu','quantity',quantity_value,
    'tracking_mode','recipe','deduction_plan',jsonb_build_array(jsonb_build_object('required_quantity',999999))));
  if entry_path='QR' then
    select qr_token::text into token from public.restaurant_tables where restaurant_id=(f->>'restaurant')::uuid and table_number=table_value;
    perform set_config('request.jwt.claim.sub','',true); perform set_config('request.jwt.claim.role','anon',true); set local role anon;
    payload := public.create_public_qr_order(f->>'slug',table_value::text,token,'basis-browser-'||table_value::text,'Rollback QR','Cash',requested);
  elsif entry_path='Waiter' then
    perform pg_temp.basis_actor((f->>'waiter')::uuid);
    payload := public.create_waiter_order(f->>'slug',table_value::text,'Rollback waiter','','',requested);
  elsif entry_path='WaiterBatch' then
    perform pg_temp.basis_actor((f->>'waiter')::uuid);
    payload := public.submit_waiter_order_batch(f->>'slug',table_value::text,'Rollback waiter','','',requested,request_id);
  else
    perform pg_temp.basis_actor((f->>'cashier')::uuid);
    payload := public.create_cashier_order((f->>'restaurant')::uuid,table_value::text,'Cash',requested);
  end if;
  reset role;
  select id into item_id from public.order_items where order_id=(payload->>'order_id')::uuid order by created_at desc,id desc limit 1;
  return payload||jsonb_build_object('item',item_id,'request_id',request_id,'table',table_value);
end; $$;
create function pg_temp.basis_complete(f jsonb, payload jsonb, after_meal boolean default false) returns void language plpgsql as $$
declare config public.menu_items;
begin
  if not after_meal then
    perform pg_temp.basis_actor((f->>'cashier')::uuid);
    perform public.verify_dining_session_payment((payload->>'order_id')::uuid,'Cash',null,null,null,false);
    reset role;
    select * into config from public.menu_items where id=(f->>'menu')::uuid;
    perform pg_temp.basis_mode(f);
    perform pg_temp.basis_actor((f->>'cashier')::uuid);
    perform public.append_items_to_order((payload->>'order_id')::uuid,jsonb_build_array(jsonb_build_object('menu_item_id',f->>'menu','quantity',1)));
    reset role;
    perform pg_temp.basis_mode(f,config.recipe_id,config.direct_inventory_item_id);
  end if;
  perform pg_temp.basis_actor((f->>'owner')::uuid);
  perform public.start_order_preparation((payload->>'order_id')::uuid,(f->>'station')::uuid,'initial');
  perform public.mark_order_ready((payload->>'order_id')::uuid,(f->>'station')::uuid,'initial');
  perform public.mark_order_completed((payload->>'order_id')::uuid,(f->>'station')::uuid,'initial');
  reset role;
end; $$;
create function pg_temp.basis_deduct(f jsonb, item uuid) returns jsonb language plpgsql as $$
declare payload jsonb;
begin
  perform pg_temp.basis_actor((f->>'owner')::uuid);
  payload := public.deduct_inventory_for_order_item(item);
  reset role; return payload;
end; $$;
create function pg_temp.basis_stock(f jsonb, item uuid) returns numeric language plpgsql as $$
declare value numeric;
begin
  perform pg_temp.basis_actor((f->>'owner')::uuid);
  value := public.get_inventory_storage_balance((f->>'restaurant')::uuid,item,(f->>'storage')::uuid);
  reset role; return value;
end; $$;
do $$
declare f jsonb := '{}'::jsonb; key text; role_value text; user_id uuid; staff_id uuid; payload jsonb; recipe jsonb; ingredient jsonb;
begin
  foreach key in array array['restaurant','other','owner','waiter','cashier','manager','kitchen','outsider',
    'owner_staff','waiter_staff','cashier_staff','manager_staff','kitchen_staff','other_staff',
    'category','station','unit','grams','inventory_category','storage','item_a','item_b','foreign_item',
    'foreign_unit','foreign_storage','foreign_category','menu'] loop
    f := f||jsonb_build_object(key,gen_random_uuid());
  end loop;
  f := f||jsonb_build_object('slug','basis-validation-'||(f->>'restaurant'));
  foreach key in array array['owner','waiter','cashier','manager','kitchen','outsider'] loop
    user_id := (f->>key)::uuid;
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
    values(user_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','basis-'||user_id::text||'@example.test','',now(),now(),now());
  end loop;
  insert into public.restaurants(id,name,slug,total_tables,table_count,profile) values
    ((f->>'restaurant')::uuid,'Basis server rollback fixture',f->>'slug',50,50,'{}'),
    ((f->>'other')::uuid,'Basis server other rollback fixture','basis-other-'||(f->>'other'),1,1,'{}');
  foreach role_value in array array['owner','waiter','cashier','manager','kitchen'] loop
    insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,email,active) values
      ((f->>(role_value||'_staff'))::uuid,(f->>'restaurant')::uuid,(f->>role_value)::uuid,
       role_value::public.restaurant_staff_role,'Basis server fixture','basis-'||(f->>role_value)||'@example.test',true);
  end loop;
  insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values
    ((f->>'other_staff')::uuid,(f->>'other')::uuid,(f->>'outsider')::uuid,'owner','Basis other owner',true);
  insert into public.categories(id,restaurant_id,name) values((f->>'category')::uuid,(f->>'restaurant')::uuid,'Basis category');
  insert into public.kitchen_stations(id,restaurant_id,name,active,is_default) values((f->>'station')::uuid,(f->>'restaurant')::uuid,'Basis kitchen',true,true);
  insert into public.inventory_categories(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values
    ((f->>'inventory_category')::uuid,(f->>'restaurant')::uuid,'Basis inventory','active',(f->>'owner_staff')::uuid,(f->>'owner_staff')::uuid),
    ((f->>'foreign_category')::uuid,(f->>'other')::uuid,'Basis foreign','active',(f->>'other_staff')::uuid,(f->>'other_staff')::uuid);
  insert into public.inventory_units(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values
    ((f->>'unit')::uuid,(f->>'restaurant')::uuid,'kg','active',(f->>'owner_staff')::uuid,(f->>'owner_staff')::uuid),
    ((f->>'grams')::uuid,(f->>'restaurant')::uuid,'g','active',(f->>'owner_staff')::uuid,(f->>'owner_staff')::uuid),
    ((f->>'foreign_unit')::uuid,(f->>'other')::uuid,'kg','active',(f->>'other_staff')::uuid,(f->>'other_staff')::uuid);
  insert into public.inventory_storage_locations(id,restaurant_id,name,status,created_by_staff_id,updated_by_staff_id) values
    ((f->>'storage')::uuid,(f->>'restaurant')::uuid,'Basis store','active',(f->>'owner_staff')::uuid,(f->>'owner_staff')::uuid),
    ((f->>'foreign_storage')::uuid,(f->>'other')::uuid,'Basis foreign store','active',(f->>'other_staff')::uuid,(f->>'other_staff')::uuid);
  foreach key in array array['item_a','item_b'] loop
    insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,status,created_by_staff_id,updated_by_staff_id)
      values((f->>key)::uuid,(f->>'restaurant')::uuid,'Basis '||key,'kg',0,0,true,(f->>'inventory_category')::uuid,(f->>'unit')::uuid,(f->>'storage')::uuid,'active',(f->>'owner_staff')::uuid,(f->>'owner_staff')::uuid);
  end loop;
  insert into public.inventory_items(id,restaurant_id,name,unit,current_quantity,reorder_level,active,category_id,unit_id,storage_location_id,status,created_by_staff_id,updated_by_staff_id)
    values((f->>'foreign_item')::uuid,(f->>'other')::uuid,'Basis foreign item','kg',0,0,true,(f->>'foreign_category')::uuid,(f->>'foreign_unit')::uuid,(f->>'foreign_storage')::uuid,'active',(f->>'other_staff')::uuid,(f->>'other_staff')::uuid);
  perform pg_temp.basis_actor((f->>'owner')::uuid);
  perform public.record_inventory_opening_balance((f->>'restaurant')::uuid,(f->>'item_a')::uuid,(f->>'storage')::uuid,100,null,null,now());
  perform public.record_inventory_opening_balance((f->>'restaurant')::uuid,(f->>'item_b')::uuid,(f->>'storage')::uuid,100,null,null,now());
  insert into public.menu_items(id,restaurant_id,category_id,kitchen_station_id,name,price,available) values
    ((f->>'menu')::uuid,(f->>'restaurant')::uuid,(f->>'category')::uuid,(f->>'station')::uuid,'Basis sale',10,true);
  recipe := public.manage_recipe('create',jsonb_build_object('restaurant_id',f->>'restaurant','name','Basis recipe','status','active','yield_quantity',2,'yield_unit','servings'));
  f := f||jsonb_build_object('recipe',recipe->>'id');
  ingredient := public.manage_recipe_ingredient('create',jsonb_build_object('restaurant_id',f->>'restaurant','recipe_id',f->>'recipe',
    'inventory_item_id',f->>'item_a','quantity_required',500,'unit_id',f->>'grams','sort_order',100));
  f := f||jsonb_build_object('ingredient_a',ingredient->>'id');
  ingredient := public.manage_recipe_ingredient('create',jsonb_build_object('restaurant_id',f->>'restaurant','recipe_id',f->>'recipe',
    'inventory_item_id',f->>'item_b','quantity_required',1,'unit_id',f->>'unit','sort_order',200));
  f := f||jsonb_build_object('ingredient_b',ingredient->>'id');
  reset role;
  perform pg_temp.basis_actor((f->>'cashier')::uuid); perform public.open_cashier_shift((f->>'restaurant')::uuid,0,'Basis rollback batch'); reset role;
  payload := pg_temp.basis_order(f,'Cashier',1); f := f||jsonb_build_object('legacy',payload);
  perform pg_temp.basis_mode(f,null,(f->>'item_a')::uuid);
  payload := pg_temp.basis_order(f,'Cashier',2,1); perform pg_temp.basis_complete(f,payload);
  perform pg_temp.basis_check('genuine pre-migration deduction',(pg_temp.basis_deduct(f,(payload->>'item')::uuid)->>'deducted')::boolean);
  f := f||jsonb_build_object('legacy_receipt',payload,
    'receipt_before',(select to_jsonb(d) from public.inventory_order_item_deductions d where order_item_id=(payload->>'item')::uuid),
    'movements_before',(select jsonb_agg(to_jsonb(m) order by id) from public.inventory_movements m where order_item_id=(payload->>'item')::uuid));
  perform pg_temp.basis_mode(f);
  insert into pg_temp.basis_audit_context values(f);
end; $$;
`;

const cases = `
do $$
declare f jsonb; old_recipe jsonb; new_recipe jsonb; none_item jsonb; direct_item jsonb; future_direct jsonb;
  split_order jsonb; merge_source jsonb; merge_destination jsonb; held_order jsonb; entry jsonb; child uuid;
  original_plan jsonb; changed_plan jsonb; split_plan jsonb; recipe_value jsonb; before_a numeric; before_b numeric;
  rejected boolean; key text; role_name text; count_before bigint; receipt_before jsonb; movements_before jsonb; surface_count integer;
begin
  select c.f into f from pg_temp.basis_audit_context c;
  perform pg_temp.basis_check('legacy is explicit review',(select tracking_mode='legacy_review' from public.order_item_inventory_basis where order_item_id=(f->'legacy'->>'item')::uuid));
  rejected := false; begin perform public.build_inventory_deduction_plan((f->'legacy'->>'item')::uuid); exception when others then rejected := sqlerrm like '%ambiguous%review%'; end;
  perform pg_temp.basis_check('legacy never uses current configuration',rejected);
  perform pg_temp.basis_check('genuine existing receipt class',(select tracking_mode='legacy_receipt' from public.order_item_inventory_basis where order_item_id=(f->'legacy_receipt'->>'item')::uuid));
  perform pg_temp.basis_check('existing receipt retry',(pg_temp.basis_deduct(f,(f->'legacy_receipt'->>'item')::uuid)->>'status')='already_deducted');
  perform pg_temp.basis_check('existing receipt and movements unchanged',
    (select to_jsonb(d) from public.inventory_order_item_deductions d where order_item_id=(f->'legacy_receipt'->>'item')::uuid)=f->'receipt_before'
    and (select jsonb_agg(to_jsonb(m) order by id) from public.inventory_movements m where order_item_id=(f->'legacy_receipt'->>'item')::uuid)=f->'movements_before');
  perform pg_temp.basis_mode(f,(f->>'recipe')::uuid);
  old_recipe := pg_temp.basis_order(f,'Cashier',3); original_plan := public.build_inventory_deduction_plan((old_recipe->>'item')::uuid);
  perform pg_temp.basis_check('original converted recipe basis',(select (x->>'required_quantity')::numeric=0.5 from jsonb_array_elements(original_plan) x where x->>'inventory_item_id'=f->>'item_a'));
  perform pg_temp.basis_actor((f->>'owner')::uuid);
  perform public.manage_recipe_ingredient('update',jsonb_build_object('restaurant_id',f->>'restaurant','recipe_id',f->>'recipe','ingredient_id',f->>'ingredient_a',
    'inventory_item_id',f->>'item_a','quantity_required',3,'unit_id',f->>'unit','sort_order',100));
  perform public.manage_recipe('update',jsonb_build_object('restaurant_id',f->>'restaurant','recipe_id',f->>'recipe','name','Basis recipe','status','active','yield_quantity',1,'yield_unit','servings'));
  reset role;
  perform pg_temp.basis_check('ingredient quantity unit yield edits preserve old basis',public.build_inventory_deduction_plan((old_recipe->>'item')::uuid)=original_plan);
  new_recipe := pg_temp.basis_order(f,'Cashier',4);
  perform pg_temp.basis_check('future recipe uses edited basis',(select (x->>'required_quantity')::numeric=6 from jsonb_array_elements(public.build_inventory_deduction_plan((new_recipe->>'item')::uuid)) x where x->>'inventory_item_id'=f->>'item_a'));
  perform pg_temp.basis_mode(f); none_item := pg_temp.basis_order(f,'Cashier',5);
  perform pg_temp.basis_check('explicit No Tracking ignores forged client tracking mode',(select tracking_mode='no_tracking' and deduction_plan='[]'::jsonb from public.order_item_inventory_basis where order_item_id=(none_item->>'item')::uuid));
  perform pg_temp.basis_check('Recipe to No Tracking preserves old recipe',public.build_inventory_deduction_plan((old_recipe->>'item')::uuid)=original_plan);
  perform pg_temp.basis_mode(f,(f->>'recipe')::uuid);
  perform pg_temp.basis_check('No Tracking to Recipe preserves old No Tracking',public.build_inventory_deduction_plan((none_item->>'item')::uuid)='[]'::jsonb);
  entry := pg_temp.basis_order(f,'Cashier',6);
  perform pg_temp.basis_check('No Tracking to Recipe affects future orders',(select tracking_mode='recipe' from public.order_item_inventory_basis where order_item_id=(entry->>'item')::uuid));
  perform pg_temp.basis_mode(f,null,(f->>'item_a')::uuid); direct_item := pg_temp.basis_order(f,'Cashier',7,3);
  perform pg_temp.basis_mode(f,null,(f->>'item_b')::uuid); future_direct := pg_temp.basis_order(f,'Cashier',8);
  perform pg_temp.basis_check('direct source switch preserves old exact basis',public.build_inventory_deduction_plan((direct_item->>'item')::uuid)->0->>'inventory_item_id'=f->>'item_a'
    and (public.build_inventory_deduction_plan((direct_item->>'item')::uuid)->0->>'required_quantity')::numeric=3);
  perform pg_temp.basis_check('future direct uses new source',public.build_inventory_deduction_plan((future_direct->>'item')::uuid)->0->>'inventory_item_id'=f->>'item_b');
  perform pg_temp.basis_mode(f,(f->>'recipe')::uuid);
  perform pg_temp.basis_check('Direct to Recipe preserves old direct',(select tracking_mode='direct' from public.order_item_inventory_basis where order_item_id=(direct_item->>'item')::uuid));
  foreach key in array array['QR','Waiter','WaiterBatch','Cashier'] loop
    entry := pg_temp.basis_order(f,key,case key when 'QR' then 9 when 'Waiter' then 10 when 'WaiterBatch' then 11 else 12 end);
    perform pg_temp.basis_check(key||' first order captures server basis',(select tracking_mode='recipe' from public.order_item_inventory_basis where order_item_id=(entry->>'item')::uuid));
    if key in ('QR','Waiter','WaiterBatch') then
      perform pg_temp.basis_order(f,key,(entry->>'table')::integer,1);
    else
      perform pg_temp.basis_actor((f->>'cashier')::uuid);
      perform public.append_items_to_order((entry->>'order_id')::uuid,jsonb_build_array(jsonb_build_object('menu_item_id',f->>'menu','quantity',1))); reset role;
    end if;
    perform pg_temp.basis_check(key||' append captures basis',(select count(*)=2 from public.order_items i join public.order_item_inventory_basis b on b.order_item_id=i.id where i.order_id=(entry->>'order_id')::uuid));
  end loop;
  split_order := pg_temp.basis_order(f,'WaiterBatch',13,3); split_plan := public.build_inventory_deduction_plan((split_order->>'item')::uuid);
  perform pg_temp.basis_mode(f);
  perform pg_temp.basis_actor((f->>'waiter')::uuid);
  perform public.split_waiter_bill_quantities((split_order->>'order_id')::uuid,jsonb_build_array(jsonb_build_object('item_id',split_order->>'item','quantity',1))); reset role;
  select order_item_id into child from public.order_item_inventory_basis where split_parent_order_item_id=(split_order->>'item')::uuid;
  perform pg_temp.basis_check('bill split inherits frozen recipe despite current No Tracking',(select tracking_mode='recipe' from public.order_item_inventory_basis where order_item_id=child));
  perform pg_temp.basis_check('bill split leaves original snapshot immutable',(select deduction_plan=split_plan from public.order_item_inventory_basis where order_item_id=(split_order->>'item')::uuid));
  before_a := pg_temp.basis_stock(f,(f->>'item_a')::uuid); before_b := pg_temp.basis_stock(f,(f->>'item_b')::uuid);
  perform pg_temp.basis_complete(f,split_order);
  perform pg_temp.basis_check('split parent deducts its allocation',(pg_temp.basis_deduct(f,(split_order->>'item')::uuid)->>'deducted')::boolean);
  perform pg_temp.basis_check('split child deducts its allocation',(pg_temp.basis_deduct(f,child)->>'deducted')::boolean);
  perform pg_temp.basis_check('actual split consumption conserves original A and B',pg_temp.basis_stock(f,(f->>'item_a')::uuid)=before_a-9 and pg_temp.basis_stock(f,(f->>'item_b')::uuid)=before_b-3);
  perform pg_temp.basis_check('split retries do not duplicate',(pg_temp.basis_deduct(f,child)->>'status')='already_deducted' and (pg_temp.basis_deduct(f,(split_order->>'item')::uuid)->>'status')='already_deducted');
  perform pg_temp.basis_mode(f,(f->>'recipe')::uuid);
  merge_source := pg_temp.basis_order(f,'WaiterBatch',14); merge_destination := pg_temp.basis_order(f,'WaiterBatch',15);
  perform pg_temp.basis_actor((f->>'waiter')::uuid); perform public.merge_waiter_dining_sessions((merge_source->>'order_id')::uuid,(merge_destination->>'order_id')::uuid); reset role;
  perform pg_temp.basis_complete(f,merge_destination);
  perform pg_temp.basis_check('merged items both deduct in destination',(pg_temp.basis_deduct(f,(merge_source->>'item')::uuid)->>'deducted')::boolean and (pg_temp.basis_deduct(f,(merge_destination->>'item')::uuid)->>'deducted')::boolean);
  perform pg_temp.basis_actor((f->>'owner')::uuid); perform public.manage_recipe('archive',jsonb_build_object('restaurant_id',f->>'restaurant','recipe_id',f->>'recipe')); reset role;
  perform pg_temp.basis_mode(f);
  perform pg_temp.basis_actor((f->>'owner')::uuid); update public.inventory_items set status='archived',active=false where id=(f->>'item_a')::uuid; reset role;
  perform pg_temp.basis_check('archived recipe preserves old basis',public.build_inventory_deduction_plan((old_recipe->>'item')::uuid)=original_plan);
  perform pg_temp.basis_complete(f,old_recipe);
  before_a := pg_temp.basis_stock(f,(f->>'item_a')::uuid); before_b := pg_temp.basis_stock(f,(f->>'item_b')::uuid);
  perform pg_temp.basis_check('canonical recipe deduction succeeds with archived sources',(pg_temp.basis_deduct(f,(old_recipe->>'item')::uuid)->>'deducted')::boolean);
  perform pg_temp.basis_check('archived recipe still uses original quantities',pg_temp.basis_stock(f,(f->>'item_a')::uuid)=before_a-0.5 and pg_temp.basis_stock(f,(f->>'item_b')::uuid)=before_b-1);
  perform pg_temp.basis_actor((f->>'owner')::uuid);
  perform public.deduct_inventory_for_service_completion((old_recipe->>'order_id')::uuid,null,null); reset role;
  perform pg_temp.basis_check('duplicate completion adapter preserves exactly one receipt and two movements',
    (select count(*)=1 from public.inventory_order_item_deductions where order_item_id=(old_recipe->>'item')::uuid)
    and (select count(*)=2 from public.inventory_movements where order_item_id=(old_recipe->>'item')::uuid));
  begin
    perform pg_temp.basis_actor((f->>'owner')::uuid);
    perform public.mark_order_completed((old_recipe->>'order_id')::uuid,f->>'station','initial');
  exception when others then null; end; reset role;
  perform pg_temp.basis_check('repeated lifecycle attempt does not duplicate inventory history',
    (select count(*)=1 from public.inventory_order_item_deductions where order_item_id=(old_recipe->>'item')::uuid)
    and (select count(*)=2 from public.inventory_movements where order_item_id=(old_recipe->>'item')::uuid));
  perform pg_temp.basis_complete(f,direct_item);
  perform pg_temp.basis_check('disabled direct source uses original frozen basis',(pg_temp.basis_deduct(f,(direct_item->>'item')::uuid)->>'deducted')::boolean);
  perform pg_temp.basis_check('direct movement never inherits later Recipe',(select recipe_id is null from public.inventory_movements where order_item_id=(direct_item->>'item')::uuid));
  rejected := false; begin
    perform pg_temp.basis_actor((f->>'owner')::uuid); perform public.record_inventory_movement_v2((f->>'restaurant')::uuid,gen_random_uuid(),(f->>'item_a')::uuid,(f->>'storage')::uuid,'stock_out',1,null,null,null,null,'Manual archived probe',null,null);
  exception when others then rejected := sqlerrm ilike '%invalid%' or sqlerrm ilike '%active%'; end; reset role;
  perform pg_temp.basis_check('manual archived operation has no new bypass',rejected);
  perform pg_temp.basis_complete(f,none_item);
  perform pg_temp.basis_check('intentional No Tracking returns no_tracking',(pg_temp.basis_deduct(f,(none_item->>'item')::uuid)->>'status')='no_tracking');
  perform pg_temp.basis_actor((f->>'owner')::uuid);
  update public.inventory_items set status='active',active=true where id=(f->>'item_a')::uuid;
  perform public.manage_recipe('restore',jsonb_build_object('restaurant_id',f->>'restaurant','recipe_id',f->>'recipe'));
  perform public.manage_recipe('update',jsonb_build_object('restaurant_id',f->>'restaurant','recipe_id',f->>'recipe','name','Basis recipe','status','active','yield_quantity',1,'yield_unit','servings'));
  perform public.set_restaurant_payment_policy((f->>'restaurant')::uuid,'kitchen_before_payment'); reset role;
  perform pg_temp.basis_mode(f,(f->>'recipe')::uuid); held_order := pg_temp.basis_order(f,'WaiterBatch',16,3);
  perform pg_temp.basis_complete(f,held_order,true);
  perform pg_temp.basis_check('after-meal served batch deducts before settlement',(pg_temp.basis_deduct(f,(held_order->>'item')::uuid)->>'deducted')::boolean);
  select to_jsonb(d) into receipt_before from public.inventory_order_item_deductions d where order_item_id=(held_order->>'item')::uuid;
  select jsonb_agg(to_jsonb(m) order by id) into movements_before from public.inventory_movements m where order_item_id=(held_order->>'item')::uuid;
  perform pg_temp.basis_mode(f); perform pg_temp.basis_actor((f->>'waiter')::uuid);
  perform public.split_waiter_bill_quantities((held_order->>'order_id')::uuid,jsonb_build_array(jsonb_build_object('item_id',held_order->>'item','quantity',1))); reset role;
  select order_item_id into child from public.order_item_inventory_basis where split_parent_order_item_id=(held_order->>'item')::uuid;
  perform pg_temp.basis_check('consumed billing derivative is already accounted',(pg_temp.basis_deduct(f,child)->>'status')='already_deducted_inherited');
  perform pg_temp.basis_check('consumed billing split writes no child receipt or movement',not exists(select 1 from public.inventory_order_item_deductions where order_item_id=child) and not exists(select 1 from public.inventory_movements where order_item_id=child));
  perform pg_temp.basis_check('billing split does not rewrite immutable history',(select to_jsonb(d) from public.inventory_order_item_deductions d where order_item_id=(held_order->>'item')::uuid)=receipt_before
    and (select jsonb_agg(to_jsonb(m) order by id) from public.inventory_movements m where order_item_id=(held_order->>'item')::uuid)=movements_before);
  perform pg_temp.basis_actor((f->>'owner')::uuid); perform public.set_restaurant_payment_policy((f->>'restaurant')::uuid,'pay_before_kitchen'); reset role;
  perform pg_temp.basis_mode(f,(f->>'recipe')::uuid); entry := pg_temp.basis_order(f,'Cashier',17); perform pg_temp.basis_complete(f,entry);
  before_b := pg_temp.basis_stock(f,(f->>'item_b')::uuid);
  perform pg_temp.basis_actor((f->>'owner')::uuid); perform public.record_inventory_movement_v2((f->>'restaurant')::uuid,gen_random_uuid(),(f->>'item_b')::uuid,(f->>'storage')::uuid,'stock_out',before_b,null,null,null,null,'Exhaust rollback fixture',null,null); reset role;
  before_a := pg_temp.basis_stock(f,(f->>'item_a')::uuid);
  rejected := false; begin perform pg_temp.basis_deduct(f,(entry->>'item')::uuid); exception when others then rejected := sqlerrm ilike '%negative stock%'; end;
  perform pg_temp.basis_check('insufficient stock rejects entire recipe',rejected);
  perform pg_temp.basis_check('failed deduction has no partial stock receipt or movements',pg_temp.basis_stock(f,(f->>'item_a')::uuid)=before_a
    and not exists(select 1 from public.inventory_order_item_deductions where order_item_id=(entry->>'item')::uuid)
    and not exists(select 1 from public.inventory_movements where order_item_id=(entry->>'item')::uuid));
  perform pg_temp.basis_actor((f->>'owner')::uuid); perform public.record_inventory_movement_v2((f->>'restaurant')::uuid,gen_random_uuid(),(f->>'item_b')::uuid,(f->>'storage')::uuid,'stock_in',10,null,null,null,null,'Replenish rollback fixture',null,null); reset role;
  perform pg_temp.basis_check('retry after stock correction succeeds',(pg_temp.basis_deduct(f,(entry->>'item')::uuid)->>'deducted')::boolean);
  perform pg_temp.basis_check('retry after success stays once only',(pg_temp.basis_deduct(f,(entry->>'item')::uuid)->>'status')='already_deducted');
  foreach key in array array['owner','manager','kitchen','cashier','waiter','outsider'] loop
    rejected := false; begin
      perform pg_temp.basis_actor((f->>key)::uuid); update public.order_item_inventory_basis set tracking_mode='no_tracking' where order_item_id=(old_recipe->>'item')::uuid;
    exception when insufficient_privilege then rejected := true; end; reset role;
    perform pg_temp.basis_check(key||' cannot directly mutate basis',rejected);
  end loop;
  rejected := false; begin set local role anon; update public.order_item_inventory_basis set tracking_mode='no_tracking'; exception when insufficient_privilege then rejected := true; end; reset role;
  perform pg_temp.basis_check('anonymous cannot mutate basis',rejected);
  rejected := false; begin perform pg_temp.basis_actor((f->>'waiter')::uuid); perform public.prepare_split_inventory_basis((old_recipe->>'item')::uuid,gen_random_uuid(),1); exception when insufficient_privilege then rejected := true; end; reset role;
  perform pg_temp.basis_check('client cannot invoke private split preparer',rejected);
  rejected := false; begin perform pg_temp.basis_actor((f->>'owner')::uuid); insert into public.order_item_inventory_basis_lines values((f->>'restaurant')::uuid,(none_item->>'item')::uuid,(f->>'item_a')::uuid,(f->>'storage')::uuid,(f->>'unit')::uuid,1); exception when insufficient_privilege then rejected := true; end; reset role;
  perform pg_temp.basis_check('client cannot author snapshot lines',rejected);
  rejected := false; begin insert into public.order_item_inventory_basis_lines values((f->>'restaurant')::uuid,(none_item->>'item')::uuid,(f->>'foreign_item')::uuid,(f->>'storage')::uuid,(f->>'unit')::uuid,1); exception when foreign_key_violation then rejected := true; end;
  perform pg_temp.basis_check('cross-tenant snapshot relation fails FK',rejected);
  rejected := false; begin perform pg_temp.basis_mode(f,null,(f->>'foreign_item')::uuid); exception when others then rejected := sqlerrm ilike '%inventory%' or sqlerrm ilike '%foreign key%'; end;
  perform pg_temp.basis_check('cross-tenant direct link rejected',rejected);
  perform pg_temp.basis_actor((f->>'outsider')::uuid); recipe_value := public.manage_recipe('create',jsonb_build_object('restaurant_id',f->>'other','name','Foreign recipe','status','active','yield_quantity',1,'yield_unit','serving')); reset role;
  rejected := false; begin perform pg_temp.basis_mode(f,(recipe_value->>'id')::uuid); exception when others then rejected := sqlerrm ilike '%recipe%' or sqlerrm ilike '%foreign key%'; end;
  perform pg_temp.basis_check('cross-tenant recipe link rejected',rejected);
  perform pg_temp.basis_actor((f->>'owner')::uuid); recipe_value := public.manage_recipe('create',jsonb_build_object('restaurant_id',f->>'restaurant','name','Empty recipe','status','active','yield_quantity',1,'yield_unit','serving')); reset role;
  perform pg_temp.basis_mode(f,(recipe_value->>'id')::uuid);
  select count(*) into count_before from public.order_item_inventory_basis where restaurant_id=(f->>'restaurant')::uuid;
  rejected := false; begin perform pg_temp.basis_order(f,'Cashier',18); exception when others then rejected := sqlerrm ilike '%no ingredients%'; end;
  perform pg_temp.basis_check('invalid tracked creation rejects atomically',rejected);
  perform pg_temp.basis_check('failed creation leaves no orphan basis or order',(select count(*)=count_before from public.order_item_inventory_basis where restaurant_id=(f->>'restaurant')::uuid)
    and not exists(select 1 from public.orders where restaurant_id=(f->>'restaurant')::uuid and table_number='18'));
  rejected := false; begin
    perform pg_temp.basis_actor((f->>'cashier')::uuid);
    perform public.append_items_to_order((entry->>'order_id')::uuid,jsonb_build_array(jsonb_build_object('menu_item_id',f->>'menu','quantity',1)));
  exception when others then rejected := sqlerrm ilike '%no ingredients%'; end; reset role;
  perform pg_temp.basis_check('failed append rolls back items and snapshot lines',rejected
    and (select count(*)=count_before from public.order_item_inventory_basis where restaurant_id=(f->>'restaurant')::uuid)
    and not exists(select 1 from public.order_items i where i.restaurant_id=(f->>'restaurant')::uuid
      and not exists(select 1 from public.order_item_inventory_basis b where b.order_item_id=i.id)));
  perform pg_temp.basis_check('private function surface denies PUBLIC and clients',not exists(
    select 1 from pg_proc p where pronamespace='public'::regnamespace and proname in ('build_inventory_deduction_plan','build_order_time_inventory_plan',
      'capture_order_item_inventory_basis','prepare_split_inventory_basis','reject_inventory_basis_mutation','protect_order_item_inventory_identity')
    and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and privilege_type='EXECUTE'))));
  perform pg_temp.basis_check('no stale overload on frozen accounting surface',not exists(select proname from pg_proc where pronamespace='public'::regnamespace
    and proname in ('build_inventory_deduction_plan','build_order_time_inventory_plan','capture_order_item_inventory_basis','prepare_split_inventory_basis',
      'deduct_inventory_for_order_item','deduct_inventory_for_service_completion','split_waiter_bill_quantities') group by proname having count(*)<>1));
  perform pg_temp.basis_check('SECURITY DEFINER and search_path pinned',not exists(select 1 from pg_proc where pronamespace='public'::regnamespace
    and proname in ('build_inventory_deduction_plan','build_order_time_inventory_plan','capture_order_item_inventory_basis','prepare_split_inventory_basis',
      'deduct_inventory_for_order_item','deduct_inventory_for_service_completion','split_waiter_bill_quantities') and (not prosecdef or not ('search_path=public'=any(proconfig)))));
  perform pg_temp.basis_check('exactly-once indexes remain',2=(select count(*) from pg_indexes where schemaname='public' and indexname in ('inventory_order_item_deductions_pkey','inventory_movements_order_item_deduction_unique') and indexdef like '%UNIQUE INDEX%'));
  perform pg_temp.basis_check('262 bucket remains private',(select public=false from storage.buckets where id='menu-files'));
  set constraints all immediate;
  perform pg_temp.basis_check('all deferred split relationships valid',true);
end; $$;
select label from pg_temp.basis_audit_results order by label;
select jsonb_build_object('tenants',jsonb_build_array(f->>'restaurant',f->>'other'),
  'users',jsonb_build_array(f->>'owner',f->>'waiter',f->>'cashier',f->>'manager',f->>'kitchen',f->>'outsider')) cleanup
  from pg_temp.basis_audit_context;
`;

async function main() {
  const line = fs.readFileSync(path.join(root, 'supabase/connection.env'), 'utf8').split(/\r?\n/).find(value => /^\s*SUPABASE_DB_URL\s*=/.test(value));
  if (!line) throw new Error('Database connection configuration missing');
  const db = new Client({ connectionString: line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/, '').trim().replace(/^['"]|['"]$/g, ''),
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000, keepAlive: true, keepAliveInitialDelayMillis: 10000 });
  db.on('error', error => console.error('Database connection interrupted:', error.message));
  await db.connect();
  const fingerprint = async () => (await db.query(`select proname,pg_get_functiondef(oid) definition,proacl::text acl from pg_proc
    where pronamespace='public'::regnamespace and proname=any($1::text[]) order by proname`, [names])).rows;
  const original = await fingerprint();
  try {
    assert.equal((await db.query("select to_regclass('public.order_item_inventory_basis') relation")).rows[0].relation, null);
    console.log('FINAL MIGRATION SHA256', createHash('sha256').update(migration).digest('hex'));
    const started = Date.now();
    const queryResults = await db.query(`begin; set local statement_timeout='45s'; set local lock_timeout='10s';\n${prologue}\n${rollbackMigration}\n${cases}\nrollback;`);
    const resultSets = Array.isArray(queryResults) ? queryResults : [queryResults];
    const checks = resultSets.flatMap(result => result.rows).filter(row => row.label).map(row => row.label);
    const cleanup = resultSets.flatMap(result => result.rows).find(row => row.cleanup).cleanup;
    for (const label of checks) console.log('PASS', label);
    console.log('SERVER BATCH elapsed ms (including one network round trip)', Date.now() - started);
    assert.deepEqual(await fingerprint(), original);
    console.log('PASS all replaced function definitions and ACLs restored');
    const residue = (await db.query(`select
      to_regclass('public.order_item_inventory_basis') basis,to_regclass('public.order_item_inventory_basis_lines') lines,
      to_regprocedure('public.prepare_split_inventory_basis(uuid,uuid,integer)') helper,
      (select count(*)::int from public.restaurants where id=any($1::uuid[])) tenants,
      (select count(*)::int from auth.users where id=any($2::uuid[])) users,
      (select count(*)::int from public.restaurant_staff where restaurant_id=any($1::uuid[])) staff,
      (select count(*)::int from public.orders where restaurant_id=any($1::uuid[])) orders,
      (select count(*)::int from public.order_items where restaurant_id=any($1::uuid[])) order_items,
      (select count(*)::int from public.menu_items where restaurant_id=any($1::uuid[])) menu,
      (select count(*)::int from public.recipes where restaurant_id=any($1::uuid[])) recipes,
      (select count(*)::int from public.recipe_ingredients where restaurant_id=any($1::uuid[])) ingredients,
      (select count(*)::int from public.inventory_items where restaurant_id=any($1::uuid[])) inventory,
      (select count(*)::int from public.inventory_movements where restaurant_id=any($1::uuid[])) movements,
      (select count(*)::int from public.inventory_order_item_deductions where restaurant_id=any($1::uuid[])) receipts`,
    [cleanup.tenants, cleanup.users])).rows[0];
    assert.ok(Object.values(residue).every(value => value === null || value === 0));
    console.log('PASS zero fixture residue; basis schema and helper absent');
    console.log(`RESULT ${checks.length + 2} PASS; exact final migration and all fixtures rolled back`);
  } finally {
    try { await db.query('rollback'); } finally { await db.end(); }
  }
}
module.exports = { prologue, cases, migration, names };
if (require.main === module) main().catch(error => {
  console.error('FAIL', error.message);
  if (error.where) console.error(error.where.split('\n').filter(line => line.startsWith('PL/pgSQL function')).join('\n'));
  process.exitCode = 1;
});
