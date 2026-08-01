import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyArtifact, ACTIONS } from '../lib/update-classifier.js';

const LOCK = { version: '1.0.0', checksum: 'sha256:base' };
const UP_SAME = { version: '1.0.0', checksum: 'sha256:base' };
const UP_CHANGED = { version: '2.0.0', checksum: 'sha256:next' };

// ── pre-existing states (owned files) ────────────────────────────────────────

test('UNCHANGED: upstream and on-disk both match the lock', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: LOCK, onDiskChecksum: 'sha256:base' });
  assert.equal(a, ACTIONS.UNCHANGED);
});

test('AUTO_APPLY: upstream changed, on-disk still matches lock', () => {
  const a = classifyArtifact({ upstream: UP_CHANGED, lockEntry: LOCK, onDiskChecksum: 'sha256:base' });
  assert.equal(a, ACTIONS.AUTO_APPLY);
});

test('LOCAL_ONLY: upstream unchanged, on-disk edited', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: LOCK, onDiskChecksum: 'sha256:edited', hasMarker: true });
  assert.equal(a, ACTIONS.LOCAL_ONLY);
});

test('CONFLICT: upstream changed AND on-disk edited', () => {
  const a = classifyArtifact({ upstream: UP_CHANGED, lockEntry: LOCK, onDiskChecksum: 'sha256:edited', hasMarker: true });
  assert.equal(a, ACTIONS.CONFLICT);
});

test('MISSING_ON_DISK: locked but file gone', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: LOCK, onDiskChecksum: null });
  assert.equal(a, ACTIONS.MISSING_ON_DISK);
});

test('REMOVED: locked but no longer upstream', () => {
  const a = classifyArtifact({ upstream: null, lockEntry: LOCK, onDiskChecksum: 'sha256:base' });
  assert.equal(a, ACTIONS.REMOVED);
});

// ── ownership states ─────────────────────────────────────────────────────────

test('NEW: upstream-only, nothing on disk', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: null, onDiskChecksum: null });
  assert.equal(a, ACTIONS.NEW);
});

test('COLLISION: no lock entry, an unmarked file already occupies the id', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: null, onDiskChecksum: 'sha256:foreign' });
  assert.equal(a, ACTIONS.COLLISION);
});

test('ADOPT: no lock entry, a marked file occupies the id', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: null, onDiskChecksum: 'sha256:foreign', hasMarker: true });
  assert.equal(a, ACTIONS.ADOPT);
});

test('DISOWNED: locked id now occupied by an unmarked, drifted file', () => {
  const a = classifyArtifact({ upstream: UP_CHANGED, lockEntry: LOCK, onDiskChecksum: 'sha256:edited' });
  assert.equal(a, ACTIONS.DISOWNED);
});

// ── ownership model: marker ──────────────────────────────────────────────────

test('migration: pre-marker file matching the lock checksum is owned (not DISOWNED)', () => {
  // owned = hasMarker || onDiskChecksum === lock.checksum. Unmarked file whose
  // checksum still matches the lock → owned → UNCHANGED, never DISOWNED. This
  // is what lets a pre-1.16 install upgrade without spurious diffs.
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: LOCK, onDiskChecksum: LOCK.checksum, hasMarker: false });
  assert.equal(a, ACTIONS.UNCHANGED);
});

// ── ownership model: checksum (rules) ────────────────────────────────────────

test('checksum ownership: on-disk equal to our render is UNCHANGED even with no lock entry', () => {
  // A pre-1.16 rule on disk with no `rule:` lock entry is adopted silently —
  // the body already equals what we would write, so there is nothing to report.
  const a = classifyArtifact({
    upstream: UP_SAME,
    lockEntry: null,
    onDiskChecksum: UP_SAME.checksum,
    ownership: 'checksum',
  });
  assert.equal(a, ACTIONS.UNCHANGED);
});

test('checksum ownership: no lock entry and a drifted file is a COLLISION', () => {
  const a = classifyArtifact({
    upstream: UP_SAME,
    lockEntry: null,
    onDiskChecksum: 'sha256:owner-authored',
    ownership: 'checksum',
  });
  assert.equal(a, ACTIONS.COLLISION);
});

// Without the lockEntry-implies-owned rule this would be DISOWNED, which drops
// the entry from the lockfile and stops tracking a rule the plugin still ships.
test('checksum ownership: a locked but locally edited rule is LOCAL_ONLY, never DISOWNED', () => {
  const a = classifyArtifact({
    upstream: UP_SAME,
    lockEntry: LOCK,
    onDiskChecksum: 'sha256:edited',
    ownership: 'checksum',
  });
  assert.equal(a, ACTIONS.LOCAL_ONLY);
});

test('checksum ownership: a locked rule edited while upstream also changed is CONFLICT', () => {
  const a = classifyArtifact({
    upstream: UP_CHANGED,
    lockEntry: LOCK,
    onDiskChecksum: 'sha256:edited',
    ownership: 'checksum',
  });
  assert.equal(a, ACTIONS.CONFLICT);
});

test('checksum ownership: ADOPT and DISOWNED are unreachable', () => {
  // Both are marker-specific states; a marker on a rule body means nothing
  // because rules have no frontmatter to carry one.
  const states = [
    { lockEntry: null, onDiskChecksum: 'sha256:foreign', hasMarker: true },
    { lockEntry: LOCK, onDiskChecksum: 'sha256:edited', hasMarker: false },
  ];
  for (const state of states) {
    const a = classifyArtifact({ upstream: UP_SAME, ownership: 'checksum', ...state });
    assert.notEqual(a, ACTIONS.ADOPT);
    assert.notEqual(a, ACTIONS.DISOWNED);
  }
});

test('checksum ownership: a locked rule missing on disk is restored', () => {
  const a = classifyArtifact({
    upstream: UP_SAME,
    lockEntry: LOCK,
    onDiskChecksum: null,
    ownership: 'checksum',
  });
  assert.equal(a, ACTIONS.MISSING_ON_DISK);
});

// ── ownership model: assume-owned (windsurf) ─────────────────────────────────

test('assume-owned: an unmarked drifted file is LOCAL_ONLY, not DISOWNED', () => {
  const a = classifyArtifact({
    upstream: UP_SAME,
    lockEntry: LOCK,
    onDiskChecksum: 'sha256:edited',
    ownership: 'assume-owned',
  });
  assert.equal(a, ACTIONS.LOCAL_ONLY);
});

test('assume-owned: an unlocked file occupying an id is ADOPTed, never a COLLISION', () => {
  const a = classifyArtifact({
    upstream: UP_SAME,
    lockEntry: null,
    onDiskChecksum: 'sha256:foreign',
    ownership: 'assume-owned',
  });
  assert.equal(a, ACTIONS.ADOPT);
});
