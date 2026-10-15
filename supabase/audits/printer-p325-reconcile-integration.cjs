// Disposable P3.2.2 loopback Supabase Auth/Edge/PostgreSQL only.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const temp = path.join(process.env.LOCALAPPDATA, 'Temp');
const raw = fs.readFileSync(path.join(temp, 'serveflow-p322-baseline-status.json')).toString('utf16le');
const config = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
assert.equal(config.API_URL, 'http://127.0.0.1:55321');
const edgeEnv = Object.fromEntries(fs.readFileSync(path.join(temp,
  'serveflow-p322-edge-local.env'), 'utf8').trim().split('\n').map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));
const auth = createClient(config.API_URL, config.SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const db = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:55322/postgres' });
const bytes = () => crypto.randomBytes(32);
let checks = 0;
function pass(name, value) { assert.ok(value, name); console.log(`PASS ${name}`); checks++; }
async function invoke() {
  const response = await fetch(`${config.API_URL}/functions/v1/print-bridge-reconcile`, {
    method: 'POST', headers: { apikey: config.ANON_KEY,
      'x-print-bridge-maintenance-key': edgeEnv.PRINT_BRIDGE_MAINTENANCE_KEY },
  });
  return { status: response.status, body: await response.json() };
}
async function main() {
  await db.connect();
  let pair = null, authId = null;
  try {
    const restaurants = (await db.query(`select r.id,r.slug,s.user_id from public.restaurants r
      join public.restaurant_staff s on s.restaurant_id=r.id
      where s.role::text='owner' and s.active order by r.slug`)).rows;
    assert.equal(restaurants.length, 2);
    assert.ok(restaurants.every(row => /^p322-[ab]-/.test(row.slug)));
    assert.equal(Number((await db.query('select count(*) n from public.restaurants')).rows[0].n), 2);
    const owner = restaurants[0], code = bytes(), proof = bytes();
    pair = (await db.query(`select public.begin_print_bridge_pairing_with_setup(
      $1,$2,'P325 orphan',300,$3,$4,$5,$6) id`,
    [code, proof, bytes(), owner.user_id, owner.id, new Date(Date.now() + 240000)])).rows[0].id;
    await db.query('select public.approve_print_bridge_pairing($1,$2,$3,$4)',
      [pair, code, owner.id, owner.user_id]);
    await db.query('select * from public.begin_print_bridge_redemption($1,$2)', [pair, proof]);
    await db.query(`select public.fail_print_bridge_redemption($1,'AUTH_CLEANUP_PENDING')`, [pair]);
    const made = await auth.auth.admin.createUser({
      email: `bridge-${pair}@bridge.p322.example.test`,
      password: `P325-${crypto.randomUUID()}!`, email_confirm: true,
      app_metadata: { serveflow_kind: 'print_bridge', pairing_id: 'malformed',
        restaurant_id: owner.id },
    });
    assert.ifError(made.error); assert.ok(made.data.user);
    authId = made.data.user.id;
    const partial = await invoke();
    pass('real Edge reports invalid metadata as incomplete',
      partial.status === 503 && partial.body.invalid >= 1 && partial.body.removed === 0);
    pass('malformed metadata never deletes Auth identity',
      Boolean((await auth.auth.admin.getUserById(authId)).data.user));
    const mismatched = await auth.auth.admin.updateUserById(authId, {
      app_metadata: { serveflow_kind: 'print_bridge', pairing_id: pair,
        restaurant_id: restaurants[1].id },
    });
    assert.ifError(mismatched.error);
    const wrongTenant = await invoke();
    pass('real Edge flags Auth/pairing tenant mismatch',
      wrongTenant.status === 503 && wrongTenant.body.needsReview >= 1);
    pass('tenant mismatch retains the Auth identity',
      Boolean((await auth.auth.admin.getUserById(authId)).data.user));
    const fixed = await auth.auth.admin.updateUserById(authId, {
      app_metadata: { serveflow_kind: 'print_bridge', pairing_id: pair,
        restaurant_id: owner.id },
    });
    assert.ifError(fixed.error);
    const recovered = await invoke();
    pass('later real Edge run deletes eligible failed-pairing orphan',
      recovered.status === 200 && recovered.body.removed >= 1 &&
      recovered.body.failed === 0 && recovered.body.invalid === 0);
    const gone = await auth.auth.admin.getUserById(authId);
    pass('Auth Admin confirms orphan removal', Boolean(gone.error || !gone.data.user));
    authId = null;
    const repeated = await invoke();
    pass('repeated real Edge reconciliation is idempotent',
      repeated.status === 200 && repeated.body.removed === 0);
    console.log(`RESULT ${checks} real local Auth/Edge/PostgreSQL checks passed`);
  } finally {
    if (authId) await auth.auth.admin.deleteUser(authId);
    if (pair) {
      await db.query('delete from public.print_bridge_pairing_events where pairing_id=$1', [pair]);
      await db.query('delete from public.print_bridge_setup_claims where pairing_id=$1', [pair]);
      await db.query('delete from public.print_bridge_pairings where id=$1', [pair]);
    }
    await db.end();
  }
}
main().catch(error => { console.error(`FAIL ${error.code ?? ''} ${error.message}`); process.exitCode = 1; });
