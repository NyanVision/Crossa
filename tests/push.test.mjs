import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { constantTimeEqual, expoOutcome, pushPayload, sessionIdFromVerifiedJwt } from '../supabase/functions/_shared/push.ts';
import { notificationRequestId } from '../src/services/notificationLinks.ts';

const recipient = 'a0000000-0000-4000-8000-000000000001';
const request = 'b0000000-0000-4000-8000-000000000002';

test('missing or malformed tickets retry instead of silently losing a notification', () => {
  assert.equal(expoOutcome(undefined), 'retry');
  assert.equal(expoOutcome({ status: 'ok' }), 'retry');
  assert.equal(expoOutcome({ status: 'ok', id: 'ticket' }), 'ticketed');
});
test('receipts handle invalid tokens, transient failures, and the receipt retention window', () => {
  assert.equal(expoOutcome({ status: 'error', details: { error: 'DeviceNotRegistered' } }, true), 'invalid');
  assert.equal(expoOutcome({ status: 'error', details: { error: 'MessageRateExceeded' } }), 'retry');
  assert.equal(expoOutcome({ status: 'error', details: { error: 'MessageTooBig' } }), 'failed');
  assert.equal(expoOutcome({ status: 'ok' }, true), 'delivered');
  assert.equal(expoOutcome(undefined, true, false), 'ticketed');
  assert.equal(expoOutcome({}, true, false), 'ticketed');
  assert.equal(expoOutcome(undefined, true, true), 'unknown');
});
test('worker authentication rejects prefixes, suffixes and wrong secrets', () => {
  const secret = 's'.repeat(64);
  assert.equal(constantTimeEqual(secret, secret), true);
  for (const value of ['', secret.slice(1), secret + 'x', 'x' + secret.slice(1)]) assert.equal(constantTimeEqual(secret, value), false);
});
test('verified JWT session IDs must be UUIDs', () => {
  const token = (claims) => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
  assert.equal(sessionIdFromVerifiedJwt(token({ session_id: recipient })), recipient);
  assert.equal(sessionIdFromVerifiedJwt(token({ session_id: 'wrong' })), null);
  assert.equal(sessionIdFromVerifiedJwt('malformed'), null);
});
test('push payloads contain no profile names, message bodies or coordinates', () => {
  const payload = pushPayload({ token: 'ExpoPushToken[test]', recipient_id: recipient, request_id: request, kind: 'message' });
  assert.equal(payload.body, 'You have a new message.');
  assert.deepEqual(payload.data, { kind: 'message', requestId: request, recipientId: recipient });
});
test('notification taps cannot open another account or an arbitrary destination', () => {
  const valid = { kind: 'message', requestId: request, recipientId: recipient };
  assert.equal(notificationRequestId(valid, recipient), request);
  assert.equal(notificationRequestId(valid, request), null);
  assert.equal(notificationRequestId({ ...valid, requestId: 'https://evil.test' }, recipient), null);
  assert.equal(notificationRequestId({ ...valid, kind: 'unknown' }, recipient), null);
});
