import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectRules } from '../lib/rules-loader.js';
import { STACK_FLAGS } from '../lib/stack-filter.js';

/**
 * Builds a throwaway package root whose rules/ tree covers every case the gate
 * has to decide: an ungated group, two flag-named groups, an unknown group, and
 * a file sitting directly in rules/.
 */
function makePkgRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rules-gating-'));
  const rules = join(root, 'rules');
  for (const group of ['common', 'kotlin', 'kmp', 'nested']) {
    mkdirSync(join(rules, group), { recursive: true });
    writeFileSync(join(rules, group, 'a.md'), `# ${group}\n`, 'utf8');
  }
  mkdirSync(join(rules, 'kmp', 'deep'), { recursive: true });
  writeFileSync(join(rules, 'kmp', 'deep', 'b.md'), '# deep\n', 'utf8');
  writeFileSync(join(rules, 'root-level.md'), '# root\n', 'utf8');
  return root;
}

const ids = (root, flags) => collectRules(root, flags).map((r) => r.id);

test('ungated groups are always collected', () => {
  const root = makePkgRoot();
  const result = ids(root, {});
  assert.ok(result.includes('common/a'), 'common/ is not a stack flag → always active');
  assert.ok(result.includes('nested/a'), 'unknown group names are not gated');
  assert.ok(result.includes('root-level'), 'files directly under rules/ are collected');
});

test('a flag-named group is skipped when its flag is off', () => {
  const root = makePkgRoot();
  const result = ids(root, { kotlin: false, kmp: false });
  assert.ok(!result.includes('kotlin/a'));
  assert.ok(!result.includes('kmp/a'));
});

test('a flag-named group is collected when its flag is on', () => {
  const root = makePkgRoot();
  const result = ids(root, { kotlin: true, kmp: true });
  assert.ok(result.includes('kotlin/a'));
  assert.ok(result.includes('kmp/a'));
});

test('flags are independent — kotlin on does not enable kmp', () => {
  const root = makePkgRoot();
  const result = ids(root, { kotlin: true, kmp: false });
  assert.ok(result.includes('kotlin/a'));
  assert.ok(!result.includes('kmp/a'));
});

test('subdirectories of an active group are still walked recursively', () => {
  const root = makePkgRoot();
  assert.ok(ids(root, { kmp: true }).includes('kmp/deep/b'));
});

test('gating fails closed when no flags are passed', () => {
  const root = makePkgRoot();
  const result = ids(root, undefined);
  assert.ok(result.includes('common/a'), 'ungated groups still ship');
  assert.ok(!result.includes('kotlin/a'), 'no flags means no flag-named group');
  assert.ok(!result.includes('kmp/a'));
});

test('kmp is a known stack flag', () => {
  assert.ok(STACK_FLAGS.includes('kmp'));
});

test('missing rules dir returns an empty list', () => {
  const empty = mkdtempSync(join(tmpdir(), 'rules-gating-empty-'));
  assert.deepEqual(collectRules(empty, { kmp: true }), []);
});
