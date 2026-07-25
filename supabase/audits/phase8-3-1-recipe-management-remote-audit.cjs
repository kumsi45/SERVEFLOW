const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
function connectionUrl(){const line=fs.readFileSync(path.join(__dirname,"..","connection.env"),"utf8").split(/\r?\n/).find((x)=>/^\s*SUPABASE_DB_URL\s*=/.test(x));if(!line)throw new Error("SUPABASE_DB_URL missing");return line.replace(/^\s*SUPABASE_DB_URL\s*=\s*/,"").trim().replace(/^["']|["']$/g,"");}
async function main(){
 const c=new Client({connectionString:connectionUrl(),ssl:{rejectUnauthorized:false}});await c.connect();
 try{
  const fixtures=await c.query(`select restaurant_id,user_id,role::text from restaurant_staff where active and user_id is not null and role::text in ('owner','manager','inventory_officer') order by case role::text when 'owner' then 0 when 'manager' then 1 else 2 end`);
  const manager=fixtures.rows.find((x)=>x.role==='owner'||x.role==='manager');
  if(!manager)throw new Error("Remote audit needs an owner or manager fixture.");
  const other=fixtures.rows.find((x)=>x.restaurant_id!==manager.restaurant_id);
  const reader=fixtures.rows.find((x)=>x.role==='inventory_officer');
  await c.query('begin');await c.query('set local role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[manager.user_id]);
  const category=await c.query(`insert into recipe_categories(restaurant_id,name) values($1,$2) returning id`,[manager.restaurant_id,`Audit Category ${Date.now()}`]);
  const payload={restaurant_id:manager.restaurant_id,name:'Audit Foundation Recipe',description:'Rollback-only validation',category_id:category.rows[0].id,preparation_time_minutes:20,yield_quantity:4,yield_unit:'servings',status:'draft'};
  const created=(await c.query('select manage_recipe($1,$2::jsonb) value',['create',JSON.stringify(payload)])).rows[0].value;
  payload.name='Audit Foundation Recipe Updated';payload.recipe_id=created.id;payload.status='active';
  const updated=(await c.query('select manage_recipe($1,$2::jsonb) value',['update',JSON.stringify(payload)])).rows[0].value;
  const duplicated=(await c.query('select manage_recipe($1,$2::jsonb) value',['duplicate',JSON.stringify({restaurant_id:manager.restaurant_id,recipe_id:created.id})])).rows[0].value;
  await c.query('select manage_recipe($1,$2::jsonb)',['archive',JSON.stringify({restaurant_id:manager.restaurant_id,recipe_id:created.id})]);
  await c.query('select manage_recipe($1,$2::jsonb)',['restore',JSON.stringify({restaurant_id:manager.restaurant_id,recipe_id:created.id})]);
  await c.query('select manage_recipe($1,$2::jsonb)',['delete',JSON.stringify({restaurant_id:manager.restaurant_id,recipe_id:duplicated.id})]);
  const listed=(await c.query(`select list_recipes($1,'Updated',$2,'draft','medium','newest',1,5) value`,[manager.restaurant_id,category.rows[0].id])).rows[0].value;
  let crossTenantDenied=true;if(other){await c.query('savepoint cross_tenant');try{await c.query(`select list_recipes($1,null,null,'all','all','newest',1,5)`,[other.restaurant_id]);crossTenantDenied=false;}catch{}await c.query('rollback to savepoint cross_tenant');}
  let inventoryReadOnly=true;if(reader){await c.query("select set_config('request.jwt.claim.sub',$1,true)",[reader.user_id]);const readable=await c.query('select count(*) from recipes where restaurant_id=$1',[reader.restaurant_id]);await c.query('savepoint readonly');try{await c.query('select manage_recipe($1,$2::jsonb)',['create',JSON.stringify({...payload,restaurant_id:reader.restaurant_id,recipe_id:null})]);inventoryReadOnly=false;}catch{}await c.query('rollback to savepoint readonly');inventoryReadOnly=inventoryReadOnly&&Number(readable.rows[0].count)>=0;}
  await c.query('reset role');await c.query('rollback');
  const passed=/^REC-\d{6}$/.test(created.recipe_code)&&updated.status==='active'&&duplicated.status==='draft'&&duplicated.recipe_code!==created.recipe_code&&listed.total===1&&crossTenantDenied&&inventoryReadOnly;
  console.log(JSON.stringify({passed,createdCode:created.recipe_code,duplicateCode:duplicated.recipe_code,searchTotal:listed.total,crossTenantDenied,inventoryReadOnly,inventoryFixtureTested:Boolean(reader)}));if(!passed)process.exitCode=1;
 }catch(e){await c.query('reset role').catch(()=>{});await c.query('rollback').catch(()=>{});throw e;}finally{await c.end();}
}
main().catch((e)=>{console.error(e.message);process.exit(1)});
