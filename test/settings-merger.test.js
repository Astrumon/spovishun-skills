import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings } from '../lib/settings-merger.js';

test('adds hooks to empty settings', () => {
  const result = mergeSettings({}, { PreToolUse: [{ matcher: '.*', command: 'hook.sh' }] });
  assert.ok(result.hooks);
  assert.equal(result.hooks.PreToolUse.length, 1);
  assert.equal(result.hooks.PreToolUse[0]._spovishun, true);
});

test('preserves existing user hooks (no _spovishun marker)', () => {
  const existing = {
    hooks: {
      PreToolUse: [{ matcher: 'Bash', command: 'my-hook.sh' }],
    },
  };
  const result = mergeSettings(existing, { PreToolUse: [{ matcher: '.*', command: 'plugin.sh' }] });
  assert.equal(result.hooks.PreToolUse.length, 2);
  const userHook = result.hooks.PreToolUse.find((e) => e.command === 'my-hook.sh');
  assert.ok(userHook);
  assert.ok(!userHook._spovishun);
});

test('replaces existing plugin hooks on re-install (orphan cleanup)', () => {
  const existing = {
    hooks: {
      PreToolUse: [{ matcher: '.*', command: 'old-plugin.sh', _spovishun: true }],
    },
  };
  const result = mergeSettings(existing, { PreToolUse: [{ matcher: '.*', command: 'new-plugin.sh' }] });
  const commands = result.hooks.PreToolUse.map((e) => e.command);
  assert.ok(!commands.includes('old-plugin.sh'), 'old plugin hook should be removed');
  assert.ok(commands.includes('new-plugin.sh'), 'new plugin hook should be present');
});

test('removes orphaned plugin hook when pluginHooks is empty', () => {
  const existing = {
    hooks: {
      PreToolUse: [{ matcher: '.*', command: 'old.sh', _spovishun: true }],
    },
  };
  const result = mergeSettings(existing, {});
  assert.ok(!result.hooks, 'hooks section should be removed when empty');
});

test('removes empty event array and empty hooks section', () => {
  const existing = {
    hooks: {
      PreToolUse: [{ _spovishun: true, command: 'x.sh' }],
    },
  };
  const result = mergeSettings(existing, {});
  assert.ok(!result.hooks);
});

test('does not mutate the existing object', () => {
  const existing = {
    hooks: { PreToolUse: [{ command: 'user.sh' }] },
  };
  const before = JSON.stringify(existing);
  mergeSettings(existing, { PreToolUse: [{ command: 'plugin.sh' }] });
  assert.equal(JSON.stringify(existing), before);
});

test('preserves non-hooks settings fields', () => {
  const existing = { permissions: { allow: ['Bash'] }, env: { FOO: 'bar' } };
  const result = mergeSettings(existing, {});
  assert.deepEqual(result.permissions, { allow: ['Bash'] });
  assert.deepEqual(result.env, { FOO: 'bar' });
});

test('handles multiple hook events simultaneously', () => {
  const result = mergeSettings({}, {
    PreToolUse: [{ command: 'pre.sh' }],
    PostToolUse: [{ command: 'post.sh' }],
  });
  assert.equal(result.hooks.PreToolUse.length, 1);
  assert.equal(result.hooks.PostToolUse.length, 1);
});

test('_spovishun marker is added to every plugin entry', () => {
  const result = mergeSettings({}, {
    PreToolUse: [{ command: 'a.sh' }, { command: 'b.sh' }],
  });
  for (const entry of result.hooks.PreToolUse) {
    assert.equal(entry._spovishun, true);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Invariants the single-pass rewrite must not lose.
// ─────────────────────────────────────────────────────────────────────────────

test('event key order: existing events keep their position, new ones append', () => {
  const existing = { hooks: { SessionStart: [{ command: 'mine' }], PreToolUse: [{ command: 'mine2' }] } };
  const merged = mergeSettings(existing, { PostToolUse: [{ command: 'ours' }] });
  assert.deepEqual(Object.keys(merged.hooks), ['SessionStart', 'PreToolUse', 'PostToolUse']);
});

test('a non-array hooks[event] value passes through untouched', () => {
  // Hand-mangled settings must not be silently normalised into an array — the
  // owner's file is theirs, and we only replace what we tagged.
  const existing = { hooks: { SessionStart: 'not-an-array' } };
  const merged = mergeSettings(existing, {});
  assert.equal(merged.hooks.SessionStart, 'not-an-array');
});

test('an event that is empty on both sides is not created', () => {
  const existing = { hooks: { SessionStart: [{ command: 'x', _spovishun: true }] } };
  const merged = mergeSettings(existing, {});
  assert.equal(merged.hooks, undefined, 'the whole hooks section goes when nothing is left');
});

test('non-hook settings keys are preserved', () => {
  const existing = { model: 'opus', permissions: { allow: ['Bash'] }, hooks: {} };
  const merged = mergeSettings(existing, { SessionStart: [{ command: 'ours' }] });
  assert.equal(merged.model, 'opus');
  assert.deepEqual(merged.permissions, { allow: ['Bash'] });
});

test('nested objects in the input are deep-cloned, not shared', () => {
  const existing = { permissions: { allow: ['Bash'] } };
  const merged = mergeSettings(existing, {});
  merged.permissions.allow.push('Read');
  assert.deepEqual(existing.permissions.allow, ['Bash'], 'the caller\u2019s object must not be mutated');
});

test('a missing or null existing settings object is accepted', () => {
  assert.deepEqual(mergeSettings(undefined, {}), {});
  assert.deepEqual(mergeSettings(null, {}), {});
  assert.deepEqual(mergeSettings({}, undefined), {});
});
