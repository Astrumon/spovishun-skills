/**
 * Classifies how an artifact should be handled during `update` / `install`.
 *
 * Actions:
 *   NEW            — upstream exists, no lockfile entry, nothing owned on disk
 *   UNCHANGED      — upstream checksum matches lockfile, on-disk matches lockfile
 *   LOCAL_ONLY     — upstream unchanged but on-disk was edited locally (skip)
 *   AUTO_APPLY     — upstream changed, on-disk matches lockfile (safe to overwrite)
 *   CONFLICT       — upstream changed AND on-disk was edited locally
 *   MISSING_ON_DISK — lockfile has entry but file(s) not found on disk (RESTORE — see below)
 *   REMOVED        — lockfile has entry but artifact no longer exists upstream
 *   COLLISION      — an owner-authored (unowned) file occupies an id with no lock entry
 *   ADOPT          — a marked file exists with no lock entry (register as baseline, don't overwrite)
 *   DISOWNED       — a locked id is now occupied by an unowned, locally-edited file
 *
 * MISSING_ON_DISK contract — the same in every consumer:
 *   Both `install` (adapters/claude/index.js) and `update` (bin/update.js) REWRITE the file
 *   from the current render and refresh its lock entry. The lockfile is the record of what
 *   the plugin owns, so a locked id with no file on disk is an inconsistent state, not a
 *   request to keep it deleted — and `sync` is `install`, so any other choice would make the
 *   two commands disagree on the very next run. To stop shipping an artifact, turn its stack
 *   flag off (or drop it upstream); install then deletes it via reconcileLegacyArtifacts /
 *   reconcileStaleRules.
 *
 * Ownership (`onDiskOwned`) is computed by the caller as
 *   `hasMarker || onDiskChecksum === lockEntry.checksum`
 * which keeps pre-marker installs recognised as ours (migration-safe).
 */

export const ACTIONS = Object.freeze({
  NEW: 'NEW',
  UNCHANGED: 'UNCHANGED',
  LOCAL_ONLY: 'LOCAL_ONLY',
  AUTO_APPLY: 'AUTO_APPLY',
  CONFLICT: 'CONFLICT',
  MISSING_ON_DISK: 'MISSING_ON_DISK',
  REMOVED: 'REMOVED',
  COLLISION: 'COLLISION',
  ADOPT: 'ADOPT',
  DISOWNED: 'DISOWNED',
});

/**
 * @param {object} opts
 * @param {object|null} opts.upstream       — upstream artifact {version, checksum (of rendered body)}
 * @param {object|null} opts.lockEntry      — lockfile entry {version, checksum}
 * @param {string|null} opts.onDiskChecksum — sha256 of current on-disk content (marker-stripped), or null if missing
 * @param {boolean}     opts.onDiskOwned    — whether the on-disk file is recognised as plugin-owned
 * @returns {string} one of ACTIONS
 */
export function classifyArtifact({ upstream, lockEntry, onDiskChecksum, onDiskOwned = false }) {
  const onDiskPresent = onDiskChecksum !== null;

  // No lockfile entry: the id is unknown to the plugin's prior state.
  if (!lockEntry) {
    if (!onDiskPresent) return ACTIONS.NEW;
    // A file already sits at this id. Owner wins unless it carries our marker.
    return onDiskOwned ? ACTIONS.ADOPT : ACTIONS.COLLISION;
  }

  if (!upstream) return ACTIONS.REMOVED;
  if (!onDiskPresent) return ACTIONS.MISSING_ON_DISK;

  // Locked id, but the on-disk file is no longer recognisably ours
  // (unmarked AND drifted from the locked checksum) → hand it to the owner.
  if (!onDiskOwned) return ACTIONS.DISOWNED;

  const upstreamChanged =
    upstream.version !== lockEntry.version || upstream.checksum !== lockEntry.checksum;
  const localEdited = onDiskChecksum !== lockEntry.checksum;

  if (!upstreamChanged && !localEdited) return ACTIONS.UNCHANGED;
  if (!upstreamChanged && localEdited) return ACTIONS.LOCAL_ONLY;
  if (upstreamChanged && !localEdited) return ACTIONS.AUTO_APPLY;
  return ACTIONS.CONFLICT;
}
