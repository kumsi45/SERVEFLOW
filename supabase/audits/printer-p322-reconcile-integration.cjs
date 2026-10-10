// Real isolated Auth Admin + Edge reconciliation against disposable full schema.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {Client}=require('pg');
const {createClient}=require('@supabase/supabase-js');
const raw=fs.readFileSync(`${process.env.LOCALAPPDATA}\\Temp\\serveflow-p322-baseline-status.json`).toString('utf16le');
const config=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
assert.equal(config.API_URL,'http://127.0.0.1:55321');
const env=Object.fromEntries(fs.readFileSync(`${process.env.LOCALAPPDATA}\\Temp\\serveflow-p322-edge-local.env`,'utf8')
  .trim().split('\n').map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)]}));
const service=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const db=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:55322/postgres'});
const bytes=()=>crypto.randomBytes(32);
async function run(){
  await db.connect();
  try{
    const owner=(await db.query(`select s.user_id,s.restaurant_id from public.restaurant_staff s
      join public.restaurants r on r.id=s.restaurant_id
      where r.slug like 'p322-a-%' and s.active and s.role='owner' limit 1`)).rows[0];
    assert.ok(owner);
    const code=bytes(),proof=bytes();
    const pair=(await db.query(`select public.begin_print_bridge_pairing_with_setup(
      $1,$2,'P322 orphan bridge',300,$3,$4,$5,$6) id`,
      [code,proof,bytes(),owner.user_id,owner.restaurant_id,new Date(Date.now()+240000)])).rows[0].id;
    await db.query('select public.approve_print_bridge_pairing($1,$2,$3,$4)',
      [pair,code,owner.restaurant_id,owner.user_id]);
    await db.query('select * from public.begin_print_bridge_redemption($1,$2)',[pair,proof]);
    await db.query(`select public.fail_print_bridge_redemption($1,'AUTH_CLEANUP_PENDING')`,[pair]);
    const email=`bridge-${pair}@bridge.p322.example.test`;
    const made=await service.auth.admin.createUser({email,password:`P322-${crypto.randomUUID()}!`,email_confirm:true,
      app_metadata:{serveflow_kind:'print_bridge',pairing_id:pair,restaurant_id:owner.restaurant_id}});
    assert.ifError(made.error);assert.ok(made.data.user);
    const response=await fetch(`${config.API_URL}/functions/v1/print-bridge-reconcile`,{method:'POST',headers:{
      apikey:config.ANON_KEY,'Content-Type':'application/json',
      'x-print-bridge-maintenance-key':env.PRINT_BRIDGE_MAINTENANCE_KEY},body:'{}'});
    assert.equal(response.status,200);
    const result=await response.json();assert.ok(result.removed>=1);
    const lookup=await service.auth.admin.getUserById(made.data.user.id);
    assert.ok(lookup.error || !lookup.data.user);
    console.log('PASS real Edge reconciliation deleted failed-pairing orphan Auth identity');
  }finally{await db.end()}
}
run().catch(e=>{console.error(`FAIL ${e.code??''} ${e.message}`);process.exitCode=1});
