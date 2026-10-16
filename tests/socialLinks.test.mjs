import test from 'node:test';
import assert from 'node:assert/strict';
import { socialProfileUrl } from '../src/services/socialLinks.ts';

test('opens the intended Facebook profile from common pasted links', () => {
  assert.equal(socialProfileUrl('facebook', 'facebook.com/example.user'), 'https://www.facebook.com/example.user');
  assert.equal(socialProfileUrl('facebook', 'https://m.facebook.com/profile.php?id=123456789&ref=share'), 'https://www.facebook.com/profile.php?id=123456789');
});
test('normalizes social handles and legacy X links', () => {
  assert.equal(socialProfileUrl('instagram', '@example'), 'https://instagram.com/example');
  assert.equal(socialProfileUrl('telegram', '@example'), 'https://t.me/example');
  assert.equal(socialProfileUrl('tiktok', '@example'), 'https://www.tiktok.com/@example');
  assert.equal(socialProfileUrl('x', 'https://twitter.com/example'), 'https://x.com/example');
});
test('rejects unsafe destinations and non-profile Facebook paths', () => {
  for (const value of ['javascript:alert(1)', 'https://facebook.com.evil.test/example', 'https://evil.test/example', 'https://user:pass@facebook.com/example', 'https://facebook.com/groups', 'https://facebook.com/profile.php/extra?id=123456789']) {
    assert.equal(socialProfileUrl('facebook', value), null);
  }
});
