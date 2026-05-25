/**
 * Classifies how an artifact should be handled during `update`.
 *
 * Actions:
 *   NEW            — artifact exists upstream but not in lockfile
 *   UNCHANGED      — upstream checksum matches lockfile, on-disk checksum matches lockfile
 *   LOCAL_ONLY     — upstream unchanged but on-disk was edited locally (skip)
 *   AUTO_APPLY     — upstream changed, on-disk matches lockfile (safe to overwrite)
 *   CONFLICT       — upstream changed AND on-disk was edited locally
 *   MISSING_ON_DISK — lockfile has entry but file(s) not found on disk (treat as LOCAL_ONLY)
 *   REMOVED        — lockfile has entry but artifact no longer exists upstream
 */

export const ACTIONS = Object.freeze({
  NEW: 'NEW',
  UNCHANGED: 'UNCHANGED',
  LOCAL_ONLY: 'LOCAL_ONLY',
  AUTO_APPLY: 'AUTO_APPLY',
  CONFLICT: 'CONFLICT',
  MISSING_ON_DISK: 'MISSING_ON_DISK',
  REMOVED: 'REMOVED',
});

/**
 * @param {object} opts
 * @param {object|null} opts.upstream       — upstream artifact {version, checksum (of rendered body)}
 * @param {object|null} opts.lockEntry      — lockfile entry {version, checksum}
 * @param {string|null} opts.onDiskChecksum — sha256 checksum of current on-disk content, or null if missing
 * @returns {string} one of ACTIONS
 */
export function classifyArtifact({ upstream, lockEntry, onDiskChecksum }) {
  if (!lockEntry) return ACTIONS.NEW;
  if (!upstream) return ACTIONS.REMOVED;

  const upstreamChanged =
    upstream.version !== lockEntry.version || upstream.checksum !== lockEntry.checksum;

  if (onDiskChecksum === null) return ACTIONS.MISSING_ON_DISK;

  const localEdited = onDiskChecksum !== lockEntry.checksum;

  if (!upstreamChanged && !localEdited) return ACTIONS.UNCHANGED;
  if (!upstreamChanged && localEdited) return ACTIONS.LOCAL_ONLY;
  if (upstreamChanged && !localEdited) return ACTIONS.AUTO_APPLY;
  return ACTIONS.CONFLICT;
}
