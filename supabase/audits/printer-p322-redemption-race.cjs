// Disposable, fixed-loopback full-schema lifecycle race audit.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const db = () => new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:55322/postgres'});
const bytes=()=>crypto.randomBytes(32);
const call=`select public.begin_print_bridge_pairing_with_setup($1::bytea,$2::bytea,$3::text,$4::integer,$5::bytea,$6::uuid,$7::uuid,$8::timestamptz) id`;
async function run(){
  const a=db(),b=db(),observer=db(); await Promise.all([a.connect(),b.connect(),observer.connect()]);
  try {
    const seed=(await observer.query(`select s.restaurant_id,s.user_id from public.restaurant_staff s
      join public.restaurants r on r.id=s.restaurant_id where r.slug like 'p322-a-%' and s.active limit 1`)).rows[0];
    assert.ok(seed,'Expected disposable P322 Owner');
    const code=bytes(),proof=bytes();
    const pair=(await observer.query(call,[code,proof,'P322 race bridge',300,bytes(),seed.user_id,
      seed.restaurant_id,new Date(Date.now()+240000)])).rows[0].id;
    await observer.query('select public.approve_print_bridge_pairing($1,$2,$3,$4)',
      [pair,code,seed.restaurant_id,seed.user_id]);
    await a.query('begin');
    const started=(await a.query('select * from public.begin_print_bridge_redemption($1,$2)',[pair,proof])).rows[0];
    assert.equal(started.restaurant_id,seed.restaurant_id);
    await b.query('begin');
    await b.query(`select set_config('request.jwt.claim.sub',$1,true)`,[seed.user_id]);
    const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const cancellation=b.query('select public.cancel_print_bridge_pairing($1,$2)',
      [pair,seed.restaurant_id]).then(()=>null,e=>e);
    let blocked=false;
    for(let i=0;i<40;i++){
      await new Promise(resolve=>setTimeout(resolve,50));
      if((await observer.query('select pg_blocking_pids($1) pids',[pid])).rows[0].pids.length){blocked=true;break;}
    }
    assert.ok(blocked,'Cancellation did not block on redemption row lock');
    console.log('PASS independent cancellation session blocks on redemption row');
    await a.query('commit');
    assert.equal(await cancellation,null);
    await b.query('commit');
    assert.equal((await observer.query('select status from public.print_bridge_pairings where id=$1',[pair])).rows[0].status,'cancelled');
    console.log('PASS cancellation serializes after redemption and prevents completion');
    try {await observer.query('select public.complete_print_bridge_redemption($1,$2)',[pair,seed.user_id]);assert.fail('Expected rejection');}
    catch(e){assert.equal(e.code,'P0001');}
    console.log('PASS cancelled redemption cannot bind an agent');
  } finally { await Promise.allSettled([a.end(),b.end(),observer.end()]); }
}
run().catch(e=>{console.error(`FAIL ${e.code??''} ${e.message}`);process.exitCode=1});
