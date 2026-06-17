/**
 * Provenance marker primitives.
 *
 * Every plugin-generated skill / agent body carries an identity-only marker
 * line — `x-spovishun: <id>` — inserted immediately after the opening `---`
 * fence of its YAML frontmatter. The marker is how install/update recognise
 * "this file is ours" without consulting the lockfile, so an owner-authored
 * file whose id collides with a plugin id is never clobbered.
 *
 * Design rules (see the ownership-model task):
 *   - Identity only: no version, no checksum. Versions live in the lockfile.
 *   - Raw line insert — never a js-yaml re-parse/re-dump — so the rest of the
 *     frontmatter stays byte-for-byte identical.
 *   - Marker is EXCLUDED from every checksum: callers run `stripMarker()`
 *     before `sha256()`. This keeps checksums invariant to marker presence,
 *     so pre-marker installs migrate with zero spurious diffs.
 *
 * Only `skill` and `agent` bodies are marked (they have YAML frontmatter Claude
 * already tolerates unknown keys in). Templates / rules / hooks stay
 * lockfile-only.
 */

export const MARKER_KEY = 'x-spovishun';

function hasFrontmatter(text) {
  return typeof text === 'string' && (text.startsWith('---\n') || text.startsWith('---\r\n'));
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Index just past the closing `---` fence line, or -1 if there is no closing
 * fence. Used to bound marker detection/removal to the frontmatter block so a
 * body line that happens to start with `x-spovishun:` is never touched.
 */
function frontmatterEnd(text) {
  const m = /\r?\n---(\r?\n|$)/.exec(text);
  return m ? m.index + m[0].length : -1;
}

function markerMatch(text) {
  if (!hasFrontmatter(text)) return null;
  const re = new RegExp(`(^|\\r?\\n)${MARKER_KEY}:[ \\t]*([^\\r\\n]*)(\\r?\\n)`);
  const m = re.exec(text);
  if (!m) return null;
  const fmEnd = frontmatterEnd(text);
  const limit = fmEnd === -1 ? text.length : fmEnd;
  if (m.index >= limit) return null;
  return m;
}

/**
 * Returns the marker id, or null if the text has no marker in its frontmatter.
 */
export function readMarker(text) {
  const m = markerMatch(text);
  return m ? m[2].trim() : null;
}

/**
 * True iff the text carries a provenance marker in its frontmatter.
 */
export function hasMarker(text) {
  return markerMatch(text) !== null;
}

/**
 * Removes the provenance marker line (if any) from the frontmatter, leaving the
 * rest of the document byte-for-byte unchanged. No-op when no marker is present
 * or the text has no frontmatter — so it is safe to run unconditionally before
 * hashing.
 */
export function stripMarker(text) {
  const m = markerMatch(text);
  if (!m) return text;
  const leadEol = m[1]; // '' at start-of-text, otherwise the preceding line break
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  return before + leadEol + after;
}

/**
 * Inserts (or refreshes) the `x-spovishun: <id>` marker immediately after the
 * opening `---` fence. Idempotent: any existing marker is removed first, so
 * repeated installs never stack duplicate lines.
 *
 * Returns the text unchanged when it has no leading frontmatter (nothing to
 * anchor the marker to) or when `id` is missing — those artifacts stay
 * lockfile-only owned.
 */
export function injectMarker(text, id) {
  if (!hasFrontmatter(text) || typeof id !== 'string' || id.length === 0) return text;
  const stripped = stripMarker(text);
  const eol = detectEol(stripped);
  const fenceLen = stripped.startsWith('---\r\n') ? 5 : 4; // '---\r\n' | '---\n'
  const head = stripped.slice(0, fenceLen);
  const rest = stripped.slice(fenceLen);
  return `${head}${MARKER_KEY}: ${id}${eol}${rest}`;
}
