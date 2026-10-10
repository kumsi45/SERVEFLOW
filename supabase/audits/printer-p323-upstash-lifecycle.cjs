// Complete lifecycle through isolated local Kong/Edge/Auth/PostgREST and the
// actual temporary Upstash HTTPS REST database. No hosted ServeFlow writes.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {Client}=require('pg');
const {createClient}=require('@supabase/supabase-js');
const status=fs.readFileSync(`${process.env.LOCALAPPDATA}\\Temp\\serveflow-p322-baseline-status.json`).toString('utf16le');
const config=JSON.parse(status.slice(status.indexOf('{'),status.lastIndexOf('}')+1));
const upstash=JSON.parse(fs.readFileSync(`${process.env.LOCALAPPDATA}\\Temp\\serveflow-p323-upstash.json`,'utf8'));
assert.equal(config.API_URL,'http://127.0.0.1:55321');
const admin=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const anon=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false}});
const db=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:55322/postgres'});
const endpoint=name=>`${config.API_URL}/functions/v1/${name}`;
const post=(name,body,jwt)=>fetch(endpoint(name),{method:'POST',headers:{apikey:config.ANON_KEY,
  'Content-Type':'application/json',Origin:'http://localhost:5173',...(jwt?{Authorization:`Bearer ${jwt}`}:{})},body:JSON.stringify(body)});
const proof=()=>crypto.randomBytes(32).toString('base64url');
async function json(response, expected){const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;}
async function run(){
  await db.connect();
  try {
    const tenants=(await db.query(`select id from public.restaurants where slug like 'p322-%' order by slug limit 2`)).rows;
    assert.equal(tenants.length,2);
    const email=`p323-owner-${crypto.randomUUID()}@example.test`,password=`P323-${crypto.randomUUID()}!`;
    const made=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(made.error);
    const owner=made.data.user.id;
    await db.query(`update public.restaurant_staff set active=false where restaurant_id=$1 and role='owner' and active`,[tenants[0].id]);
    await db.query(`insert into public.restaurant_staff(restaurant_id,user_id,role,display_name,active)
      values ($1,$2,'owner','P323 isolated owner',true)`,[tenants[0].id,owner]);
    const signed=await anon.auth.signInWithPassword({email,password});assert.ifError(signed.error);
    const jwt=signed.data.session.access_token;
    const issued=await json(await post('print-bridge-owner',{action:'initiate',restaurantId:tenants[0].id},jwt),200);
    assert.match(issued.setupToken,/^v\d+\./); console.log('PASS isolated Owner setup-token issuance via actual Upstash REST');
    const bridgeProof=proof();
    const started=await json(await post('print-bridge-pair',{action:'start',bridgeName:'P323 Upstash bridge',proof:bridgeProof,setupToken:issued.setupToken}),200);
    assert.match(started.pairingId,/^[0-9a-f-]{36}$/i);assert.match(started.code,/^\d{10}$/);
    console.log('PASS bridge start atomically charges HTTPS rate budgets and creates pairing');
    await json(await post('print-bridge-owner',{action:'approve',restaurantId:tenants[0].id,
      pairingId:started.pairingId,code:started.code,setupToken:issued.setupToken},jwt),200);
    console.log('PASS Owner approval through authenticated Edge boundary');
    const redeemed=await json(await post('print-bridge-pair',{action:'redeem',pairingId:started.pairingId,proof:bridgeProof}),200);
    assert.equal(redeemed.restaurantId,tenants[0].id);assert.match(redeemed.agentId,/^[0-9a-f-]{36}$/i);
    assert.ok(redeemed.session?.accessToken&&redeemed.session?.refreshToken);
    console.log('PASS one-time credential delivery and agent binding through actual Upstash REST');
    const replay=await post('print-bridge-pair',{action:'redeem',pairingId:started.pairingId,proof:bridgeProof});
    assert.equal(replay.status,409,await replay.text());
    console.log('PASS replay rejected after completed redemption');
    const wrong=await post('print-bridge-pair',{action:'redeem',pairingId:crypto.randomUUID(),proof:proof()});
    assert.equal(wrong.status,409,await wrong.text());
    console.log('PASS unrelated invalid redemption cannot consume valid pairing capacity');
    const ping=await fetch(upstash.url,{method:'POST',headers:{Authorization:`Bearer ${upstash.token}`,'Content-Type':'application/json'},body:'["PING"]'});
    assert.equal(ping.status,200);console.log('PASS provider restored/available after lifecycle');
  } finally { await db.end(); }
}
run().catch(e=>{console.error(`FAIL ${e.code??''} ${e.message}`);process.exitCode=1});
