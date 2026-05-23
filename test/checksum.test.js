import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../lib/checksum.js';

test('returns sha256: prefix', () => {
  const result = sha256('hello');
  assert.ok(result.startsWith('sha256:'));
});

test('hex part is 64 characters', () => {
  const result = sha256('hello');
  const hex = result.slice('sha256:'.length);
  assert.equal(hex.length, 64);
  assert.match(hex, /^[0-9a-f]{64}$/);
});

test('known hash for empty string', () => {
  // sha256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  const result = sha256('');
  assert.equal(result, 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('same input yields same hash', () => {
  assert.equal(sha256('abc'), sha256('abc'));
});

test('different inputs yield different hashes', () => {
  assert.notEqual(sha256('abc'), sha256('def'));
});
