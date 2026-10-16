import test from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseConfigurationError } from '../src/services/supabaseConfig.ts';
import { checkAccountActive, toAuthMessage } from '../src/services/authErrors.ts';

const key = 'sb_publishable_example-for-unit-test';
test('missing and placeholder settings do not enable authentication', () => {
  assert.match(getSupabaseConfigurationError('', ''), /missing/);
  assert.match(getSupabaseConfigurationError('https://YOUR_PROJECT_REF.supabase.co', key), /placeholders/);
  assert.match(getSupabaseConfigurationError('https://example.supabase.co', 'sb_publishable_REPLACE_ME'), /placeholders/);
});
test('project URL and public key validation', () => {
  for (const url of ['not-a-url', 'http://example.supabase.co', 'https://example.supabase.co/auth/v1', 'https://user:password@example.supabase.co']) {
    assert.ok(getSupabaseConfigurationError(url, key));
  }
  for (const secret of ['sb_secret_test', 'service_role', 'sb_publishable_']) {
    assert.ok(getSupabaseConfigurationError('https://example.supabase.co', secret));
  }
  assert.equal(getSupabaseConfigurationError('https://example.supabase.co', key), null);
});
test('account status fails closed without treating an outage as deactivation', () => {
  assert.equal(checkAccountActive({data: true, error: null}), true);
  assert.equal(checkAccountActive({data: false, error: null}), false);
  const outage = {message: 'Network request failed'};
  assert.throws(() => checkAccountActive({data: null, error: outage}), error => error === outage);
  assert.throws(() => checkAccountActive({data: null, error: null}), /account status/);
});
test('plain-object backend errors are not hidden behind incorrect credential messages', () => {
  assert.equal(toAuthMessage({message: 'Network request failed'}, 'Wrong password'), 'Network request failed');
  assert.match(toAuthMessage({code: 'PGRST202', message: 'Missing RPC'}, 'Wrong password'), /account service/);
  assert.equal(toAuthMessage(new Error('Invalid login credentials'), 'fallback'), 'Invalid login credentials');
  assert.equal(toAuthMessage(null, 'fallback'), 'fallback');
});
