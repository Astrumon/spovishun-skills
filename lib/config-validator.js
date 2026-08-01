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
 *
 * EVERY missing key is reported in one throw. Ajv already collects them all, and
 * surfacing them one at a time made a config with three absent `git.*` keys cost
 * three sequential `install` runs to diagnose.
 *
 * @param {unknown} config
 */
export function validateConfig(config) {
  const ok = validate(config);
  if (ok) return;

  const errors = validate.errors ?? [];

  const missing = errors
    .filter((e) => e.keyword === 'required')
    .map((e) => dotPath(e.instancePath, e.params.missingProperty));

  if (missing.length > 0) {
    throw new ConfigError('MISSING_REQUIRED', missingMessage(missing), buildMissingHints(missing));
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

/**
 * Ajv reports a missing key as instancePath "/git" + missingProperty
 * "main_branch". Join them the way the config file reads: `git.main_branch`.
 */
function dotPath(instancePath, key) {
  const parent = instancePath.replace(/^\//, '').replace(/\//g, '.');
  return parent ? `${parent}.${key}` : key;
}

/**
 * One missing key keeps the original single-line wording; more than one gets a
 * list, because that is the case the one-at-a-time reporting made expensive.
 */
function missingMessage(paths) {
  if (paths.length === 1) {
    return `Missing required key \`${paths[0]}\` in spovishun-skills.config.yaml.`;
  }
  const list = paths.map((p) => `  - ${p}`).join('\n');
  return `Missing ${paths.length} required keys in spovishun-skills.config.yaml:\n${list}`;
}

/**
 * One hint covering every missing key. A single key keeps the original wording
 * verbatim; several are grouped by section so the user sees one YAML block to
 * paste per section, instead of the same header and init line repeated per key.
 */
function buildMissingHints(paths) {
  if (paths.length === 1) return buildMissingHint(paths[0]);

  // notion.* keys are conditional on stack.notion and carry their own advice
  // (including the option of just turning the flag off), so they stay separate.
  const conditional = paths.filter(isNotionConditional);
  const plain = paths.filter((p) => !isNotionConditional(p));

  const blocks = conditional.map(buildMissingHint);
  if (plain.length > 0) {
    const bySection = new Map();
    for (const path of plain) {
      const { section, leafKey } = splitPath(path);
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push(leafKey);
    }
    for (const [section, keys] of bySection) {
      blocks.push(`Add under \`${section}:\` section:\n${keys.map((k) => `  ${k}: "<value>"`).join('\n')}`);
    }
    blocks.push('Run `npx spovishun-skills init` to regenerate.');
  }
  return blocks.join('\n\n');
}

const isNotionConditional = (dotPath) => dotPath.startsWith('notion.');

function splitPath(dotPath) {
  const [section, ...rest] = dotPath.split('.');
  return { section, leafKey: rest.join('.') || section };
}

function buildMissingHint(dotPath) {
  if (isNotionConditional(dotPath)) {
    return (
      `\`${dotPath}\` is required when \`stack.notion\` is true.\n` +
      `Either set \`stack.notion: false\`, or add to your config:\n` +
      `  notion:\n` +
      `    ${dotPath.split('.').slice(1).join('.')}: "<value>"`
    );
  }
  const { section, leafKey } = splitPath(dotPath);
  return (
    `Add under \`${section}:\` section:\n` +
    `  ${leafKey}: "<value>"\n` +
    `Run \`npx spovishun-skills init\` to regenerate.`
  );
}
