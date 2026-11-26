import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessages } from '../src/services/messageState.ts';
import { authorizePushWorker } from '../supabase/functions/_shared/push.ts';

test('HTTP success, retried sends, and out-of-order Realtime events converge without duplicate bubbles', () => {
  const first = { id: 'a', text: 'First', from: 'me', createdAt: '2026-11-01T12:00:00Z' };
  const second = { id: 'b', text: 'Second', from: 'them', createdAt: '2026-11-01T12:00:01Z' };
  let messages = mergeMessages([], [second]);
  messages = mergeMessages(messages, [first]);
  messages = mergeMessages(messages, [first, second, first]);
  assert.deepEqual(messages, [first, second]);
  assert.deepEqual(mergeMessages([first], [first]), [first]);
});
test('push worker accepts Vault credentials without an environment secret and rejects bad credentials', async () => {
  const secret = 'a'.repeat(64); let calls = 0;
  const check = async (input) => { calls++; return input === secret; };
  assert.equal(await authorizePushWorker(secret, undefined, check), true);
  assert.equal(await authorizePushWorker('b'.repeat(64), undefined, check), false);
  const count = calls;
  assert.equal(await authorizePushWorker('', undefined, check), false);
  assert.equal(await authorizePushWorker('x'.repeat(300), undefined, check), false);
  assert.equal(calls, count);
  assert.equal(await authorizePushWorker(secret, secret, check), true);
  assert.equal(calls, count);
});
test('messages keep timestamp order across UTC formats and sub-millisecond differences', () => {
  const messages = [
    { id: 'a', from: 'me', text: 'Third', createdAt: '2026-11-01T12:00:00.123456+00:00' },
    { id: 'z', from: 'them', text: 'Second', createdAt: '2026-11-01T12:00:00.123455Z' },
    { id: 'c', from: 'me', text: 'First', createdAt: '2026-11-01T12:00:00Z' },
  ];
  assert.deepEqual(mergeMessages([], messages).map((message) => message.text), ['First', 'Second', 'Third']);
});
