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
  // An unknown type degrades to its text rather than disappearing.
  assert.equal(blockToMd(block('callout')), 'text');
  // A block whose payload is missing renders empty rather than throwing.
  assert.equal(blockToMd({ type: 'unsupported' }), '');
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
