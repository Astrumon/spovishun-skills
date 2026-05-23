import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterByStack } from '../lib/stack-filter.js';

function artifact(id, requires) {
  return { id, manifest: requires ? { requires } : {} };
}

const allFlags = { kotlin: true, postgres: true, telegram: true, notion: true };
const noFlags = { kotlin: false, postgres: false, telegram: false, notion: false };

test('universal artifact (no requires) always passes', () => {
  const result = filterByStack([artifact('a')], noFlags);
  assert.equal(result.length, 1);
});

test('stack-specific artifact passes when all flags satisfied', () => {
  const result = filterByStack([artifact('a', ['notion'])], allFlags);
  assert.equal(result.length, 1);
});

test('stack-specific artifact filtered out when flag is false', () => {
  const result = filterByStack([artifact('a', ['notion'])], noFlags);
  assert.equal(result.length, 0);
});

test('multi-flag requires: all must be true to pass', () => {
  const flags = { kotlin: true, postgres: false, telegram: false, notion: true };
  const result = filterByStack([artifact('a', ['kotlin', 'notion'])], flags);
  assert.equal(result.length, 1);

  const result2 = filterByStack([artifact('a', ['kotlin', 'postgres'])], flags);
  assert.equal(result2.length, 0);
});

test('empty requires array treated same as no requires', () => {
  const result = filterByStack([artifact('a', [])], noFlags);
  assert.equal(result.length, 1);
});

test('mixed list of artifacts filtered correctly', () => {
  const artifacts = [
    artifact('universal'),
    artifact('kotlin-only', ['kotlin']),
    artifact('notion-only', ['notion']),
    artifact('both', ['kotlin', 'notion']),
  ];
  const flags = { kotlin: true, postgres: false, telegram: false, notion: false };
  const result = filterByStack(artifacts, flags);
  const ids = result.map((a) => a.id);
  assert.deepEqual(ids, ['universal', 'kotlin-only']);
});

test('returns empty array when all filtered out', () => {
  const result = filterByStack([artifact('a', ['kotlin'])], noFlags);
  assert.equal(result.length, 0);
});

test('returns empty array given empty input', () => {
  const result = filterByStack([], allFlags);
  assert.equal(result.length, 0);
});
