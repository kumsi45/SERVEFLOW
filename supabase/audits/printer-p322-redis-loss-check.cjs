// Run after the isolated Redis restart/eviction probe; PostgreSQL owns replay.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Client}=require('pg');
async function run(){
  const db=new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:55322/postgres'});
  await db.connect();
  try{
    const row=(await db.query(`select c.setup_digest,c.owner_user_id,c.restaurant_id
      from public.print_bridge_setup_claims c join public.restaurant_staff s
      on s.restaurant_id=c.restaurant_id and s.user_id=c.owner_user_id
      where s.active and s.role='owner' order by c.claimed_at desc limit 1`)).rows[0];
    assert.ok(row,'Expected active isolated Owner with a consumed token');
    try{
      await db.query(`select public.begin_print_bridge_pairing_with_setup(
        $1,$2,'P322 Redis loss replay',300,$3,$4,$5,$6)`,[
        crypto.randomBytes(32),crypto.randomBytes(32),row.setup_digest,
        row.owner_user_id,row.restaurant_id,new Date(Date.now()+240000)]);
      assert.fail('Consumed setup digest was accepted');
    }catch(e){assert.equal(e.code,'23505',e.message)}
    console.log('PASS PostgreSQL rejects consumed setup digest after real isolated Redis restart and eviction');
  }finally{await db.end()}
}
run().catch(e=>{console.error(`FAIL ${e.code??''} ${e.message}`);process.exitCode=1});
