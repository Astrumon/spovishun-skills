import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const lib = join(here, '..', 'scripts', 'notion', 'lib');
const { extractBlocks } = require(join(lib, 'format-task.js'));
const { markdownToBlocks } = require(join(lib, 'markdown-to-blocks.js'));
const { parseTaskSections } = require(join(lib, 'task-sections.js'));

const fixtures = join(here, 'fixtures', 'notion-tasks');
const blocks = name => JSON.parse(readFileSync(join(fixtures, `${name}.blocks.json`), 'utf8'));
const v2Markdown = () => extractBlocks(blocks('v2'));
const legacyMarkdown = () => extractBlocks(blocks('legacy'));

// ── format-task.js renders a v2 page ──────────────────────────────────────────

test('a v2 page renders to the expected markdown (snapshot)', () => {
  const expected = readFileSync(join(fixtures, 'v2.expected.md'), 'utf8');
  assert.equal(v2Markdown() + '\n', expected);
});

test('the v2 render keeps DoD checkboxes, step markers and all three boundary tiers', () => {
  const md = v2Markdown();
  assert.match(md, /^- \[ \] Є один канонічний опис/m);
  assert.match(md, /^- \[x\] WHEN /m);
  assert.match(md, /^1\. \[agent\] /m);
  assert.match(md, /^3\. \[manual\] /m);
  assert.match(md, /^- ✅ Завжди: /m);
  assert.match(md, /^- ⚠️ Спитай: /m);
  assert.match(md, /^- 🚫 Ніколи: /m);
});

test('the v2 render round-trips through markdown-to-blocks with its block types intact', () => {
  const types = markdownToBlocks(v2Markdown()).map(b => b.type);
  assert.deepEqual(types, blocks('v2').map(b => b.type));
});

// ── parseTaskSections: v2 ─────────────────────────────────────────────────────

test('a v2 page parses as format v2 with every section', () => {
  const s = parseTaskSections(v2Markdown());
  assert.equal(s.format, 'v2');
  assert.equal(s.legacyPrompt, null);
  assert.match(s.why, /^Задачі зараз пишуться двічі/);
  assert.equal(s.branch, 'feature/project-201-task-template-v2');
  assert.match(s.context, /get-board\.js/);
  assert.match(s.pitfalls, /Номер парситься з Name/);
  assert.match(s.outOfScope, /unique_id/);
});

test('v2 DoD items keep their checked state', () => {
  const { dod } = parseTaskSections(v2Markdown());
  assert.deepEqual(dod.map(d => d.checked), [false, true, false]);
  assert.match(dod[1].text, /^WHEN .+ THE SYSTEM SHALL /);
});

test('v2 steps carry their [agent] / [manual] marker, stripped from the text', () => {
  const { steps } = parseTaskSections(v2Markdown());
  assert.deepEqual(steps.map(s => [s.n, s.marker]), [[1, 'agent'], [2, 'agent'], [3, 'manual']]);
  assert.match(steps[0].text, /^Звірити з кодом/);
});

test('v2 boundaries split into always / ask / never without their labels', () => {
  const { boundaries } = parseTaskSections(v2Markdown());
  assert.match(boundaries.always[0], /^правки лише в spovishun-skills/);
  assert.match(boundaries.ask[0], /^перед зміною формату Name/);
  assert.match(boundaries.never[0], /^ручні правки \.claude\//);
});

test('markers escaped by Notion-flavoured markdown are still recognised', () => {
  const s = parseTaskSections('## 📋 Кроки\n1. \\[agent\\] a\n2. \\[manual\\] b\n');
  assert.deepEqual(s.steps.map(x => x.marker), ['agent', 'manual']);
  assert.equal(s.format, 'v2');
});

test('English boundary labels are recognised too', () => {
  const s = parseTaskSections('## 🧭 Boundaries\n- Always: x\n- Ask first: y\n- Never: z\n');
  assert.deepEqual(s.boundaries, { always: ['x'], ask: ['y'], never: ['z'] });
});

// ── parseTaskSections: legacy (modelled on a real pre-v2 task) ────────────────

test('a legacy page parses as legacy and keeps the toggle prompt, unfenced', () => {
  const s = parseTaskSections(legacyMarkdown());
  assert.equal(s.format, 'legacy');
  assert.match(s.legacyPrompt, /^Fix a live coroutine cancellation bug/);
  assert.doesNotMatch(s.legacyPrompt, /```/);
});

test('legacy Goal / Branch name / Steps / DoD are read through the shared emoji', () => {
  const s = parseTaskSections(legacyMarkdown());
  assert.match(s.why, /^Хотфікс/);
  assert.equal(s.branch, 'feature/project-190-swallowed-cancellation-schedulers');
  assert.equal(s.steps.length, 3);
  assert.ok(s.steps.every(step => step.marker === null));
  assert.doesNotMatch(s.steps[2].text, /---/, 'the divider after a section must not join its last item');
  assert.deepEqual(s.dod.map(d => d.checked), [true, false, false]);
});

test('a legacy prompt under a "## 🤖" heading is read the same as a toggle', () => {
  const md = '## 🎯 Мета\ng\n\n## 🤖 Промпт для агента\n```plain text\nDo the thing.\n```\n';
  const s = parseTaskSections(md);
  assert.equal(s.format, 'legacy');
  assert.equal(s.legacyPrompt, 'Do the thing.');
});

test('a legacy prose DoD becomes unchecked items', () => {
  const s = parseTaskSections('## ✅ Definition of Done\n> It works and tests are green.\n');
  assert.deepEqual(s.dod, [{ text: 'It works and tests are green.', checked: false }]);
});

test('an empty body parses without throwing', () => {
  const s = parseTaskSections('');
  assert.equal(s.format, 'legacy');
  assert.deepEqual(s.steps, []);
});
