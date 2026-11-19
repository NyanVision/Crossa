import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers';
import { createAuthLinkHandler, parseAuthLink, passwordValidationError } from '../src/services/authLinks.ts';

const callbackUrl = 'catchya://auth/callback';
const recoveryUrl = 'catchya://auth/reset-password';
const parse = (url) => parseAuthLink(url, callbackUrl, recoveryUrl);

test('PKCE recovery is identified by its destination even without a type query', () => {
  assert.deepEqual(parse(recoveryUrl + '?code=one-use&sb_flow_id=flow'), {
    code: 'one-use', flowId: 'flow', tokens: null, recovery: true,
  });
  assert.equal(parse(callbackUrl + '?code=oauth').recovery, false);
  assert.equal(parse(callbackUrl + '?code=recovery&type=recovery').recovery, true);
});
test('only exact app auth destinations are accepted', () => {
  for (const value of ['https://evil.test/auth/callback?code=x', 'catchya://auth/callback/evil?code=x',
    'other://auth/callback?code=x', 'catchya://user:pass@auth/callback?code=x', 'not a url']) assert.equal(parse(value), null);
  assert.equal(parse('catchya://profile/123'), null);
});
test('legacy recovery fragments require a complete token pair', () => {
  assert.deepEqual(parse(callbackUrl + '#type=recovery&access_token=a&refresh_token=r').tokens, { access_token: 'a', refresh_token: 'r' });
  assert.throws(() => parse(recoveryUrl + '#access_token=a'), /incomplete/);
  assert.throws(() => parse(recoveryUrl + '#error=access_denied&error_description=Link+expired'), /Link expired/);
});
test('cold and warm callbacks share a single exchange, including reordered parameters', async () => {
  let exchanges = 0;
  const sessions = [];
  const handler = createAuthLinkHandler({
    callbackUrl, recoveryUrl,
    exchangeCode: async () => { exchanges++; await new Promise((resolve) => setTimeout(resolve, 5)); return 'session'; },
    setTokens: async () => { throw new Error('Unexpected tokens'); },
    onSession: async (session, recovery) => { sessions.push({ session, recovery }); },
  });
  await Promise.all([handler(recoveryUrl + '?code=x&sb_flow_id=f'), handler(recoveryUrl + '?sb_flow_id=f&code=x')]);
  assert.equal(exchanges, 1);
  assert.deepEqual(sessions, [{ session: 'session', recovery: true }]);
  await handler(recoveryUrl + '?code=x&sb_flow_id=f');
  assert.equal(exchanges, 1);
});
test('an expired or failed exchange never enters password recovery and remains retryable', async () => {
  let exchanges = 0, transitions = 0;
  const handler = createAuthLinkHandler({
    callbackUrl, recoveryUrl,
    exchangeCode: async () => { if (++exchanges === 1) throw new Error('Offline'); return 'verified'; },
    setTokens: async () => 'unused',
    onSession: async () => { transitions++; },
  });
  await assert.rejects(handler(recoveryUrl + '?code=x'), /Offline/);
  assert.equal(transitions, 0);
  await handler(recoveryUrl + '?code=x');
  assert.equal(transitions, 1);
});
test('a profile lookup failure retries without consuming its PKCE code twice', async () => {
  let exchanges = 0, transitions = 0;
  const handler = createAuthLinkHandler({
    callbackUrl, recoveryUrl,
    exchangeCode: async () => { exchanges++; return 'verified'; },
    setTokens: async () => 'unused',
    onSession: async () => { if (++transitions === 1) throw new Error('Database offline'); },
  });
  await assert.rejects(handler(callbackUrl + '?code=x'));
  await handler(callbackUrl + '?code=x');
  assert.equal(exchanges, 1);
  assert.equal(transitions, 2);
});
test('password confirmation preserves spaces and rejects short or mismatched values', () => {
  assert.match(passwordValidationError('short', 'short'), /8 characters/);
  assert.match(passwordValidationError('password ', 'password'), /match/);
  assert.equal(passwordValidationError('password ', 'password '), null);
});
