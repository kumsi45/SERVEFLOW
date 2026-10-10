// Creates a short-lived, isolated Upstash database using the provider's
// documented agent endpoint. Credentials stay in a private Temp file.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const privatePath = path.join(process.env.LOCALAPPDATA, 'Temp', 'serveflow-p323-upstash.json');
const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],tonumber(ARGV[1])); end; return n";
const request = async (url, token, command, extra = {}) => {
  const response = await fetch(url, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra,
  }, body: JSON.stringify(command), signal: AbortSignal.timeout(5000) });
  return { status: response.status, body: await response.json() };
};
async function run() {
  const created = await fetch('https://upstash.com/start-redis', { method: 'POST', headers: {
    'User-Agent': 'codex-serveflow-p323-certification', Accept: 'text/markdown, text/plain',
  }, signal: AbortSignal.timeout(15000) });
  assert.equal(created.status, 200, 'Upstash temporary database creation failed');
  const text = await created.text();
  const url = text.match(/^\*\*Endpoint:\*\*\s*(https:\/\/[^\s]+)$/mi)?.[1];
  const token = text.match(/^\*\*Token:\*\*\s*([A-Za-z0-9._=-]+)$/mi)?.[1];
  assert.ok(url && token, 'Could not parse isolated Upstash credentials');
  const prefix = `serveflow:p323:${crypto.randomUUID()}`;
  const first = await request(url, token, ['EVAL', script, 1, `${prefix}:counter`, 3]);
  const second = await request(url, token, ['EVAL', script, 1, `${prefix}:counter`, 3]);
  assert.deepEqual([first.status, first.body.result, second.status, second.body.result], [200, 1, 200, 2]);
  const ttl = await request(url, token, ['TTL', `${prefix}:counter`]);
  assert.ok(ttl.status === 200 && Number.isInteger(ttl.body.result) && ttl.body.result >= 0 && ttl.body.result <= 3);
  const replay = await request(url, token, ['SET', `${prefix}:replay`, 'claimed', 'NX', 'EX', 30]);
  const replayAgain = await request(url, token, ['SET', `${prefix}:replay`, 'claimed', 'NX', 'EX', 30]);
  assert.equal(replay.body.result, 'OK'); assert.equal(replayAgain.body.result, null);
  const unauthorized = await request(url, 'invalid-token', ['PING']);
  assert.equal(unauthorized.status, 401);
  const malformed = await request(url, token, ['NOT_A_REDIS_COMMAND']);
  assert.equal(malformed.status, 400);
  fs.writeFileSync(privatePath, JSON.stringify({ url, token, prefix }), { mode: 0o600 });
  console.log('PASS isolated Upstash HTTPS REST: EVAL, TTL, NX replay, auth and error classification');
  console.log('PASS credentials retained only in private Temp file for local Edge lifecycle');
}
run().catch((error) => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
