import { readFileSync } from 'node:fs';
import { load as parseYaml, CORE_SCHEMA } from 'js-yaml';
import { ConfigError } from './errors.js';
import { validateConfig } from './config-validator.js';

/**
 * Reads, parses, and validates spovishun-skills.config.yaml.
 * Throws ConfigError on any failure.
 * @param {string} filePath  — absolute or cwd-relative path to config.yaml
 * @returns {object}          — validated config object
 */
export function loadConfig(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      `Cannot read config file at ${filePath}: ${err.message}`,
      'Run `npx spovishun-skills init` to create spovishun-skills.config.yaml.'
    );
  }

  let parsed;
  try {
    parsed = parseYaml(raw, { schema: CORE_SCHEMA });
  } catch (err) {
    throw new ConfigError(
      'INVALID_YAML',
      `Cannot parse YAML at ${filePath}: ${err.message}`,
      `Fix the syntax error and try again. Parser message:\n  ${err.message}`
    );
  }

  validateConfig(parsed);
  return parsed;
}
