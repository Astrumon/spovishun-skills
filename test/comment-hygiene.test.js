import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8');

const body = read('skills', 'comment-hygiene', 'SKILL.md');
const manifest = parseYaml(read('skills', 'comment-hygiene', 'manifest.yaml'));
const finishTask = read('skills', 'finish-task', 'SKILL.md');

/** The allowlist section of SKILL.md, so a token mentioned elsewhere cannot satisfy the test. */
function allowlistSection(markdown) {
  const section = markdown.split('### Step 2: Drop the allowlist')[1]?.split('### Step 3')[0];
  assert.ok(section, 'SKILL.md must keep a "Step 2: Drop the allowlist" section');
  return section;
}

// Each of these is read by a tool (IDE, ktlint, detekt, Flyway) or carries legal text.
// Dropping one from the allowlist lets the pass delete a comment that breaks the build.
const ALLOWLIST = [
  '// region',
  '// endregion',
  '// language=',
  '//noinspection',
  '// @formatter:off',
  '// @formatter:on',
  'ktlint-disable',
  'ktlint-enable',
  'detekt',
  '@Suppress',
  'license',
  'copyright',
  'db/migration',
];

test('the allowlist names every tooling directive and legal header', () => {
  const section = allowlistSection(body);
  for (const token of ALLOWLIST) {
    assert.ok(section.includes(token), `allowlist must name \`${token}\``);
  }
});

test('candidates are scoped to the task diff against the develop branch', () => {
  assert.ok(body.includes('git diff -U0 {{GIT_DEVELOP_BRANCH}}...HEAD'));
  assert.ok(manifest.placeholders.some((p) => p.key === 'GIT_DEVELOP_BRANCH'));
});

test('a code-line change is rejected by the comment-only check and rolled back per file', () => {
  const check = body.split('### Step 4: Comment-only check')[1]?.split('### Step 5')[0];
  assert.ok(check, 'SKILL.md must keep a "Step 4: Comment-only check" section');
  assert.match(check, /byte-identical/);
  assert.ok(check.includes('git restore -- <file>'), 'a failed check must restore that file only');
  assert.match(body, /uncommitted changes\*\* is skipped/, 'rollback is only safe on a clean file');
});

test('edits wait for confirmation and are never committed', () => {
  assert.match(body, /only after the user explicitly confirms/);
  assert.match(body, /Never commit/);
});

test('nothing of the upstream core leaks in', () => {
  assert.doesNotMatch(body, /\bR-\d+\b/, 'core rule references (R-XX) must not be ported');
  assert.doesNotMatch(body, /antislop\.md|Delivery Gate/);
  assert.doesNotMatch(body, /during\/after/i);
});

test('manifest is universal and pins the anti-slop upstream', () => {
  assert.equal(manifest.category, 'universal');
  assert.equal(manifest.requires, undefined);
  assert.equal(manifest.source.repo, 'miqdadbadjuber/anti-slop');
});

test('finish-task runs comment-hygiene as a non-blocking step before the blocking gate', () => {
  const step2b = finishTask.indexOf('### Step 2b: Comment hygiene (non-blocking)');
  const step3 = finishTask.indexOf('### Step 3: Blocking gate');
  assert.ok(step2b !== -1, 'finish-task must have Step 2b');
  assert.ok(step3 !== -1, 'finish-task must keep Step 3');
  assert.ok(step2b < step3, 'comment hygiene must run before the blocking gate');

  const section = finishTask.slice(step2b, step3);
  assert.ok(section.includes('`comment-hygiene`'));
  assert.match(section, /Never commit them yourself/);
});
