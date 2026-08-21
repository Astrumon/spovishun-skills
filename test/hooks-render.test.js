import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// The two rendering leaves: Notion blocks → markdown (notion-blocks.js) and
// markdown → the UserPromptSubmit payload Claude reads (hook-output.js).
// Every string these produce is an output contract.
const { richText, blockToMd, extractBlocks, visibleBlocks } =
  require(join(here, '..', 'hooks', 'notion-blocks.js'));
const { buildSystemPrompt, outputPrompt } = require(join(here, '..', 'hooks', 'hook-output.js'));

const block = (type, extra = {}) => ({ type, [type]: { rich_text: [{ plain_text: 'text' }], ...extra } });

// ─── notion-blocks ────────────────────────────────────────────────────────────

test('richText joins the plain_text runs of a rich-text array', () => {
  assert.equal(richText([{ plain_text: 'a' }, { plain_text: 'b' }]), 'ab');
  assert.equal(richText([]), '');
  assert.equal(richText(null), '', 'a block with no rich_text must not throw');
});

test('blockToMd renders the common Notion block types', () => {
  const para = { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'hello' }] } };
  const h2 = { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Goal' }] } };
  const todo = { type: 'to_do', to_do: { checked: true, rich_text: [{ plain_text: 'done it' }] } };
  assert.equal(blockToMd(para), 'hello');
  assert.equal(blockToMd(h2), '## Goal');
  assert.equal(blockToMd(todo), '- [x] done it');
});

test('blockToMd covers every type the task template uses', () => {
  assert.equal(blockToMd(block('heading_1')), '# text');
  assert.equal(blockToMd(block('heading_3')), '### text');
  assert.equal(blockToMd(block('bulleted_list_item')), '- text');
  assert.equal(blockToMd(block('numbered_list_item')), '1. text');
  assert.equal(blockToMd(block('to_do', { checked: false })), '- [ ] text');
  assert.equal(blockToMd(block('code')), '```\ntext\n```');
  assert.equal(blockToMd({ type: 'divider', divider: {} }), '---');
  assert.equal(blockToMd(block('quote')), '> text');
  // An unknown type degrades to its text rather than disappearing.
  assert.equal(blockToMd(block('bookmark')), 'text');
  // A block whose payload is missing renders empty rather than throwing.
  assert.equal(blockToMd({ type: 'unsupported' }), '');
});

test('callout renders its emoji icon and nested children inside the quote', () => {
  const callout = {
    type: 'callout',
    callout: { rich_text: [{ plain_text: 'Heads up' }], icon: { type: 'emoji', emoji: '🔍' } },
    children: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'detail' }] } }],
  };
  assert.equal(blockToMd(callout), '> 🔍 Heads up\n> detail');
  // No children → no dangling quote marker.
  assert.equal(blockToMd({ type: 'callout', callout: callout.callout }), '> 🔍 Heads up');
});

// The whole point of spovishun-185: newtask puts the agent prompt inside a
// toggle, notion-task-to-code reads it out of the cached task.json, and before
// this the body was never rendered at all.
test('toggle renders its children as a <details> body', () => {
  const toggle = {
    type: 'toggle',
    toggle: { rich_text: [{ plain_text: '🤖 prompt' }] },
    children: [
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Context.' }] } },
      { type: 'numbered_list_item', numbered_list_item: { rich_text: [{ plain_text: 'Extend it.' }] } },
    ],
  };
  assert.equal(
    blockToMd(toggle),
    '<details>\n<summary>🤖 prompt</summary>\n\nContext.\n1. Extend it.\n\n</details>'
  );
});

test('nested list children are indented under their parent item', () => {
  const item = {
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ plain_text: 'parent' }] },
    children: [{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'child' }] } }],
  };
  assert.equal(blockToMd(item), '- parent\n  - child');
});

test('table renders its table_row children as markdown pipe rows', () => {
  const table = {
    type: 'table',
    table: { table_width: 2, has_column_header: true },
    children: [
      { type: 'table_row', table_row: { cells: [[{ plain_text: 'A' }], [{ plain_text: 'B' }]] } },
      { type: 'table_row', table_row: { cells: [[{ plain_text: '1' }], [{ plain_text: '2' }]] } },
    ],
  };
  assert.equal(blockToMd(table), '| A | B |\n| 1 | 2 |');
});

test('extractBlocks joins rendered blocks and drops the empty ones', () => {
  const blocks = [block('heading_2'), { type: 'unsupported' }, block('paragraph')];
  assert.equal(extractBlocks(blocks), '## text\ntext');
});

test('visibleBlocks removes toggles — collapsed template scaffolding', () => {
  const blocks = [block('paragraph'), block('toggle'), block('heading_2')];
  assert.deepEqual(visibleBlocks(blocks).map((b) => b.type), ['paragraph', 'heading_2']);
});

// ─── hook-output ──────────────────────────────────────────────────────────────

test('buildSystemPrompt: grillFirst + no plan instructs grill-me before EnterPlanMode', () => {
  const prompt = buildSystemPrompt('## context', null, null, true, true);
  assert.match(prompt, /Invoke the `grill-me` skill/);
  assert.doesNotMatch(prompt, /You MUST call the EnterPlanMode tool immediately/);
});

test('buildSystemPrompt: isStartTask without grillFirst keeps the default EnterPlanMode instruction', () => {
  const prompt = buildSystemPrompt('## context', null, null, true, false);
  assert.match(prompt, /You MUST call the EnterPlanMode tool immediately/);
  assert.doesNotMatch(prompt, /grill-me/);
});

test('buildSystemPrompt: an approved plan wins over grillFirst (nothing left to grill)', () => {
  const prompt = buildSystemPrompt('## context', '## Approved Plan', null, true, true);
  assert.match(prompt, /Plan already approved\. Proceed directly with implementation/);
  assert.doesNotMatch(prompt, /grill-me/);
});

test('buildSystemPrompt: a plain injection tells Claude to stay in scope', () => {
  const prompt = buildSystemPrompt('## context', null, null, false);
  assert.match(prompt, /\*Work within the scope of this task\./);
  assert.doesNotMatch(prompt, /EnterPlanMode/);
});

test('buildSystemPrompt: the plan and branch note are appended in order', () => {
  const prompt = buildSystemPrompt('## context', 'the plan', '\n> a note', false);
  const [contextAt, planAt, noteAt] = ['## context', '## Approved Plan', '> a note'].map((s) => prompt.indexOf(s));
  assert.ok(contextAt < planAt && planAt < noteAt, prompt);
});

test('outputPrompt emits the UserPromptSubmit envelope Claude reads', () => {
  const written = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (chunk) => { written.push(String(chunk)); return true; };
  try {
    outputPrompt('## body');
  } finally {
    process.stdout.write = realWrite;
  }
  assert.deepEqual(JSON.parse(written.join('')), {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '## body' },
  });
});
