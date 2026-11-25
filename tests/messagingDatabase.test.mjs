import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { URL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';
const R = 'd0000000-0000-4000-8000-000000000004';
const messageId = (i) => 'e0000000-0000-4000-8000-' + String(i).padStart(12, '0');
before(async () => {
  await db.exec(await readFile(new URL('./fixtures/supabase.sql', import.meta.url), 'utf8'));
  const folder = new URL('../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(folder)).filter((name) => name.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, folder), 'utf8'));
  // Vault itself is Supabase-owned; this fixture exercises the real verification RPC.
  await db.exec('create schema vault; create table vault.decrypted_secrets(name text,decrypted_secret text)');
});
after(() => db.close());
async function admin() { await db.exec("reset role; select set_config('request.jwt.claim.sub','',true)"); }
async function user(id) { await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]); await db.exec('set local role authenticated'); }
async function denied(run, pattern = /permission denied|unavailable|required|Sign in/) {
  await db.exec('savepoint denied_action');
  try { await assert.rejects(run, pattern); } finally { await db.exec('rollback to savepoint denied_action'); }
}
async function fixture(run) {
  await db.exec('begin');
  try {
    await db.query('insert into auth.users(id) values ($1),($2),($3)', [A, B, C]);
    await db.query("update public.profiles set display_name=case id when $1 then 'Alice' when $2 then 'Ben' else 'Casey' end", [A, B]);
    await db.query("insert into public.connection_requests(id,sender_id,recipient_id,status) values ($1,$2,$3,'accepted')", [R, A, B]);
    await run();
  } finally { await db.exec('rollback'); }
}
async function seedMessages(count) {
  for (let i = 1; i <= count; i++) await db.query("insert into public.messages(id,request_id,sender_id,body,created_at) values ($1,$2,$3,$4,'2026-11-01T12:00:00Z')", [messageId(i), R, A, `Message ${i}`]);
}

test('keyset history includes every message when timestamps are identical', () => fixture(async () => {
  await seedMessages(125); await user(A);
  let before = null, beforeId = null; const ids = [];
  while (true) {
    const { rows } = await db.query('select * from public.conversation_messages($1,$2,$3,$4,$5)', [R, before, beforeId, '', 40]);
    if (!rows.length) break;
    ids.push(...rows.map((row) => row.id)); before = rows.at(-1).created_at; beforeId = rows.at(-1).id;
  }
  assert.equal(ids.length, 125); assert.equal(new Set(ids).size, 125);
  assert.equal(ids[0], messageId(125)); assert.equal(ids.at(-1), messageId(1));
}));
test('reconnect catch-up pages do not skip a backlog larger than one page', () => fixture(async () => {
  await seedMessages(225); await user(B);
  let after = '2026-11-01T12:00:00Z', afterId = messageId(1); const ids = [];
  while (true) {
    const { rows } = await db.query('select * from public.conversation_messages_after($1,$2,$3,$4)', [R, after, afterId, 100]);
    if (!rows.length) break;
    ids.push(...rows.map((row) => row.id)); after = rows.at(-1).created_at; afterId = rows.at(-1).id;
  }
  assert.equal(ids.length, 224); assert.equal(new Set(ids).size, 224); assert.equal(ids.at(-1), messageId(225));
}));
test('chat search is case insensitive and treats wildcard characters literally', () => fixture(async () => {
  await db.query('insert into public.messages(request_id,sender_id,body) values ($1,$2,$3),($1,$2,$4)', [R, A, '100% Reliable', 'reliable']); await user(B);
  assert.equal((await db.query('select * from public.conversation_messages($1,null,null,$2)', [R, 'RELIABLE'])).rows.length, 2);
  assert.equal((await db.query('select * from public.conversation_messages($1,null,null,$2)', [R, '%'])).rows.length, 1);
}));
test('retrying a send with its original client ID creates exactly one message', () => fixture(async () => {
  await user(A);
  for (let i = 0; i < 3; i++) {
    const { rows } = await db.query('select * from public.send_chat_message($1,$2,$3)', [R, 'Hello', messageId(1)]);
    assert.equal(rows[0].id, messageId(1));
  }
  assert.equal((await db.query('select count(*)::integer as total from public.messages')).rows[0].total, 1);
  await user(B);
  await denied(() => db.query('select * from public.send_chat_message($1,$2,$3)', [R, 'Spoof', messageId(1)]), /could not be sent/);
}));
test('message limits also apply to direct table inserts and cannot be bypassed by backdating', () => fixture(async () => {
  await user(A);
  for (let i = 1; i <= 30; i++) await db.query("insert into public.messages(id,request_id,sender_id,body,created_at) values($1,$2,$3,'Hi','2000-01-01')", [messageId(i), R, A]);
  await denied(() => db.query("insert into public.messages(request_id,sender_id,body) values($1,$2,'Too many')", [R, A]), /too quickly/);
  assert.equal((await db.query("select count(*)::integer as total from public.messages where created_at>now()-interval '1 minute'")).rows[0].total, 30);
}));
test('only accepted unblocked participants can read history, receipts, or typing state', () => fixture(async () => {
  await user(C);
  await denied(() => db.query('select * from public.conversation_state($1)', [R]));
  await denied(() => db.query('select * from public.conversation_messages($1)', [R]));
  await denied(() => db.query('select public.set_conversation_typing($1,true)', [R]));
  await admin(); await db.query('insert into public.user_blocks(blocked_by,blocked_user) values($1,$2)', [B, A]);
  await user(A); await denied(() => db.query('select * from public.conversation_state($1)', [R]));
  assert.equal((await db.query('select * from public.conversation_activity')).rows.length, 0);
}));
test('read receipts change only the caller timestamp, and typing expires server-side', () => fixture(async () => {
  await user(A); await db.query('select public.mark_conversation_read($1)', [R]);
  let row = (await db.query('select sender_read_at,recipient_read_at from public.connection_requests where id=$1', [R])).rows[0];
  assert.ok(row.sender_read_at); assert.equal(row.recipient_read_at, null);
  await db.query('select public.set_conversation_typing($1,true)', [R]);
  await user(B);
  const state = (await db.query('select * from public.conversation_state($1)', [R])).rows[0];
  assert.ok(state.peer_read_at); assert.ok(state.typing_until);
  assert.equal((await db.query("select typing_until<=now()+interval '8 seconds' as bounded from public.conversation_activity where user_id=$1", [A])).rows[0].bounded, true);
  await denied(() => db.query("update public.conversation_activity set typing_until=now()+interval '1 day'"));
  await user(A); await db.query('select public.set_conversation_typing($1,false)', [R]);
  await user(B); assert.equal((await db.query('select typing_until<=now() as stopped from public.conversation_state($1)', [R])).rows[0].stopped, true);
}));
test('only the sender can cancel a pending request and cancellation has a cooldown', () => fixture(async () => {
  await db.query("update public.connection_requests set status='pending' where id=$1", [R]);
  await user(B); assert.equal((await db.query('select public.cancel_connection_request($1) as cancelled', [R])).rows[0].cancelled, false);
  await user(A); assert.equal((await db.query('select public.cancel_connection_request($1) as cancelled', [R])).rows[0].cancelled, true);
  assert.equal((await db.query('select * from public.my_sent_requests()')).rows[0].status, 'cancelled');
  await denied(() => db.query('select public.send_connection_request($1)', [B]), /cooldown/);
  await user(B); assert.equal((await db.query('select public.respond_to_connection_request($1,true) as accepted', [R])).rows[0].accepted, false);
  await admin(); await db.query("update public.connection_requests set responded_at=now()-interval '6 minutes' where id=$1", [R]);
  await user(A); assert.equal((await db.query('select public.send_connection_request($1) as sent', [B])).rows[0].sent, true);
}));
test('a declined request cannot be resent for 24 hours', () => fixture(async () => {
  await db.query("update public.connection_requests set status='declined',responded_at=now() where id=$1", [R]);
  await user(A); await denied(() => db.query('select public.send_connection_request($1)', [B]), /24-hour cooldown/);
  await admin(); await db.query("update public.connection_requests set responded_at=now()-interval '25 hours' where id=$1", [R]);
  await user(A); assert.equal((await db.query('select public.send_connection_request($1) as sent', [B])).rows[0].sent, true);
}));
test('request rate limits are enforced on the server', () => fixture(async () => {
  await db.query("update public.connection_requests set created_at=now()-interval '2 days' where id=$1", [R]);
  const targets = Array.from({ length: 11 }, (_, i) => 'f0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
  for (const id of targets) await db.query('insert into auth.users(id) values($1)', [id]);
  await user(A);
  for (const id of targets.slice(0, 10)) assert.equal((await db.query('select public.send_connection_request($1) as sent', [id])).rows[0].sent, true);
  await denied(() => db.query('select public.send_connection_request($1)', [targets[10]]), /too many requests/);
}));
test('reports retain category/details, deduplicate, and reject direct inserts', () => fixture(async () => {
  await user(A);
  const report = () => db.query('select public.submit_profile_report($1,$2,$3) as id', [B, 'harassment', 'Unwanted repeated contact']);
  const first = (await report()).rows[0].id; assert.equal((await report()).rows[0].id, first);
  const saved = (await db.query('select id,category,details from public.profile_reports')).rows[0];
  assert.equal(saved.category, 'harassment'); assert.equal(saved.details, 'Unwanted repeated contact');
  await denied(() => db.query('insert into public.profile_reports(reporter_id,reported_user,reason) values($1,$2,$3)', [A, B, 'spam']));
  await denied(() => db.query('select public.submit_profile_report($1,$2,$3)', [B, 'bad_category', '']), /category/);
  await denied(() => db.query('select moderator_note from public.profile_reports'));
  await user(C); assert.equal((await db.query('select id from public.profile_reports')).rows.length, 0);
}));
test('the daily request limit remains effective after the minute window has passed', () => fixture(async () => {
  await db.query("update public.connection_requests set created_at=now()-interval '2 days' where id=$1", [R]);
  await db.query("insert into public.connection_requests(sender_id,recipient_id,status,created_at,responded_at) select $1,$2,'declined',now()-interval '10 minutes',now()-interval '25 hours' from generate_series(1,50)", [A, B]);
  await user(A);
  await denied(() => db.query('select public.send_connection_request($1)', [C]), /too many requests/);
}));
test('the hourly message limit remains effective after the minute window has passed', () => fixture(async () => {
  await db.query("insert into public.messages(request_id,sender_id,body,created_at) select $1,$2,'Earlier message',now()-interval '10 minutes' from generate_series(1,500)", [R, A]);
  await user(A);
  await denied(() => db.query('select * from public.send_chat_message($1,$2,$3)', [R, 'New message', messageId(1001)]), /too quickly/);
}));
test('report throttling applies through both the new and legacy endpoints', () => fixture(async () => {
  await user(A);
  for (const category of ['spam', 'harassment', 'inappropriate', 'impersonation', 'safety']) await db.query('select public.submit_profile_report($1,$2)', [B, category]);
  await denied(() => db.query('select public.report_profile($1)', [B]), /several reports/);
}));
test('user-editable metadata cannot grant moderator access; assigned moderators can review reports', () => fixture(async () => {
  await db.query('update auth.users set raw_user_meta_data=$2::jsonb where id=$1', [A, JSON.stringify({ role: 'admin', moderator: true })]);
  await user(A); assert.equal((await db.query('select public.is_crossa_moderator() as allowed')).rows[0].allowed, false);
  const id = (await db.query('select public.submit_profile_report($1,$2) as id', [B, 'safety'])).rows[0].id;
  await denied(() => db.query('select * from public.moderation_reports()'), /Moderator access/);
  await denied(() => db.query('insert into private.moderators(user_id) values($1)', [A]));
  await admin(); await db.query('insert into private.moderators(user_id) values($1)', [C]); await user(C);
  assert.equal((await db.query('select * from public.moderation_reports()')).rows.length, 1);
  assert.equal((await db.query('select public.review_profile_report($1,$2,$3) as reviewed', [id, 'resolved', 'Reviewed by staff'])).rows[0].reviewed, true);
  const row = (await db.query("select * from public.moderation_reports('resolved')")).rows[0];
  assert.equal(row.status, 'resolved'); assert.equal(row.moderator_note, 'Reviewed by staff');
  await denied(() => db.query('select * from private.moderators'));
}));
test('scheduler setup and worker secret verification are unavailable to client roles', () => fixture(async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const name of ['public.configure_crossa_push(text)', 'public.verify_crossa_push_secret(text)']) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'execute') as allowed", [role, name])).rows[0].allowed, false);
    }
  }
}));
test('the worker verification RPC accepts only the configured Vault credential', () => fixture(async () => {
  const secret = 'a'.repeat(64);
  await db.query('insert into vault.decrypted_secrets(name,decrypted_secret) values($1,$2)', ['crossa_push_worker', secret]);
  await db.exec('set local role service_role');
  const check = async (value) => (await db.query('select public.verify_crossa_push_secret($1) as allowed', [value])).rows[0].allowed;
  assert.equal(await check(secret), true);
  assert.equal(await check('b'.repeat(64)), false);
  assert.equal(await check(''), false);
}));
