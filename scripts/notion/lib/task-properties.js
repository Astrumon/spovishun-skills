'use strict';

// Optional task properties of format v2 (templates/task-page). A board may or
// may not have them — Spovishun added them by hand, other consumers never will —
// so nothing here hardcodes an option list: the board's own schema
// (GET /v1/databases/{id} → `properties`) is the only source.

const OPTIONAL_SELECTS = { type: 'Type', appetite: 'Appetite', repo: 'Repo' };

/** The select options of every optional property the board actually has. */
function optionalSelectOptions(schemaProps) {
  const out = {};
  for (const name of Object.values(OPTIONAL_SELECTS)) {
    const prop = schemaProps?.[name];
    if (prop?.type === 'select') out[name] = (prop.select?.options || []).map(o => o.name);
  }
  return out;
}

/**
 * Builds the Notion `properties` entries for the optional selects the caller
 * asked for. A property the board lacks is skipped (listed in `skipped`), so
 * one skill works on every board. A value outside the board's options is an
 * error — Notion would silently create the option otherwise.
 *
 * @param {object} schemaProps database `properties` from the Notion API
 * @param {{type?: string, appetite?: string, repo?: string}} values
 * @returns {{properties: object, skipped: string[], error: string|null}}
 */
function buildOptionalSelects(schemaProps, values) {
  const options = optionalSelectOptions(schemaProps);
  const properties = {};
  const skipped = [];
  for (const [key, name] of Object.entries(OPTIONAL_SELECTS)) {
    const value = values?.[key];
    if (value === undefined || value === null) continue;
    if (!options[name]) { skipped.push(name); continue; }
    if (!options[name].includes(value)) {
      return { properties: {}, skipped, error: `"${key}" must be one of: ${options[name].join(', ')}` };
    }
    properties[name] = { select: { name: value } };
  }
  return { properties, skipped, error: null };
}

module.exports = { OPTIONAL_SELECTS, optionalSelectOptions, buildOptionalSelects };
