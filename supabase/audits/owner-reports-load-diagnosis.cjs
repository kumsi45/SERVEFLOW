const fs = require('node:fs');
const { Client } = require('pg');
const readEnv = file => Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).flatMap(line => { const m=line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); return m?[[m[1],m[2].replace(/^["']|["']$/g,'')]]:[]; }));
async function main() {
  const dbEnv=readEnv('supabase/connection.env');
  const db=new Client({connectionString:dbEnv.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
  await db.connect();
  try {
    console.log('Remote migrations', (await db.query("select version,name from supabase_migrations.schema_migrations where version >= '267' order by version")).rows);
    console.log('Remote functions', (await db.query("select proname,pg_get_function_identity_arguments(oid) signature,prosecdef,proconfig,has_function_privilege('authenticated',oid,'execute') authenticated,has_function_privilege('anon',oid,'execute') anonymous from pg_proc where pronamespace='public'::regnamespace and proname in ('get_owner_report_inventory','get_owner_report_cashier_shifts','get_owner_report_inventory_v2','get_owner_report_cashier_shifts_v2')")).rows);
    for(const name of ['get_owner_report_inventory','get_owner_report_cashier_shifts','get_owner_report_inventory_v2','get_owner_report_cashier_shifts_v2']) {
      try { await db.query(`select public.${name}($1,'today',null,null)`,['00000000-0000-0000-0000-000000000000']); }
      catch(e) { console.log(JSON.stringify({rpc:name,code:e.code,message:e.message})); }
    }
  } finally { await db.end(); }
  const envFile=['.env.local','.env'].find(file=>fs.existsSync(file)&&readEnv(file).VITE_SUPABASE_URL);
  if(envFile) {
    const env=readEnv(envFile);
    for(const name of ['get_owner_report_inventory_v2','get_owner_report_cashier_shifts_v2']) {
      const response=await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${env.VITE_SUPABASE_ANON_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({target_restaurant_id:'00000000-0000-0000-0000-000000000000',requested_period:'today',custom_start_date:null,custom_end_date:null,detail_section:'initial',cursor_at:null,cursor_id:null,page_size:50})});
      console.log(JSON.stringify({rpc:name,httpStatus:response.status,anonymousProbe:true,error:await response.json()}));
    }
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
