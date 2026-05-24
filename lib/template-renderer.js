import Mustache from 'mustache';
import { ConfigError } from './errors.js';

// Manifest schema (schema/manifest.schema.json) constrains placeholder keys to
// UPPER_SNAKE_CASE. Any {{token}} that does not match this shape is treated as
// a literal — for example `${{ runner.os }}` inside a GitHub Actions snippet
// is left untouched.
const PLACEHOLDER_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Renders a Mustache template against the placeholder map, without HTML-escaping values.
 * Validates that every {{UPPER_SNAKE_CASE}} token in the template exists in the map.
 * Tokens whose key is not UPPER_SNAKE_CASE are preserved verbatim.
 *
 * @param {string} text  — template source with {{UPPER_SNAKE_KEY}} tokens
 * @param {object} opts
 * @param {Map<string, string>} opts.configMap  — from buildPlaceholderMap()
 * @param {string[]} [opts.manifestPlaceholders]  — declared keys from manifest; used for unknown-key detection
 * @returns {string}  — rendered output
 */
export function renderTemplate(text, { configMap, manifestPlaceholders = [] }) {
  const writer = new Mustache.Writer();
  const optionalKeys = new Set(manifestPlaceholders);

  // Collect all {{KEY}} tokens from the template
  const tokens = writer.parse(text);
  const usedKeys = tokens
    .filter((t) => t[0] === 'name' || t[0] === '&')
    .map((t) => t[1]);

  // Detect unknown placeholders before rendering.
  // Skipped:
  //  - tokens that do not match UPPER_SNAKE_CASE (e.g. `${{ runner.os }}` from
  //    GitHub Actions snippets is preserved verbatim);
  //  - keys declared in the artifact's manifest.placeholders list — these are
  //    treated as optional and resolve to an empty string when absent from the
  //    consumer config.
  for (const key of usedKeys) {
    if (!PLACEHOLDER_KEY_RE.test(key)) continue;
    if (configMap.has(key) || optionalKeys.has(key)) continue;
    throw new ConfigError(
      'UNKNOWN_PLACEHOLDER',
      `Unknown placeholder {{${key}}} in template.`,
      `Add \`${key}\` to your spovishun-skills.config.yaml or check the manifest's \`placeholders:\` list.`
    );
  }

  // Build a plain object view — no HTML escaping (triple-stache semantics for all values)
  const view = Object.fromEntries(configMap);

  // Render using a custom escape that is identity (no HTML encoding) and
  // preserves non-placeholder-shaped tokens (`{{ runner.os }}`) verbatim.
  writer.escapedValue = (token, context) => {
    const key = token[1];
    if (!PLACEHOLDER_KEY_RE.test(key)) {
      // Reconstruct the original token text — Mustache strips whitespace, so
      // we use the token's source span when available.
      const [start, end] = [token[2], token[3]];
      if (typeof start === 'number' && typeof end === 'number') {
        return text.slice(start, end);
      }
      return `{{${key}}}`;
    }
    const value = context.lookup(key);
    return value == null ? '' : String(value);
  };

  return writer.render(text, view);
}
