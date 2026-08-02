import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// hooks/branch-name.js and hooks/page-id.js are leaves — the project prefix is
// passed in rather than read from config — so they need no env, no cwd and no
// cache juggling to exercise.
const { extractTaskNumber, extractBranchFromBlocks, deriveBranchFromName, displayName } =
  require(join(here, '..', 'hooks', 'branch-name.js'));
const { toDashed, toCompact } = require(join(here, '..', 'hooks', 'page-id.js'));

const para = (text) => ({ type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] } });

// ─── Task numbers ─────────────────────────────────────────────────────────────

test('extractTaskNumber reads the number out of a task title', () => {
  assert.equal(extractTaskNumber('feature/x-93: Foo'), '93');
  assert.equal(extractTaskNumber('feature/demo-7-already-a-branch'), '7');
  assert.equal(extractTaskNumber('no number here'), null);
});

// ─── Branch derivation ────────────────────────────────────────────────────────

test('deriveBranchFromName builds a sanitized branch from the task title', () => {
  assert.equal(
    deriveBranchFromName('feature/myapp-17: Add member ban command', 'myapp'),
    'feature/myapp-17-add-member-ban-command'
  );
  assert.equal(deriveBranchFromName('no number here', 'myapp'), null);
});

test('deriveBranchFromName strips punctuation and caps the slug', () => {
  const long = 'feature/myapp-17: ' + 'word '.repeat(20);
  const branch = deriveBranchFromName(long, 'myapp');
  assert.match(branch, /^feature\/myapp-17-/);
  // The slug is capped at 40 chars so branch names stay usable in a shell prompt.
  assert.ok(branch.length <= 'feature/myapp-17-'.length + 40, branch);

  assert.equal(
    deriveBranchFromName('feature/myapp-3: Fix "quotes" & (parens)!', 'myapp'),
    'feature/myapp-3-fix-quotes-parens'
  );
});

test('deriveBranchFromName uses the prefix it is given, not an ambient one', () => {
  assert.equal(deriveBranchFromName('feature/old-9: Thing', 'newname'), 'feature/newname-9-thing');
});

test('a branch stated in the page body is preferred over derivation', () => {
  const blocks = [
    { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Branch' }] } },
    para('feature/demo-42-explicit-name'),
  ];
  assert.equal(extractBranchFromBlocks(blocks), 'feature/demo-42-explicit-name');
});

test('extractBranchFromBlocks ignores non-paragraph blocks and prose without a branch', () => {
  assert.equal(extractBranchFromBlocks([para('just some prose')]), null);
  assert.equal(
    extractBranchFromBlocks([
      { type: 'code', code: { rich_text: [{ plain_text: 'feature/demo-1-in-code' }] } },
    ]),
    null,
    'only paragraphs declare the branch — a code sample must not be mistaken for one'
  );
});

// ─── Display names ────────────────────────────────────────────────────────────

test('displayName strips the feature/<prefix>-<N> lead-in', () => {
  assert.equal(displayName('feature/demo-42: Add ban command', 'demo'), 'Add ban command');
  assert.equal(displayName('Add ban command', 'demo'), 'Add ban command');
});

test('displayName survives a prefix carrying regex metacharacters', () => {
  // PROJECT_PREFIX is slugified when it comes from the config, but the env var
  // override is unfiltered — an unescaped "." or "(" would throw or mis-match.
  assert.doesNotThrow(() => displayName('feature/a(b-1: Thing', 'a(b'));
  assert.equal(displayName('feature/a.c-1: Thing', 'a.c'), 'Thing');
  assert.equal(displayName('feature/axc-1: Thing', 'a.c'), 'feature/axc-1: Thing', '"." must not match "x"');
});

// ─── Page ids ─────────────────────────────────────────────────────────────────

test('toDashed / toCompact round-trip a Notion page id', () => {
  const compact = 'aaaaaaaa11112222333344445555bbbb';
  const dashed = 'aaaaaaaa-1111-2222-3333-44445555bbbb';
  assert.equal(toDashed(compact), dashed);
  assert.equal(toDashed(dashed), dashed, 'already-dashed ids pass through');
  assert.equal(toCompact(dashed), compact);
});

test('toDashed passes through anything that is not a 32-char id', () => {
  // Slicing a typo into 8-4-4-4-12 would fabricate a plausible-looking id and
  // turn a clear "not found" from Notion into a confusing one.
  assert.equal(toDashed('too-short'), 'too-short');
  assert.equal(toDashed(''), '');
  assert.equal(toDashed(null), null);
  assert.equal(toDashed(undefined), undefined);
});
