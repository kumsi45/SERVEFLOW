// Real local Kong/Edge/Auth/PostgREST HTTP; isolated Redis REST is unavailable.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {Client}=require('pg');
const {createClient}=require('@supabase/supabase-js');
const raw=fs.readFileSync(`${process.env.LOCALAPPDATA}\\Temp\\serveflow-p322-baseline-status.json`).toString('utf16le');
const config=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));
assert.equal(config.API_URL,'http://127.0.0.1:55321');
const env=Object.fromEntries(fs.readFileSync(`${process.env.LOCALAPPDATA}\\Temp\\serveflow-p322-edge-local.env`,'utf8')
  .trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)]}));
const service=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const anonymous=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false}});
const db=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:55322/postgres'});
const endpoint=(name)=>`${config.API_URL}/functions/v1/${name}`;
const headers=(token)=>({...token?{Authorization:`Bearer ${token}`}:{},
  apikey:config.ANON_KEY,'Content-Type':'application/json',Origin:'http://localhost:5173'});
const post=(name,body,token,extra={})=>fetch(endpoint(name),{method:'POST',headers:{...headers(token),...extra},body:JSON.stringify(body)});
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function run(){
  await db.connect();
  try{
    const tenant=(await db.query(`select id from public.restaurants where slug like 'p322-a-%' limit 1`)).rows[0]?.id;
    const other=(await db.query(`select id from public.restaurants where slug like 'p322-b-%' limit 1`)).rows[0]?.id;
    assert.ok(tenant&&other);
    const email=`p322-edge-${crypto.randomUUID()}@example.test`,password=`P322-${crypto.randomUUID()}!`;
    const made=await service.auth.admin.createUser({email,password,email_confirm:true});
    assert.ifError(made.error);const uid=made.data.user.id;
    await db.query(`update public.restaurant_staff set active=false
      where restaurant_id=$1 and role='owner' and active`,[tenant]);
    await db.query(`insert into public.restaurant_staff
      (restaurant_id,user_id,role,display_name,active) values ($1,$2,'owner','P322 Edge owner',true)`,[tenant,uid]);
    const sign=await anonymous.auth.signInWithPassword({email,password});
    assert.ifError(sign.error);const jwt=sign.data.session.access_token;
    const options=await fetch(endpoint('print-bridge-owner'),{method:'OPTIONS',headers:{Origin:'http://localhost:5173'}});
    assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),'*');
    console.log('PASS Owner CORS preflight through local gateway (gateway emits wildcard origin)');
    const badOrigin=await fetch(endpoint('print-bridge-owner'),{method:'OPTIONS',headers:{Origin:'https://evil.example.test'}});
    assert.equal(badOrigin.status,403);assert.equal(badOrigin.headers.get('access-control-allow-origin'),'*');
    console.log('PASS disallowed Owner origin denied by handler despite gateway wildcard CORS header');
    const missing=await post('print-bridge-owner',{action:'initiate',restaurantId:tenant});
    assert.equal(missing.status,401);console.log('PASS Owner gateway rejects missing JWT');
    const invalid=await post('print-bridge-owner',{action:'initiate',restaurantId:tenant},'invalid.jwt.token');
    assert.equal(invalid.status,401);console.log('PASS Owner gateway rejects invalid JWT');
    const head=b64({alg:'HS256',typ:'JWT'}),body=b64({iss:'supabase-demo',role:'authenticated',
      aud:'authenticated',sub:uid,iat:Math.floor(Date.now()/1000)-7200,exp:Math.floor(Date.now()/1000)-3600});
    const sig=crypto.createHmac('sha256',config.JWT_SECRET).update(`${head}.${body}`).digest('base64url');
    const expired=await post('print-bridge-owner',{action:'initiate',restaurantId:tenant},`${head}.${body}.${sig}`);
    assert.equal(expired.status,401);console.log('PASS Owner gateway rejects expired JWT');
    const cross=await post('print-bridge-owner',{action:'initiate',restaurantId:other},jwt);
    assert.equal(cross.status,403);console.log('PASS Owner Edge authorization rejects cross-tenant request');
    const own=await post('print-bridge-owner',{action:'initiate',restaurantId:tenant},jwt);
    assert.equal(own.status,503);console.log('PASS Owner initiation fails closed with Redis REST unavailable');
    const publicInvalid=await post('print-bridge-pair',{action:'redeem',pairingId:crypto.randomUUID(),proof:'invalid'});
    assert.equal(publicInvalid.status,400);console.log('PASS unauthenticated public Edge request reaches bounded validation');
    const publicMethod=await fetch(endpoint('print-bridge-pair'),{method:'OPTIONS'});
    assert.equal(publicMethod.status,405);console.log('PASS public endpoint has no browser preflight permission');
    const recMissing=await post('print-bridge-reconcile',{});
    assert.equal(recMissing.status,403);console.log('PASS maintenance endpoint denies absent secret');
    const recValid=await post('print-bridge-reconcile',{},null,{'x-print-bridge-maintenance-key':env.PRINT_BRIDGE_MAINTENANCE_KEY});
    assert.equal(recValid.status,200,await recValid.text());
    console.log('PASS maintenance endpoint accepts isolated secret through gateway');
  }finally{await db.end()}
}
run().catch(e=>{console.error(`FAIL ${e.code??''} ${e.message}`);process.exitCode=1});
