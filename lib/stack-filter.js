/**
 * Filters artifacts by active stack flags from consumer config.
 *
 * An artifact passes if:
 *   - it has no manifest.requires (universal / configurable)
 *   - or every flag in manifest.requires is true in stackFlags
 *
 * @param {Array<{manifest: object}>} artifacts
 * @param {object} stackFlags  — e.g. { kotlin: true, postgres: false, telegram: false, notion: true }
 * @returns {Array} — subset of artifacts whose requires are all satisfied
 */
export function filterByStack(artifacts, stackFlags) {
  return artifacts.filter((artifact) => {
    const requires = artifact.manifest.requires;
    if (!requires || requires.length === 0) return true;
    return requires.every((flag) => stackFlags[flag] === true);
  });
}
