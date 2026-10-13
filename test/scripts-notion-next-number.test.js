import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { nextTaskNumber } = require(join(here, '..', 'scripts', 'notion', 'lib', 'next-task-number.js'));

// Newest first, as get-board.js --next-number fetches them. The bare
// "spovishun-193" title is the one that fell out of the `feature/` pattern and
// used to stop the "first match" rule short.
test('WHEN titles mix feature/<prefix>-N and <prefix>-N THE SYSTEM SHALL return max N + 1', () => {
  const titles = [
    'feature/spovishun-200: Оновити spovishun-skills до 1.33.0',
    'spovishun-193: Вирівняти дефолтний статус задачі',
    'feature/spovishun-201: Формат задач v2',
    'feature/spovishun-199: Щось інше',
  ];
  assert.equal(nextTaskNumber(titles, 'spovishun'), 202);
});

test('a bare-form title can itself be the maximum', () => {
  assert.equal(nextTaskNumber(['feature/spovishun-12: a', 'spovishun-40: b'], 'spovishun'), 41);
});

test('an empty board starts at 1', () => {
  assert.equal(nextTaskNumber([], 'spovishun'), 1);
});

test('titles without a task number yield null — the caller must stop, not guess', () => {
  assert.equal(nextTaskNumber(['Epic notes', 'Some draft'], 'spovishun'), null);
});

test('another project prefix is not counted', () => {
  const titles = ['feature/spovishun-admin-150: x', 'feature/spovishun-7: y', 'feature/shynok-99: z'];
  assert.equal(nextTaskNumber(titles, 'spovishun'), 8);
});

test('the number must lead the title — a mention later in the name does not count', () => {
  assert.equal(nextTaskNumber(['feature/demo-3: follow-up to demo-90'], 'demo'), 4);
});

test('the prefix match is case-insensitive', () => {
  assert.equal(nextTaskNumber(['Feature/Demo-5: x'], 'demo'), 6);
});
