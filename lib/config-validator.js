import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAjv } from './ajv.js';
import { ConfigError } from './errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'schema', 'config.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const validate = createAjv().compile(schema);

/**
 * Validates a parsed config object against config.schema.json.
 * Throws ConfigError with an actionable hint on failure.
 * @param {unknown} config
 */
export function validateConfig(config) {
  const ok = validate(config);
  if (ok) return;

  const errors = validate.errors ?? [];

  // Surface the first meaningful error with an actionable hint.
  for (const e of errors) {
    if (e.keyword === 'required') {
      const key = e.params.missingProperty;
      const path = e.instancePath ? `${e.instancePath}.${key}` : key;
      throw new ConfigError(
        'MISSING_REQUIRED',
        `Missing required key \`${path}\` in spovishun-skills.config.yaml.`,
        buildMissingHint(path)
      );
    }
  }

  // Fallback: use the first ajv error
  const first = errors[0];
  const path = first.instancePath.replace(/^\//, '').replace(/\//g, '.') || '(root)';
  const isNotionConditional =
    first.keyword === 'then' ||
    (first.instancePath || '').includes('notion');

  if (isNotionConditional) {
    throw new ConfigError(
      'SCHEMA_VIOLATION',
      `Config validation failed at \`${path}\`: ${first.message}.`,
      'If `stack.notion` is true, add the `notion:` section with `token_env`, `database_id`, and `epics_database_id`.\n' +
      'Or set `stack.notion: false` to disable Notion integration.'
    );
  }

  throw new ConfigError(
    'SCHEMA_VIOLATION',
    `Config validation failed at \`${path}\`: ${first.message}.`,
    `Check spovishun-skills.config.yaml at \`${path}\`. Run \`npx spovishun-skills init\` to regenerate.`
  );
}

function buildMissingHint(dotPath) {
  const notionConditional = dotPath.startsWith('notion.');
  if (notionConditional) {
    return (
      `\`${dotPath}\` is required when \`stack.notion\` is true.\n` +
      `Either set \`stack.notion: false\`, or add to your config:\n` +
      `  notion:\n` +
      `    ${dotPath.split('.').slice(1).join('.')}: "<value>"`
    );
  }
  const [section, ...rest] = dotPath.split('.');
  const leafKey = rest.join('.') || section;
  return (
    `Add under \`${section}:\` section:\n` +
    `  ${leafKey}: "<value>"\n` +
    `Run \`npx spovishun-skills init\` to regenerate.`
  );
}
