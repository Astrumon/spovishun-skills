import { ConfigError } from './errors.js';

// Manifest schema (schema/manifest.schema.json) constrains placeholder keys to
// UPPER_SNAKE_CASE. Any {{token}} that does not match this shape is treated as
// a literal — for example `${{ runner.os }}` inside a GitHub Actions snippet
// is left untouched.
const PLACEHOLDER_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Token forms, matched triple-first so `{{{KEY}}}` is never mistaken for a
 * `{{KEY}}` wrapped in stray braces.
 *
 * `[^{}]` is deliberate rather than a lazy `.`: it stops a match from swallowing
 * a brace, which is what keeps a non-placeholder triple such as
 * `${{{ runner.os }}}` intact — the triple pass leaves it alone (the key is not
 * UPPER_SNAKE_CASE), and the double pass can only see the inner
 * `{{ runner.os }}`, which it also leaves alone.
 */
const TOKEN_FORMS = [
  /\{\{\{\s*([^{}]+?)\s*\}\}\}/g, // triple-stache: historically "no HTML escaping"
  /\{\{\s*([^{}]+?)\s*\}\}/g,     // plain interpolation
];

/**
 * Substitutes {{UPPER_SNAKE_CASE}} placeholders from the config map.
 *
 * This was a Mustache renderer with a custom `escapedValue` hook. That hook only
 * intercepts interpolation, so three other Mustache syntaxes routed around it
 * and silently destroyed content: `${{{ runner.os }}}` collapsed to `$`,
 * `{{#X}}a{{/X}}` and `{{>foo}}` rendered as empty, `{{! ... }}` vanished. No
 * shipped artifact contained one — it was a mine, not a live defect — but the
 * substitution this package actually needs is a `String.replace`, and a plain
 * one cannot mistake a section, a partial or a comment for a directive.
 *
 * Tokens whose key is not UPPER_SNAKE_CASE are preserved verbatim, braces and
 * all. Values are never HTML-escaped.
 *
 * @param {string} text  — template source with {{UPPER_SNAKE_KEY}} tokens
 * @param {object} opts
 * @param {Map<string, string>} opts.configMap  — from buildPlaceholderMap()
 * @param {string[]} [opts.manifestPlaceholders]  — keys declared in the artifact's
 *   manifest; these are OPTIONAL and render to an empty string when absent from
 *   the consumer config, rather than failing the install
 * @returns {string}  — rendered output
 * @throws {ConfigError} UNKNOWN_PLACEHOLDER — for an UPPER_SNAKE_CASE key that is
 *   neither in the config map nor declared in the manifest
 */
export function renderTemplate(text, { configMap, manifestPlaceholders = [] }) {
  const optionalKeys = new Set(manifestPlaceholders);
  const resolvable = (key) => configMap.has(key) || optionalKeys.has(key);

  // Validate every token before writing anything, so a template with two unknown
  // keys does not render half of itself before failing on the second.
  for (const form of TOKEN_FORMS) {
    for (const [, key] of text.matchAll(form)) {
      if (!PLACEHOLDER_KEY_RE.test(key) || resolvable(key)) continue;
      throw new ConfigError(
        'UNKNOWN_PLACEHOLDER',
        `Unknown placeholder {{${key}}} in template.`,
        `Add \`${key}\` to your spovishun-skills.config.yaml or check the manifest's \`placeholders:\` list.`
      );
    }
  }

  return TOKEN_FORMS.reduce(
    (out, form) =>
      out.replace(form, (match, key) => {
        if (!PLACEHOLDER_KEY_RE.test(key)) return match;
        const value = configMap.get(key);
        return value == null ? '' : String(value);
      }),
    text
  );
}
