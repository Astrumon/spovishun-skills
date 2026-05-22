import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'schema', 'manifest.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addFormat('semver', /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

const validate = ajv.compile(schema);

/**
 * @param {unknown} manifest - parsed YAML/JSON object
 * @returns {{ ok: true } | { ok: false, errors: Array<{ path: string, message: string, value: unknown }> }}
 */
export function validateManifest(manifest) {
  const ok = validate(manifest);
  if (ok) return { ok: true };
  const errors = (validate.errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: humanize(e),
    value: e.data
  }));
  return { ok: false, errors };
}

function humanize(err) {
  switch (err.keyword) {
    case 'required':
      return `Missing required field: "${err.params.missingProperty}"`;
    case 'enum':
      return `Must be one of: ${err.params.allowedValues.join(', ')}`;
    case 'pattern':
      return `Value does not match pattern ${err.params.pattern}`;
    case 'format':
      return `Invalid ${err.params.format} value`;
    case 'unevaluatedProperties':
      return `Unknown field: "${err.params.unevaluatedProperty}" (typo?)`;
    case 'not':
      return `Forbidden field for this category`;
    default:
      return err.message ?? 'Invalid value';
  }
}
