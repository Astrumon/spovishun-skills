import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TARGETS, TARGET_NAMES, getTarget, findTarget } from '../adapters/registry.js';

const REQUIRED_FIELDS = ['install', 'update', 'readInstalled', 'hint', 'ownership', 'supportsUpdate'];
const OWNERSHIP_MODELS = new Set(['marker', 'checksum', 'none']);

test('every target defines the full column set', () => {
  for (const [name, def] of Object.entries(TARGETS)) {
    for (const field of REQUIRED_FIELDS) {
      assert.ok(field in def, `${name} is missing the "${field}" column`);
    }
    assert.equal(typeof def.install, 'function', `${name}.install must be callable`);
    assert.equal(typeof def.readInstalled, 'function', `${name}.readInstalled must be callable`);
    assert.equal(typeof def.hint, 'string', `${name}.hint must be a string`);
    assert.ok(OWNERSHIP_MODELS.has(def.ownership), `${name}.ownership is not a known model: ${def.ownership}`);
  }
});

// supportsUpdate is read by bin/update.js to decide whether to bail out with a
// message. If it ever disagrees with the presence of an update function, the
// command either crashes on a null call or silently refuses a target it could
// handle — so pin the two together.
test('supportsUpdate agrees with the presence of an update function', () => {
  for (const [name, def] of Object.entries(TARGETS)) {
    assert.equal(
      def.supportsUpdate,
      def.update !== null,
      `${name}: supportsUpdate=${def.supportsUpdate} but update is ${def.update === null ? 'null' : 'a function'}`
    );
    if (def.update !== null) assert.equal(typeof def.update, 'function');
  }
});

test('TARGET_NAMES covers exactly the table keys', () => {
  assert.deepEqual([...TARGET_NAMES].sort(), Object.keys(TARGETS).sort());
});

test('getTarget resolves every supported name', () => {
  for (const name of TARGET_NAMES) {
    assert.equal(getTarget(name), TARGETS[name]);
  }
});

test('getTarget throws an actionable error naming every supported target', () => {
  assert.throws(
    () => getTarget('cursor'),
    (err) => {
      assert.equal(err.name, 'ConfigError');
      assert.match(err.message, /cursor/);
      for (const name of TARGET_NAMES) {
        assert.ok(err.message.includes(name), `message should list "${name}": ${err.message}`);
        assert.ok(err.actionable.includes(name), `hint should list "${name}": ${err.actionable}`);
      }
      return true;
    }
  );
});

test('findTarget returns null instead of throwing for unknown or absent names', () => {
  assert.equal(findTarget('cursor'), null);
  assert.equal(findTarget(undefined), null);
  assert.equal(findTarget(''), null);
  assert.equal(findTarget('claude'), TARGETS.claude);
});

// The registry is the composition root: it imports adapters, so an adapter
// importing it back would close a cycle. Guard the one that is most tempting.
test('the claude adapter does not import the registry', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

  // Match the import statement, not the word — the adapters name the registry
  // in comments explaining precisely why they must not import it.
  const importsRegistry = /^\s*import\s[^\n]*['"][^'"]*registry\.js['"]/m;

  for (const rel of ['adapters/claude/index.js', 'adapters/codex/index.js', 'adapters/windsurf/index.js']) {
    const source = readFileSync(join(repoRoot, rel), 'utf8');
    assert.ok(!importsRegistry.test(source), `${rel} must not import adapters/registry.js`);
  }
});
