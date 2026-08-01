/**
 * Merges plugin-generated hook entries into an existing .claude/settings.json.
 *
 * The consumer's settings.json is theirs: their own hook entries survive
 * untouched, and only entries tagged `_spovishun: true` are ours to replace.
 * Claude Code ignores unknown JSON fields, so the tag is safe to store.
 *
 * Built in one pass. The previous three passes had the third undoing work of
 * the first — it deleted the empty arrays that stripping our entries had just
 * created — so an event both sides were empty for had to be created and removed
 * again to reach the same result.
 *
 * Two behaviours the merge preserves and that tests pin:
 *   - event key ORDER: events already in the file keep their position, and
 *     plugin-only events append after them;
 *   - a non-array `hooks[<event>]` value (hand-mangled settings) passes through
 *     verbatim rather than being silently replaced by an array.
 *
 * @param {object} existing   — parsed settings.json content (may be empty object)
 * @param {object} pluginHooks — { [event]: Array<hookEntry> }  e.g. { PreToolUse: [...] }
 * @returns {object}  — merged settings object (does NOT write to disk)
 */
export function mergeSettings(existing, pluginHooks) {
  const result = structuredClone(existing ?? {});
  const current = asRecord(result.hooks);
  const incoming = asRecord(pluginHooks);

  const hooks = {};
  for (const event of new Set([...Object.keys(current), ...Object.keys(incoming)])) {
    const existingEntries = current[event];
    if (existingEntries !== undefined && !Array.isArray(existingEntries)) {
      hooks[event] = existingEntries;
      continue;
    }
    const merged = [
      ...(existingEntries ?? []).filter((entry) => !entry._spovishun),
      ...(incoming[event] ?? []).map((entry) => ({ ...entry, _spovishun: true })),
    ];
    if (merged.length > 0) hooks[event] = merged;
  }

  if (Object.keys(hooks).length > 0) result.hooks = hooks;
  else delete result.hooks;

  return result;
}

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
