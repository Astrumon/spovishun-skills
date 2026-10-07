import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { collectRules, collectAllRules, parseRuleFrontmatter, formatRule } from '../lib/rules-loader.js';
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
  //
  // Measured on the windsurf-formatted text: a path-scoped rule carries its
  // `trigger: glob` frontmatter inside the same file and the same budget.
  const allFlags = Object.fromEntries(STACK_FLAGS.map((flag) => [flag, true]));
  const rules = collectRules(PKG_ROOT, allFlags);
  assert.ok(rules.length > 0, 'no rules collected — the gate or the shipped rules/ tree is broken');
  for (const rule of rules) {
    const text = formatRule(rule, rule.body, 'windsurf');
    assert.ok(
      text.length <= CHAR_LIMIT,
      `rules/${rule.id}.md is ${text.length} chars — ` +
        `${text.length - CHAR_LIMIT} over the ${CHAR_LIMIT} windsurf split threshold`
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// collectAllRules — the single-walk source both collectRules and the stale-rule
// reconciliation read from.
// ─────────────────────────────────────────────────────────────────────────────

test('collectAllRules returns de-selected rules, flagged inactive', () => {
  const root = makePkgRoot();
  const all = collectAllRules(root, { kotlin: true });
  const byId = new Map(all.map((r) => [r.id, r]));

  assert.equal(byId.get('kotlin/a').active, true, 'an active flag selects its group');
  assert.equal(byId.get('kmp/a').active, false, 'an inactive flag returns the rule, marked inactive');
  assert.equal(byId.get('kmp/deep/b').active, false, 'gating applies to the whole subtree');
  assert.equal(byId.get('common/a').active, true, 'ungated groups are always active');
  assert.equal(byId.get('nested/a').active, true, 'unknown group names are not gated');
  assert.equal(byId.get('root-level').active, true, 'files directly under rules/ are ungated');
});

test('collectAllRules bodies are readable for inactive rules too', () => {
  // reconcileStaleRules renders de-selected rules to prove a file on disk is
  // ours before deleting it — an empty body would make every stale rule look
  // owner-authored and strand it forever.
  const root = makePkgRoot();
  const kmp = collectAllRules(root, {}).find((r) => r.id === 'kmp/a');
  assert.equal(kmp.active, false);
  assert.equal(kmp.body, '# kmp\n');
});

test('collectRules is exactly the active half of collectAllRules', () => {
  const root = makePkgRoot();
  for (const flags of [{}, { kotlin: true }, { kotlin: true, kmp: true }]) {
    assert.deepEqual(
      collectRules(root, flags).map((r) => r.id),
      collectAllRules(root, flags).filter((r) => r.active).map((r) => r.id),
      `mismatch for flags ${JSON.stringify(flags)}`
    );
  }
});

test('collectAllRules returns the same id set regardless of flags', () => {
  // This is what replaced the "walk again with ALL flags on" pass: the candidate
  // set for stale-rule reconciliation must not depend on the active stack.
  const root = makePkgRoot();
  const idsFor = (flags) => collectAllRules(root, flags).map((r) => r.id).sort();
  assert.deepEqual(idsFor({}), idsFor({ kotlin: true, kmp: true }));
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule frontmatter — `paths:` (scope, translated per target) and `requires:`
// (extra stack flags on top of the group gate).
// ─────────────────────────────────────────────────────────────────────────────

test('parseRuleFrontmatter: no frontmatter leaves the body untouched', () => {
  assert.deepEqual(parseRuleFrontmatter('# Rule\n', 'x'), { body: '# Rule\n', paths: [], requires: [] });
});

test('parseRuleFrontmatter: paths and requires are read and stripped from the body', () => {
  const src = '---\npaths:\n  - "**/*.kt"\nrequires:\n  - kmp\n---\n\n# Rule\n';
  assert.deepEqual(parseRuleFrontmatter(src, 'x'), { body: '# Rule\n', paths: ['**/*.kt'], requires: ['kmp'] });
});

test('parseRuleFrontmatter: CRLF frontmatter parses', () => {
  const src = '---\r\npaths:\r\n  - "a/**"\r\n---\r\n\r\n# Rule\r\n';
  assert.deepEqual(parseRuleFrontmatter(src, 'x').paths, ['a/**']);
});

test('parseRuleFrontmatter: an unknown key is rejected, naming the rule and the key', () => {
  assert.throws(
    () => parseRuleFrontmatter('---\npath:\n  - a\n---\n# R\n', 'kmp/r'),
    /kmp\/r: unknown frontmatter key "path"/
  );
});

test('parseRuleFrontmatter: an unknown stack flag in requires is rejected', () => {
  assert.throws(() => parseRuleFrontmatter('---\nrequires:\n  - ktor\n---\n# R\n', 'kmp/r'), /unknown stack flag "ktor"/);
});

test('parseRuleFrontmatter: paths must be a non-empty list of strings', () => {
  assert.throws(() => parseRuleFrontmatter('---\npaths: "**/*.kt"\n---\n# R\n', 'r'), /non-empty list of strings/);
  assert.throws(() => parseRuleFrontmatter('---\npaths: []\n---\n# R\n', 'r'), /non-empty list of strings/);
});

test('requires: gates a single rule on top of its group', () => {
  const root = makePkgRoot();
  writeFileSync(join(root, 'rules', 'kmp', 'opt.md'), '---\nrequires:\n  - components\n---\n\n# opt\n', 'utf8');
  assert.ok(!ids(root, { kmp: true }).includes('kmp/opt'), 'flag off → skipped');
  assert.ok(ids(root, { kmp: true, components: true }).includes('kmp/opt'), 'both on → collected');
  assert.ok(!ids(root, { components: true }).includes('kmp/opt'), 'the group gate still applies');

  const opt = collectAllRules(root, {}).find((r) => r.id === 'kmp/opt');
  assert.equal(opt.active, false);
  assert.equal(opt.body, '# opt\n', 'inactive rules keep a stripped, renderable body');
});

test('formatRule: an unscoped rule is identical on every target', () => {
  for (const target of ['claude', 'windsurf', 'codex']) {
    assert.equal(formatRule({ paths: [] }, '# R\n', target), '# R\n');
  }
});

test("formatRule: paths become each target's own scoping", () => {
  const rule = { paths: ['**/*.gradle.kts', 'build-logic/**'] };
  assert.equal(
    formatRule(rule, '# R\n', 'claude'),
    '---\npaths:\n  - "**/*.gradle.kts"\n  - "build-logic/**"\n---\n\n# R\n'
  );
  assert.equal(
    formatRule(rule, '# R\n', 'windsurf'),
    '---\ntrigger: glob\nglobs: **/*.gradle.kts, build-logic/**\n---\n\n# R\n'
  );
  assert.equal(formatRule(rule, '# R\n', 'codex'), '_Applies to: `**/*.gradle.kts`, `build-logic/**`_\n\n# R\n');
  assert.throws(() => formatRule(rule, '# R\n', 'cursor'), /unknown target/);
});

test('formatRule: the claude frontmatter round-trips through the parser', () => {
  const rule = { paths: ['**/remote/**', '**/*Api.kt'] };
  const parsed = parseRuleFrontmatter(formatRule(rule, '# R\n', 'claude'), 'x');
  assert.deepEqual(parsed.paths, rule.paths);
  assert.equal(parsed.body, '# R\n');
});

// Shipped rules: every frontmatter parses (collectAllRules throws otherwise),
// and the installed set per representative stack is pinned.

test('every shipped rule frontmatter parses', () => {
  assert.doesNotThrow(() => collectAllRules(PKG_ROOT, {}));
});

test('shipped path-scoped and opt-in rules carry their frontmatter', () => {
  const all = new Map(collectAllRules(PKG_ROOT, {}).map((r) => [r.id, r]));
  assert.ok(all.get('kmp/networking').paths.includes('**/remote/**'));
  assert.ok(all.get('kotlin/gradle-build').paths.includes('**/*.gradle.kts'));
  assert.ok(all.get('kotlin/gradle-build').paths.includes('**/libs.versions.toml'));
  assert.deepEqual(all.get('kmp/component-architecture').requires, ['components']);
});

test('installed rule set per representative stack', () => {
  const common = ['common/design-principles', 'common/git-workflow', 'common/security', 'common/testing'];
  const kotlin = ['kotlin/gradle-build', 'kotlin/kotlin-style'];
  const kmp = [
    'kmp/architecture', 'kmp/feature-structure', 'kmp/localization', 'kmp/modularization',
    'kmp/navigation', 'kmp/networking', 'kmp/persistence', 'kmp/testing', 'kmp/uikit',
  ];
  const sorted = (xs) => [...xs].sort((a, b) => a.localeCompare(b));
  const cases = [
    [{}, common],
    [{ kotlin: true }, [...common, ...kotlin]],
    [{ kotlin: true, kmp: true }, [...common, ...kotlin, ...kmp]],
    [{ kotlin: true, kmp: true, components: true }, [...common, ...kotlin, ...kmp, 'kmp/component-architecture']],
    [{ notion: true }, [...common, 'notion/feature-documentation']],
  ];
  for (const [flags, expected] of cases) {
    assert.deepEqual(ids(PKG_ROOT, flags), sorted(expected), `flags ${JSON.stringify(flags)}`);
  }
});

test('no shipped rule pins a Claude model id', () => {
  // A hardcoded model in a co-author line goes stale with the next model
  // release and is then copied into every consumer commit.
  for (const rule of collectAllRules(PKG_ROOT, {})) {
    assert.ok(!/Claude (Sonnet|Opus|Haiku) \d/.test(rule.body), `rules/${rule.id}.md pins a model`);
  }
});
