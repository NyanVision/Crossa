import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseProblems, checkTrackedReleaseFiles } from '../scripts/check-release.mjs';
import { privacyPolicySections } from '../src/content/privacyPolicy.ts';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const configured = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://hzqzpvaisxnyixqtzets.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_aValidTestFixtureKey123',
  EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL: 'privacy@crossa.app',
  EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://crossa.app/privacy',
  CROSSA_RELEASE_DEVICE_CHECKS: 'confirmed',
};
test('production preflight identifies missing details without exposing their values', () => {
  assert.equal(releaseProblems({}).length, 5);
  assert.deepEqual(releaseProblems(configured), []);
  const problems = releaseProblems({ ...configured, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never-print-this' });
  assert.equal(problems.length, 1); assert.ok(!problems.join(' ').includes('never-print-this'));
});
test('production preflight rejects placeholders, non-public policy links, and unconfirmed device checks', () => {
  for (const policy of ['http://crossa.test/privacy', 'https://localhost/privacy', 'https://127.0.0.1/privacy', 'https://user:pass@crossa.test/privacy', 'https://example.com/privacy']) {
    assert.ok(releaseProblems({ ...configured, EXPO_PUBLIC_PRIVACY_POLICY_URL: policy }).length > 0);
  }
  assert.ok(releaseProblems({ ...configured, EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL: 'privacy@example.com' }).length > 0);
  assert.ok(releaseProblems({ ...configured, CROSSA_RELEASE_DEVICE_CHECKS: '' }).length > 0);
});
test('production configuration preserves app identity and does not use debug signing or microphone access', () => {
  assert.deepEqual(checkTrackedReleaseFiles(), []);
});
test('the policy describes actual data practices without inventing a support contact', () => {
  const sections = privacyPolicySections();
  assert.ok(!sections.some((section) => section.title === 'Privacy contact'));
  const text = sections.flatMap((section) => section.paragraphs).join(' ');
  assert.ok(text.includes('does not provide end-to-end encryption'));
  assert.ok(text.includes('foreground location'));
  assert.ok(text.includes('private location table'));
  assert.ok(text.includes('different retention period'));
  const contact = privacyPolicySections('privacy@crossa.test').at(-1);
  assert.equal(contact.title, 'Privacy contact'); assert.ok(contact.paragraphs[0].includes('privacy@crossa.test'));
});
test('public policy export requires an operator contact and escapes HTML', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'crossa-policy-test-'));
  const script = fileURLToPath(new URL('../scripts/export-privacy.mjs', import.meta.url));
  const output = join(temporary, 'privacy.html');
  try {
    const missing = spawnSync(process.execPath, [script, '--output', output], { cwd: temporary, env: { ...process.env, EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL: '' }, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    const exported = spawnSync(process.execPath, [script, '--output', output], { cwd: temporary, env: { ...process.env, EXPO_PUBLIC_PRIVACY_CONTACT_EMAIL: 'privacy+ops&team@crossa.app' }, encoding: 'utf8' });
    assert.equal(exported.status, 0, exported.stderr);
    const html = readFileSync(output, 'utf8');
    assert.ok(html.includes('privacy+ops&amp;team@crossa.app'));
    assert.ok(html.includes('does not provide end-to-end encryption'));
    assert.ok(!html.includes('placeholder policy'));
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
