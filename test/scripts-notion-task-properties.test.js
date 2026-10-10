import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { buildOptionalSelects, optionalSelectOptions } =
  require(join(here, '..', 'scripts', 'notion', 'lib', 'task-properties.js'));

const select = (...names) => ({ type: 'select', select: { options: names.map(name => ({ name })) } });

// A board with the task-format-v2 properties, and one (today's) without them.
const V2_SCHEMA = {
  Name: { type: 'title', title: {} },
  Type: select('Feature', 'Bug', 'Chore', 'Infra', 'Docs'),
  Appetite: select('S', 'M', 'L'),
  Repo: select('app', 'skills'),
};
const PLAIN_SCHEMA = { Name: { type: 'title', title: {} }, Priority: select('High', 'Medium', 'Low') };

test('fills Type, Appetite and Repo when the board has them', () => {
  const r = buildOptionalSelects(V2_SCHEMA, { type: 'Bug', appetite: 'S', repo: 'skills' });
  assert.equal(r.error, null);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.properties, {
    Type: { select: { name: 'Bug' } },
    Appetite: { select: { name: 'S' } },
    Repo: { select: { name: 'skills' } },
  });
});

test('skips them without an error when the board lacks them', () => {
  const r = buildOptionalSelects(PLAIN_SCHEMA, { type: 'Bug', appetite: 'S', repo: 'skills' });
  assert.equal(r.error, null);
  assert.deepEqual(r.properties, {});
  assert.deepEqual(r.skipped, ['Type', 'Appetite', 'Repo']);
});

test('values the caller did not pass are neither set nor reported', () => {
  const r = buildOptionalSelects(V2_SCHEMA, { type: 'Chore' });
  assert.deepEqual(Object.keys(r.properties), ['Type']);
  assert.deepEqual(r.skipped, []);
});

test('a value outside the board options is an error listing the options', () => {
  const r = buildOptionalSelects(V2_SCHEMA, { repo: 'unknown' });
  assert.match(r.error, /"repo" must be one of: app, skills/);
  assert.deepEqual(r.properties, {});
});

test('a property of the right name but the wrong type counts as absent', () => {
  const r = buildOptionalSelects({ Type: { type: 'rich_text', rich_text: {} } }, { type: 'Bug' });
  assert.deepEqual(r.skipped, ['Type']);
});

test('optionalSelectOptions lists only the properties the board has', () => {
  assert.deepEqual(optionalSelectOptions(V2_SCHEMA), {
    Type: ['Feature', 'Bug', 'Chore', 'Infra', 'Docs'],
    Appetite: ['S', 'M', 'L'],
    Repo: ['app', 'skills'],
  });
  assert.deepEqual(optionalSelectOptions(PLAIN_SCHEMA), {});
  assert.deepEqual(optionalSelectOptions(undefined), {});
});
