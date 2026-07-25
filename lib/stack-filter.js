/**
 * Every stack flag the package understands. Mirrors the `requires` enum in
 * schema/manifest.schema.json and the `stack` properties in
 * schema/config.schema.json — the JSON schemas cannot import this list, so any
 * new flag must be added in all three places.
 *
 * Consumed by rules-loader.js to decide which `rules/<group>/` directories are
 * flag-gated (a group whose name is a stack flag) and which are unconditional.
 */
export const STACK_FLAGS = ['kotlin', 'postgres', 'telegram', 'notion', 'docker', 'kmp'];

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
