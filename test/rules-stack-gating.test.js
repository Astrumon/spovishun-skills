import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { collectRules } from '../lib/rules-loader.js';
import { STACK_FLAGS } from '../lib/stack-filter.js';
import { CHAR_LIMIT } from '../adapters/windsurf/index.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

// The tests above use a synthetic tree; these run against the real rules/ that
// ships in the package, so a misplaced file is caught here and not by a consumer.

test('the shipped gradle-build rule is gated on stack.kotlin', () => {
  assert.ok(
    ids(PKG_ROOT, { kotlin: true }).includes('kotlin/gradle-build'),
    'kotlin: true must ship rules/kotlin/gradle-build.md'
  );
  assert.ok(
    !ids(PKG_ROOT, {}).includes('kotlin/gradle-build'),
    'no flags must not ship a kotlin-gated rule'
  );
  assert.ok(
    !ids(PKG_ROOT, { kmp: true }).includes('kotlin/gradle-build'),
    'kmp alone must not pull in the kotlin group'
  );
});

test('every shipped rule fits in one windsurf file', () => {
  // Past CHAR_LIMIT the windsurf adapter splits a rule into `-part-N.md`
  // fragments that are then read as independent rules, so a reader never sees
  // the rule whole. Rules stay terse on purpose — long-form code belongs in a
  // skill's references/, not in a rule.
  const allFlags = Object.fromEntries(STACK_FLAGS.map((flag) => [flag, true]));
  const rules = collectRules(PKG_ROOT, allFlags);
  assert.ok(rules.length > 0, 'no rules collected — the gate or the shipped rules/ tree is broken');
  for (const rule of rules) {
    assert.ok(
      rule.body.length <= CHAR_LIMIT,
      `rules/${rule.id}.md is ${rule.body.length} chars — ` +
        `${rule.body.length - CHAR_LIMIT} over the ${CHAR_LIMIT} windsurf split threshold`
    );
  }
});
