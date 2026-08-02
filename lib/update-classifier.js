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
 * OWNERSHIP MODELS — how "is this file ours?" is answered, per artifact class:
 *
 *   'marker'  — skills / agents / templates on a marker target. Ours iff the body
 *               carries the x-spovishun marker OR its checksum still matches the
 *               lockfile; the second half is what keeps pre-marker installs
 *               recognised as ours (migration-safe). ADOPT and DISOWNED are only
 *               reachable here — both are marker-specific states.
 *
 *   'checksum' — rules, and every windsurf file. Neither carries YAML frontmatter
 *               to stamp, so there is no marker to consult and ownership is decided
 *               by content alone: a body equal to what we would write is ours
 *               (UNCHANGED, short-circuited below), and anything else is ours only
 *               if the lockfile already tracks the id. A locked file that drifted is
 *               therefore LOCAL_ONLY/CONFLICT — reported and kept — never DISOWNED,
 *               which would drop the entry.
 *
 * The mode is passed in rather than the resolved boolean so the predicate lives
 * in one place instead of being re-derived at each call site.
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
 * Resolves the ownership question for one file. See the OWNERSHIP MODELS block
 * above for what each mode means and why.
 */
function isOwned({ ownership, lockEntry, onDiskChecksum, hasMarker }) {
  // 'none' targets have no per-artifact files to own (codex inlines everything
  // into one AGENTS.md) and never reach classification; treat them as owned so a
  // future caller cannot fall through to the marker predicate by accident.
  if (ownership === 'none') return true;
  if (ownership === 'checksum') return lockEntry != null;
  return hasMarker || (lockEntry != null && onDiskChecksum === lockEntry.checksum);
}

/**
 * @param {object} opts
 * @param {object|null} opts.upstream       — upstream artifact {version, checksum (of rendered body)}
 * @param {object|null} opts.lockEntry      — lockfile entry {version, checksum}
 * @param {string|null} opts.onDiskChecksum — sha256 of current on-disk content (marker-stripped), or null if missing
 * @param {boolean}     [opts.hasMarker]    — whether the on-disk body carries the x-spovishun marker
 * @param {'marker'|'checksum'|'none'} [opts.ownership] — ownership model (default 'marker')
 * @returns {string} one of ACTIONS
 */
export function classifyArtifact({
  upstream,
  lockEntry,
  onDiskChecksum,
  hasMarker = false,
  ownership = 'marker',
}) {
  const onDiskPresent = onDiskChecksum !== null;

  // Content already equal to our render under checksum ownership: nothing to
  // report, nothing to merge. See the OWNERSHIP MODELS block.
  if (ownership === 'checksum' && upstream && onDiskChecksum === upstream.checksum) {
    return ACTIONS.UNCHANGED;
  }

  const onDiskOwned = isOwned({ ownership, lockEntry, onDiskChecksum, hasMarker });

  // No lockfile entry: the id is unknown to the plugin's prior state.
  if (!lockEntry) {
    if (!onDiskPresent) return ACTIONS.NEW;
    // A file already sits at this id. Owner wins unless we recognise it as ours.
    return onDiskOwned ? ACTIONS.ADOPT : ACTIONS.COLLISION;
  }

  if (!upstream) return ACTIONS.REMOVED;
  if (!onDiskPresent) return ACTIONS.MISSING_ON_DISK;

  // Locked id, on-disk file no longer recognisably ours → hand it to the owner.
  if (!onDiskOwned) return ACTIONS.DISOWNED;

  const upstreamChanged =
    upstream.version !== lockEntry.version || upstream.checksum !== lockEntry.checksum;
  const localEdited = onDiskChecksum !== lockEntry.checksum;

  if (!upstreamChanged && !localEdited) return ACTIONS.UNCHANGED;
  if (!upstreamChanged && localEdited) return ACTIONS.LOCAL_ONLY;
  if (upstreamChanged && !localEdited) return ACTIONS.AUTO_APPLY;
  return ACTIONS.CONFLICT;
}
