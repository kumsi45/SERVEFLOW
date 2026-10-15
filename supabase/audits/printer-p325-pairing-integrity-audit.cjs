// Disposable local P3.2.2 stack only. Applies candidate 275 locally and uses
// rollback fixtures, except one concurrent pair that is explicitly removed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const url = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const migration = path.resolve(__dirname, '../migrations/275_print_bridge_claim_bound_approval.sql');
const connection = () => new Client({ connectionString: url, connectionTimeoutMillis: 10000,
  query_timeout: 15000 });
const digest = () => crypto.randomBytes(32);
const call = `select public.begin_print_bridge_pairing_with_setup(
  $1::bytea,$2::bytea,$3::text,$4::integer,$5::bytea,$6::uuid,$7::uuid,$8::timestamptz) id`;
const approve = 'select public.approve_print_bridge_pairing($1,$2,$3,$4) id';
let checks = 0;
function pass(label, condition) { assert.ok(condition, label); console.log(`PASS ${label}`); checks++; }
async function rejects(client, sql, args, code = 'P0001') {
  try { await client.query(sql, args); assert.fail(`Expected ${code}`); }
  catch (error) { assert.equal(error.code, code, error.message); }
}
async function rollback(client, action) {
  await client.query('begin');
  try { await action(); } finally { await client.query('rollback'); }
}
async function main() {
  const admin = connection(), first = connection(), second = connection();
  await Promise.all([admin.connect(), first.connect(), second.connect()]);
  let committedPair = null;
  try {
    const guard = (await admin.query(`select r.id,r.slug,s.user_id from public.restaurants r
      join public.restaurant_staff s on s.restaurant_id=r.id
      where s.role::text='owner' and s.active order by r.slug`)).rows;
    const restCount = Number((await admin.query('select count(*) n from public.restaurants')).rows[0].n);
    const unsafeUsers = Number((await admin.query(`select count(*) n from auth.users
      where email not like '%@example.test' and email not like '%@bridge.p322.example.test'`)).rows[0].n);
    assert.equal(restCount, 2, 'Requires exactly two disposable P322 restaurants');
    assert.equal(guard.length, 2);
    assert.ok(guard[0].slug.startsWith('p322-a-') && guard[1].slug.startsWith('p322-b-'));
    assert.equal(unsafeUsers, 0, 'Refuses non-synthetic Auth users');
    const [a, b] = guard;
    const args = (owner = a, setup = digest(), code = digest(), proof = digest()) =>
      [code, proof, 'P325 disposable bridge', 300, setup, owner.user_id, owner.id,
        new Date(Date.now() + 240000)];
    const migration274 = fs.readFileSync(path.resolve(__dirname,
      '../migrations/274_print_bridge_durable_setup_claim.sql'));
    pass('Migration 274 remains immutable', crypto.createHash('sha256').update(migration274)
      .digest('hex').toUpperCase() === 'A3674085DB54A2C54C6A52565901EC5D6206C1E86B542894889C77EAC6956C81');

    const oldDefinition = (await admin.query(`select pg_get_functiondef(
      'public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid)'::regprocedure) definition`)).rows[0].definition;
    if (!oldDefinition.includes('print_bridge_setup_claims')) {
      await rollback(admin, async () => {
        const request = args();
        const pair = (await admin.query(call, request)).rows[0].id;
        const result = (await admin.query(approve,
          [pair, request[0], b.id, b.user_id])).rows[0].id;
        pass('pre-fix cross-restaurant approval reproduced in rollback', result === pair &&
          (await admin.query('select restaurant_id from public.print_bridge_pairings where id=$1',
            [pair])).rows[0].restaurant_id === b.id);
      });
    } else console.log('SKIP pre-fix reproduction: isolated function already has claim check');

    await admin.query(fs.readFileSync(migration, 'utf8'));
    pass('candidate Migration 275 applied only to guarded disposable local database', true);
    const privileges = (await admin.query(`select
      has_function_privilege('anon','public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid)','execute') anon,
      has_function_privilege('authenticated','public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid)','execute') authenticated,
      has_function_privilege('service_role','public.approve_print_bridge_pairing(uuid,bytea,uuid,uuid)','execute') service,
      has_table_privilege('anon','public.print_bridge_setup_claims','select') anon_claim,
      has_table_privilege('authenticated','public.print_bridge_setup_claims','select') auth_claim`)).rows[0];
    pass('browser roles cannot execute approval or read claims; service role can',
      !privileges.anon && !privileges.authenticated && privileges.service &&
      !privileges.anon_claim && !privileges.auth_claim);
    for (const role of ['anon', 'authenticated']) {
      await rollback(admin, async () => {
        await admin.query(`set local role ${role}`);
        await admin.query('savepoint denied');
        await rejects(admin, approve, [crypto.randomUUID(), digest(), a.id, a.user_id], '42501');
        await admin.query('rollback to savepoint denied');
      });
    }
    pass('anon and authenticated execution denied by PostgreSQL', true);

    await rollback(admin, async () => {
      const request = args(); const pair = (await admin.query(call, request)).rows[0].id;
      pass('same Owner and restaurant approve', (await admin.query(approve,
        [pair, request[0], a.id, a.user_id])).rows[0].id === pair);
    });
    await rollback(admin, async () => {
      const request = args(); const pair = (await admin.query(call, request)).rows[0].id;
      await admin.query('savepoint rejected');
      await rejects(admin, approve, [pair, request[0], b.id, b.user_id]);
      await admin.query('rollback to savepoint rejected');
      pass('other restaurant and Owner cannot reuse claim',
        (await admin.query('select status from public.print_bridge_pairings where id=$1',
          [pair])).rows[0].status === 'pending');
      await admin.query('savepoint rejected');
      await rejects(admin, approve, [pair, request[0], a.id, b.user_id]);
      await admin.query('rollback to savepoint rejected');
      pass('Owner from another restaurant cannot approve original claim', true);
    });
    await rollback(admin, async () => {
      const request = args(); const pair = (await admin.query(call, request)).rows[0].id;
      await admin.query('update public.print_bridge_setup_claims set restaurant_id=$1 where pairing_id=$2',
        [b.id, pair]);
      await admin.query('savepoint rejected');
      await rejects(admin, approve, [pair, request[0], a.id, a.user_id]);
      await admin.query('rollback to savepoint rejected');
      pass('inconsistent claim restaurant fails closed', true);
    });
    await rollback(admin, async () => {
      const request = args(); const pair = (await admin.query(call, request)).rows[0].id;
      await admin.query(`update public.print_bridge_setup_claims
        set token_expires_at=clock_timestamp()-interval '1 second' where pairing_id=$1`, [pair]);
      await admin.query('savepoint rejected');
      await rejects(admin, approve, [pair, request[0], a.id, a.user_id]);
      await admin.query('rollback to savepoint rejected');
      pass('expired claim fails closed', true);
    });
    await rollback(admin, async () => {
      const code = digest(), proof = digest();
      const pair = (await admin.query(`select public.begin_print_bridge_pairing(
        $1::bytea,$2::bytea,'P325 legacy pair',300) id`, [code, proof])).rows[0].id;
      await admin.query('savepoint rejected');
      await rejects(admin, approve, [pair, code, a.id, a.user_id]);
      await admin.query('rollback to savepoint rejected');
      pass('missing claim fails closed', true);
    });
    await rollback(admin, async () => {
      const request = args(); await admin.query(call, request);
      await admin.query('savepoint rejected');
      await rejects(admin, call, request, '23505');
      await admin.query('rollback to savepoint rejected');
      pass('replayed setup claim fails closed', true);
    });
    const rolled = args();
    await rollback(admin, async () => { await admin.query(call, rolled); });
    await rollback(admin, async () => {
      const pair = (await admin.query(call, rolled)).rows[0].id;
      pass('rolled-back claim safely retries', Boolean(pair));
    });

    const raceArgs = args();
    committedPair = (await admin.query(call, raceArgs)).rows[0].id;
    await first.query('begin'); await second.query('begin');
    try {
      await first.query(approve, [committedPair, raceArgs[0], a.id, a.user_id]);
      const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
      const pending = second.query(approve, [committedPair, raceArgs[0], a.id, a.user_id])
        .then(() => null, error => error);
      let blocked = false;
      for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        if ((await admin.query('select pg_blocking_pids($1) pids', [secondPid])).rows[0].pids.length) {
          blocked = true; break;
        }
      }
      pass('concurrent approval visibly waits on pairing row lock', blocked);
      await first.query('commit');
      const loser = await pending;
      pass('second approval rejected after first commits', loser?.code === 'P0001');
      await second.query('rollback');
      pass('concurrent approvals emit one approval event', Number((await admin.query(`select count(*) n
        from public.print_bridge_pairing_events where pairing_id=$1 and event_type='approved'`,
        [committedPair])).rows[0].n) === 1);
    } finally {
      await Promise.allSettled([first.query('rollback'), second.query('rollback')]);
    }
    console.log(`RESULT ${checks} PostgreSQL checks passed`);
  } finally {
    if (committedPair) {
      await admin.query('delete from public.print_bridge_pairing_events where pairing_id=$1', [committedPair]);
      await admin.query('delete from public.print_bridge_setup_claims where pairing_id=$1', [committedPair]);
      await admin.query('delete from public.print_bridge_pairings where id=$1', [committedPair]);
    }
    await Promise.allSettled([admin.end(), first.end(), second.end()]);
  }
}
main().catch(error => { console.error(`FAIL ${error.code ?? ''} ${error.message}`); process.exitCode = 1; });
