// Real isolated Supabase Auth + PostgREST + restored PostgreSQL, fixed loopback.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {Client}=require('pg');
const {createClient}=require('@supabase/supabase-js');
const raw=fs.readFileSync(`${process.env.LOCALAPPDATA}\\Temp\\serveflow-p322-baseline-status.json`).toString('utf16le');
const config=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
assert.equal(config.API_URL,'http://127.0.0.1:55321');
const admin=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const publicClient=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false}});
const db=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:55322/postgres'});
const id=()=>crypto.randomUUID(), bytes=()=>crypto.randomBytes(32);
async function run(){
  await db.connect();
  try {
    const tenants=(await db.query(`select id from public.restaurants where slug like 'p322-%' order by slug limit 2`)).rows;
    assert.equal(tenants.length,2);
    const email=`p322-auth-${id()}@example.test`,password=`P322-${id()}!`;
    const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
    assert.ifError(created.error);const user=created.data.user;assert.ok(user);
    // This disposable tenant permits one active Owner; hand the local fixture to
    // the new Auth user so the real JWT can exercise the Owner RPC.
    await db.query(`update public.restaurant_staff set active=false
      where restaurant_id=$1 and role='owner' and active`,[tenants[0].id]);
    await db.query(`insert into public.restaurant_staff
      (restaurant_id,user_id,role,display_name,active) values ($1,$2,'owner','P322 JWT owner',true)`,
      [tenants[0].id,user.id]);
    const login=await publicClient.auth.signInWithPassword({email,password});
    assert.ifError(login.error);const jwt=login.data.session?.access_token;assert.ok(jwt);
    const found=await publicClient.auth.getUser(jwt);
    assert.ifError(found.error);assert.equal(found.data.user?.id,user.id);
    console.log('PASS real isolated Owner sign-in and JWT validation');
    const code=bytes(),proof=bytes();
    const pair=(await db.query(`select public.begin_print_bridge_pairing_with_setup(
      $1,$2,'P322 Auth test',300,$3,$4,$5,$6) id`,
      [code,proof,bytes(),user.id,tenants[0].id,new Date(Date.now()+240000)])).rows[0].id;
    await db.query('select public.approve_print_bridge_pairing($1,$2,$3,$4)',
      [pair,code,tenants[0].id,user.id]);
    const rpc=`${config.API_URL}/rest/v1/rpc/cancel_print_bridge_pairing`;
    const invoke=async(bearer,restaurantId)=>fetch(rpc,{method:'POST',headers:{
      apikey:config.ANON_KEY,Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},
      body:JSON.stringify({target_pairing_id:pair,target_restaurant_id:restaurantId})});
    const missing=await fetch(rpc,{method:'POST',headers:{apikey:config.ANON_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({target_pairing_id:pair,target_restaurant_id:tenants[0].id})});
    assert.ok(missing.status>=400);
    console.log(`PASS missing Owner JWT denied by PostgREST (${missing.status})`);
    const invalid=await invoke('invalid.jwt.token',tenants[0].id);assert.ok(invalid.status>=400);
    console.log(`PASS invalid Owner JWT denied by PostgREST (${invalid.status})`);
    const b64=(value)=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const jwtHead=b64({alg:'HS256',typ:'JWT'});
    const jwtBody=b64({iss:'supabase-demo',role:'authenticated',aud:'authenticated',
      sub:user.id,iat:Math.floor(Date.now()/1000)-7200,exp:Math.floor(Date.now()/1000)-3600});
    const sig=crypto.createHmac('sha256',config.JWT_SECRET).update(`${jwtHead}.${jwtBody}`).digest('base64url');
    const expired=await invoke(`${jwtHead}.${jwtBody}.${sig}`,tenants[0].id);
    assert.ok(expired.status>=400);
    console.log(`PASS expired signed Owner JWT denied by PostgREST (${expired.status})`);
    const cross=await invoke(jwt,tenants[1].id);assert.ok(cross.status>=400);
    console.log(`PASS cross-tenant Owner cancellation denied (${cross.status})`);
    const own=await invoke(jwt,tenants[0].id);assert.ok(own.ok,`${own.status} ${await own.text()}`);
    assert.equal((await db.query('select status from public.print_bridge_pairings where id=$1',[pair])).rows[0].status,'cancelled');
    console.log('PASS valid Owner JWT cancelled only its own pairing');
  }finally{await db.end()}
}
run().catch(e=>{console.error(`FAIL ${e.code??''} ${e.message}`);process.exitCode=1});
