/**
 * Merges plugin-generated hook entries into an existing .claude/settings.json
 * using a marker-based strategy.
 *
 * Algorithm:
 *   1. Read existing settings (or start from {})
 *   2. From every hooks event array, remove entries that have _spovishun: true  (orphan cleanup)
 *   3. Append fresh plugin entries (each tagged with _spovishun: true) to the relevant event arrays
 *   4. Remove empty hook event arrays and empty hooks section
 *
 * Claude Code ignores unknown JSON fields, so _spovishun is safe to store.
 *
 * @param {object} existing   — parsed settings.json content (may be empty object)
 * @param {object} pluginHooks — { [event]: Array<hookEntry> }  e.g. { PreToolUse: [...] }
 * @returns {object}  — merged settings object (does NOT write to disk)
 */
export function mergeSettings(existing, pluginHooks) {
  const result = deepClone(existing);

  // Strip all previously-generated entries
  if (result.hooks && typeof result.hooks === 'object') {
    for (const event of Object.keys(result.hooks)) {
      if (Array.isArray(result.hooks[event])) {
        result.hooks[event] = result.hooks[event].filter((entry) => !entry._spovishun);
      }
    }
  }

  // Inject fresh plugin entries
  if (pluginHooks && typeof pluginHooks === 'object') {
    if (!result.hooks || typeof result.hooks !== 'object') {
      result.hooks = {};
    }
    for (const [event, entries] of Object.entries(pluginHooks)) {
      if (!Array.isArray(result.hooks[event])) {
        result.hooks[event] = [];
      }
      for (const entry of entries) {
        result.hooks[event].push({ ...entry, _spovishun: true });
      }
    }
  }

  // Clean up empty arrays and empty hooks section
  if (result.hooks && typeof result.hooks === 'object') {
    for (const event of Object.keys(result.hooks)) {
      if (Array.isArray(result.hooks[event]) && result.hooks[event].length === 0) {
        delete result.hooks[event];
      }
    }
    if (Object.keys(result.hooks).length === 0) {
      delete result.hooks;
    }
  }

  return result;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
