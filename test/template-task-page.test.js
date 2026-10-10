import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { CHAR_LIMIT } from '../adapters/windsurf/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = join(here, '..');
const template = readFileSync(join(root, 'templates', 'task-page', 'TEMPLATE.md'), 'utf8');

// templates/task-page is the one canonical description of task format v2; the
// task skills point at it instead of carrying a copy.

test('the task-page template fits in one windsurf file', () => {
  assert.ok(template.length <= CHAR_LIMIT, `${template.length} chars, limit ${CHAR_LIMIT}`);
});

test('the skeleton carries every v2 section, in attention order', () => {
  const skeleton = template.match(/```markdown\n([\s\S]*?)\n```/)[1];
  const headings = skeleton.split('\n').filter(l => l.startsWith('## ')).map(l => [...l.slice(3)][0]);
  assert.deepEqual(headings, ['🎯', '✅', '🌿', '📍', '📋', '🧭', '🕳', '🚫']);
});

test('the skeleton parses as a v2 task with step 0 marked [agent]', () => {
  const { parseTaskSections } = require(join(root, 'scripts', 'notion', 'lib', 'task-sections.js'));
  const skeleton = template.match(/```markdown\n([\s\S]*?)\n```/)[1];
  const s = parseTaskSections(skeleton);
  assert.equal(s.format, 'v2');
  assert.equal(s.steps[0].marker, 'agent');
  assert.match(s.steps[0].text, /Mismatch → report and stop/);
});

const TASK_SKILLS = ['newtask', 'task-decomposer', 'notion-spovishun-task-manager', 'notion-task-board-manager'];

for (const id of TASK_SKILLS) {
  test(`${id} points at the template instead of an English prompt toggle`, () => {
    const body = readFileSync(join(root, 'skills', id, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(body, /🤖 prompt/, 'the v2 format stores no separate prompt');
    assert.match(body, /_templates\/task-page\/TEMPLATE\.md/);
  });
}
