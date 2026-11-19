import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { URL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const SA = 'a1000000-0000-4000-8000-000000000001';
const SB = 'b1000000-0000-4000-8000-000000000002';
const SC = 'c1000000-0000-4000-8000-000000000003';
const IA = 'a2000000-0000-4000-8000-000000000001';
const IB = 'b2000000-0000-4000-8000-000000000002';
const IB2 = 'b3000000-0000-4000-8000-000000000002';
const REQUEST = 'd0000000-0000-4000-8000-000000000004';

before(async () => {
  await db.exec(await readFile(new URL('./fixtures/supabase.sql', import.meta.url), 'utf8'));
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  }
});
after(async () => { await db.close(); });

async function register(user, session, installation, token) {
  return db.query('select public.register_push_device($1,$2,$3,$4,$5) as id', [user, session, installation, token, 'ios']);
}
async function request() {
  await db.query('insert into public.connection_requests(id,sender_id,recipient_id) values ($1,$2,$3)', [REQUEST, A, B]);
}
async function claim() { return (await db.query('select * from public.claim_push_deliveries()')).rows; }
async function finish(item, status, ticket = null) {
  return (await db.query('select public.finish_push_delivery($1,$2,$3,$4) as saved', [item.id, item.lease_token, status, ticket])).rows[0].saved;
}
async function fixture(run) {
  await db.exec('begin');
  try {
    await db.query("insert into auth.users(id,email) values ($1,'a@example.invalid'),($2,'b@example.invalid'),($3,'c@example.invalid')", [A, B, C]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4),($5,$6)', [SA, A, SB, B, SC, C]);
    await register(A, SA, IA, 'ExpoPushToken[a-one]');
    await register(B, SB, IB, 'ExpoPushToken[b-one]');
    await register(B, SB, IB2, 'ExpoPushToken[b-two]');
    await db.query('update public.user_preferences set notifications_enabled=true where user_id=$1', [B]);
    await run();
  } finally { await db.exec('rollback'); }
}

test('the full migration history applies and tokens/worker RPCs are denied to app roles', () => fixture(async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['push_devices', 'notification_outbox', 'push_deliveries']) {
      const { rows } = await db.query('select has_table_privilege($1,$2,$3) as allowed', [role, 'public.' + table, 'select']);
      assert.equal(rows[0].allowed, false);
    }
    const { rows } = await db.query("select has_function_privilege($1,'public.claim_push_deliveries(integer)','execute') as allowed", [role]);
    assert.equal(rows[0].allowed, false);
  }
  const { rows } = await db.query("select count(*)::integer as total from pg_class where relname in ('push_devices','notification_outbox','push_deliveries') and relrowsecurity");
  assert.equal(rows[0].total, 3);
}));
test('registration requires an active account and its own non-expired Auth session', () => fixture(async () => {
  await assert.rejects(register(B, SA, IB, 'ExpoPushToken[wrong]'), /active account session/);
}));
test('deactivated accounts cannot register', () => fixture(async () => {
  await db.query("update public.profiles set account_status='deactivated' where id=$1", [B]);
  await assert.rejects(register(B, SB, IB, 'ExpoPushToken[wrong]'), /active account session/);
}));
test('the service role can claim work while authenticated clients cannot invoke worker RPCs', () => fixture(async () => {
  await request();
  await db.exec('set local role service_role');
  assert.equal((await claim()).length, 2);
  await db.exec('reset role; set local role authenticated');
  await assert.rejects(db.query('select * from public.claim_push_deliveries()'), /permission denied/);
}));
test('a request queues one delivery per device and workers cannot claim it twice', () => fixture(async () => {
  await request();
  const items = await claim();
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.recipient_id === B && item.kind === 'request'));
  assert.equal((await claim()).length, 0);
  await db.query('update public.connection_requests set recipient_read_at=now() where id=$1', [REQUEST]);
  assert.equal((await db.query('select count(*)::integer as total from public.notification_outbox')).rows[0].total, 1);
}));
test('accepted requests notify the sender and messages notify the other participant', () => fixture(async () => {
  await request();
  await db.query('update public.user_preferences set notifications_enabled=true where user_id=$1', [A]);
  await db.query("update public.connection_requests set status='accepted' where id=$1", [REQUEST]);
  await db.query('insert into public.messages(request_id,sender_id,body) values ($1,$2,$3)', [REQUEST, A, 'Private message']);
  const items = await claim();
  assert.equal(items.filter((item) => item.kind === 'accepted' && item.recipient_id === A).length, 1);
  assert.equal(items.filter((item) => item.kind === 'message' && item.recipient_id === B).length, 2);
  assert.equal(items.filter((item) => item.kind === 'request').length, 0);
}));
test('opting out after enqueue suppresses every device', () => fixture(async () => {
  await request();
  await db.query('update public.user_preferences set notifications_enabled=false where user_id=$1', [B]);
  assert.equal((await claim()).length, 0);
  const { rows } = await db.query("select count(*)::integer as total from public.push_deliveries where status='suppressed'");
  assert.equal(rows[0].total, 2);
}));
test('blocks in either direction suppress notifications', () => fixture(async () => {
  await request();
  await db.query('insert into public.user_blocks(blocked_by,blocked_user) values ($1,$2)', [A, B]);
  assert.equal((await claim()).length, 0);
}));
test('logout deletes registered devices through Auth session cascades', () => fixture(async () => {
  await request();
  await db.query('delete from auth.sessions where id=$1', [SB]);
  assert.equal((await claim()).length, 0);
  assert.equal((await db.query('select count(*)::integer as total from public.push_devices where user_id=$1', [B])).rows[0].total, 0);
}));
test('expired sessions suppress delivery even before session cleanup', () => fixture(async () => {
  await request();
  await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [SB]);
  assert.equal((await claim()).length, 0);
}));
test('account switching cannot deliver the previous account queue', () => fixture(async () => {
  await request();
  await register(C, SC, IB, 'ExpoPushToken[b-one]');
  const items = await claim();
  assert.equal(items.length, 1);
  assert.equal(items[0].token, 'ExpoPushToken[b-two]');
}));
test('delivery eligibility is rechecked after a worker claims it', () => fixture(async () => {
  await request();
  const [item] = await claim();
  await db.query('insert into public.user_blocks(blocked_by,blocked_user) values ($1,$2)', [B, A]);
  const { rows } = await db.query('select public.push_delivery_still_allowed($1,$2) as allowed', [item.id, item.lease_token]);
  assert.equal(rows[0].allowed, false);
}));
test('lease recovery rejects acknowledgments from an old worker', () => fixture(async () => {
  await request();
  const [old] = await claim();
  await db.query("update public.push_deliveries set locked_until=now()-interval '1 second' where id=$1", [old.id]);
  const [current] = await claim();
  assert.notEqual(current.lease_token, old.lease_token);
  assert.equal(await finish(old, 'ticketed', 'stale'), false);
  assert.equal(await finish(current, 'ticketed', 'current'), true);
}));
test('transient failures back off and stop after eight attempts', () => fixture(async () => {
  await request();
  const [item] = await claim();
  assert.equal(await finish(item, 'retry'), true);
  assert.equal((await claim()).length, 0);
  await db.query("update public.push_deliveries set attempts=7,next_attempt_at=now()-interval '1 second' where id=$1", [item.id]);
  const [last] = await claim();
  assert.equal(last.attempts, 8);
  await finish(last, 'retry');
  assert.equal((await db.query('select status from public.push_deliveries where id=$1', [item.id])).rows[0].status, 'failed');
}));
test('receipt invalidation never disables a newly rotated token', () => fixture(async () => {
  await request();
  const [item] = await claim();
  await finish(item, 'ticketed', 'expo-ticket');
  await register(B, SB, item.token === 'ExpoPushToken[b-one]' ? IB : IB2, 'ExpoPushToken[rotated]');
  await db.query("update public.push_deliveries set next_attempt_at=now()-interval '1 second' where id=$1", [item.id]);
  const receipt = (await db.query('select * from public.claim_push_receipts()')).rows[0];
  await finish(receipt, 'invalid');
  const { rows } = await db.query('select enabled from public.push_devices where id=(select device_id from public.push_deliveries where id=$1)', [item.id]);
  assert.equal(rows[0].enabled, true);
}));
test('invalid current tokens are disabled and old queue entries expire', () => fixture(async () => {
  await request();
  const [item] = await claim();
  await finish(item, 'invalid');
  const { rows } = await db.query('select enabled from public.push_devices where id=(select device_id from public.push_deliveries where id=$1)', [item.id]);
  assert.equal(rows[0].enabled, false);
  await db.exec("update public.notification_outbox set created_at=now()-interval '2 hours'");
  assert.equal((await claim()).length, 0);
}));
