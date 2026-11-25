import test from 'node:test';
import assert from 'node:assert/strict';
import { profilePhotoPayload } from '../src/services/profilePhotoPayload.ts';

test('iOS text/plain photo becomes raw JPEG bytes instead of a text FormData part', () => {
  const photo = profilePhotoPayload('data:text/plain;base64,/9j/AA==', 'file:///photo.jpg');
  assert.ok(photo.body instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(photo.body)], [255, 216, 255, 0]);
  assert.equal(photo.contentType, 'image/jpeg');
  assert.equal(photo.extension, 'jpg');
});
test('PNG and WebP keep matching MIME types and file extensions', () => {
  for (const [mime, extension] of [['image/png', 'png'], ['image/webp', 'webp']]) {
    const photo = profilePhotoPayload(`data:${mime};base64,AAE=`, 'file:///unknown');
    assert.equal(photo.contentType, mime);
    assert.equal(photo.extension, extension);
    assert.deepEqual([...new Uint8Array(photo.body)], [0, 1]);
  }
});
test('untyped camera files use their extension and invalid images fail before upload', () => {
  assert.equal(profilePhotoPayload('data:;base64,AA==', 'file:///camera.JPEG?x=1').contentType, 'image/jpeg');
  assert.throws(() => profilePhotoPayload('invalid', 'file:///photo.jpg'), /could not be read/);
  assert.throws(() => profilePhotoPayload('data:text/plain;base64,AA==', 'file:///photo.txt'), /Choose a JPEG/);
  assert.throws(() => profilePhotoPayload('data:image/jpeg;base64,', 'file:///photo.jpg'), /empty/);
});
