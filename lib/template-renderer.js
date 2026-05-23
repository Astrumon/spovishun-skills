import Mustache from 'mustache';
import { ConfigError } from './errors.js';

/**
 * Renders a Mustache template against the placeholder map, without HTML-escaping values.
 * Validates that every {{KEY}} in the template exists in the map.
 *
 * @param {string} text  — template source with {{UPPER_SNAKE_KEY}} tokens
 * @param {object} opts
 * @param {Map<string, string>} opts.configMap  — from buildPlaceholderMap()
 * @param {string[]} [opts.manifestPlaceholders]  — declared keys from manifest; used for unknown-key detection
 * @returns {string}  — rendered output
 */
export function renderTemplate(text, { configMap, manifestPlaceholders = [] }) {
  const writer = new Mustache.Writer();

  // Collect all {{KEY}} tokens from the template
  const tokens = writer.parse(text);
  const usedKeys = tokens
    .filter((t) => t[0] === 'name' || t[0] === '&')
    .map((t) => t[1]);

  // Detect unknown placeholders before rendering
  for (const key of usedKeys) {
    if (!configMap.has(key)) {
      throw new ConfigError(
        'UNKNOWN_PLACEHOLDER',
        `Unknown placeholder {{${key}}} in template.`,
        `Add \`${key}\` to your spovishun-skills.config.yaml or check the manifest's \`placeholders:\` list.`
      );
    }
  }

  // Build a plain object view — no HTML escaping (triple-stache semantics for all values)
  const view = Object.fromEntries(configMap);

  // Render using a custom escape that is identity (no HTML encoding)
  writer.escapedValue = (token, context) => {
    const value = context.lookup(token[1]);
    return value == null ? '' : String(value);
  };

  return writer.render(text, view);
}
