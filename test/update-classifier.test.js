import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyArtifact, ACTIONS } from '../lib/update-classifier.js';

const LOCK = { version: '1.0.0', checksum: 'sha256:base' };
const UP_SAME = { version: '1.0.0', checksum: 'sha256:base' };
const UP_CHANGED = { version: '2.0.0', checksum: 'sha256:next' };

// ── pre-existing states (owned files) ────────────────────────────────────────

test('UNCHANGED: upstream and on-disk both match the lock', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: LOCK, onDiskChecksum: 'sha256:base', onDiskOwned: true });
  assert.equal(a, ACTIONS.UNCHANGED);
});

test('AUTO_APPLY: upstream changed, on-disk still matches lock', () => {
  const a = classifyArtifact({ upstream: UP_CHANGED, lockEntry: LOCK, onDiskChecksum: 'sha256:base', onDiskOwned: true });
  assert.equal(a, ACTIONS.AUTO_APPLY);
});

test('LOCAL_ONLY: upstream unchanged, on-disk edited', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: LOCK, onDiskChecksum: 'sha256:edited', onDiskOwned: true });
  assert.equal(a, ACTIONS.LOCAL_ONLY);
});

test('CONFLICT: upstream changed AND on-disk edited', () => {
  const a = classifyArtifact({ upstream: UP_CHANGED, lockEntry: LOCK, onDiskChecksum: 'sha256:edited', onDiskOwned: true });
  assert.equal(a, ACTIONS.CONFLICT);
});

test('MISSING_ON_DISK: locked but file gone', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: LOCK, onDiskChecksum: null, onDiskOwned: false });
  assert.equal(a, ACTIONS.MISSING_ON_DISK);
});

test('REMOVED: locked but no longer upstream', () => {
  const a = classifyArtifact({ upstream: null, lockEntry: LOCK, onDiskChecksum: 'sha256:base', onDiskOwned: true });
  assert.equal(a, ACTIONS.REMOVED);
});

// ── new ownership states ─────────────────────────────────────────────────────

test('NEW: upstream-only, nothing on disk', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: null, onDiskChecksum: null, onDiskOwned: false });
  assert.equal(a, ACTIONS.NEW);
});

test('COLLISION: no lock entry, an unowned file already occupies the id', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: null, onDiskChecksum: 'sha256:foreign', onDiskOwned: false });
  assert.equal(a, ACTIONS.COLLISION);
});

test('ADOPT: no lock entry, a marked (owned) file occupies the id', () => {
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: null, onDiskChecksum: 'sha256:foreign', onDiskOwned: true });
  assert.equal(a, ACTIONS.ADOPT);
});

test('DISOWNED: locked id now occupied by an unowned, drifted file', () => {
  const a = classifyArtifact({ upstream: UP_CHANGED, lockEntry: LOCK, onDiskChecksum: 'sha256:edited', onDiskOwned: false });
  assert.equal(a, ACTIONS.DISOWNED);
});

// ── migration predicate: owned = marker || checksum match ─────────────────────

test('migration: pre-marker file matching the lock checksum is treated as owned (not DISOWNED)', () => {
  // Caller computes onDiskOwned = hasMarker || onDiskChecksum === lock.checksum.
  // Unmarked file, checksum still matches the lock → owned → UNCHANGED, never DISOWNED.
  const onDiskChecksum = LOCK.checksum;
  const onDiskOwned = false /* no marker */ || onDiskChecksum === LOCK.checksum;
  const a = classifyArtifact({ upstream: UP_SAME, lockEntry: LOCK, onDiskChecksum, onDiskOwned });
  assert.equal(a, ACTIONS.UNCHANGED);
});
