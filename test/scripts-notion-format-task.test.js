import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = join(here, '..', 'scripts', 'notion', 'lib');
const { extractBlocks, richText } = require(join(root, 'format-task.js'));
const { markdownToBlocks } = require(join(root, 'markdown-to-blocks.js'));

// extractBlocks is pure: it walks a tree block-tree.js has already hydrated, so
// every case here is a plain fixture with no HTTP in sight.

const rt = text => [{ plain_text: text }];
const block = (type, payload = {}, children) => ({
  type,
  [type]: { rich_text: rt(payload.text ?? 'text'), ...payload },
  ...(children ? { children } : {}),
});

test('richText joins and trims the plain_text runs', () => {
  assert.equal(richText([{ plain_text: ' a' }, { plain_text: 'b ' }]), 'ab');
  assert.equal(richText(undefined), '');
});

test('headings keep their leading blank line — section-parser slices on it', () => {
  const out = extractBlocks([
    block('paragraph', { text: 'intro' }),
    block('heading_2', { text: 'Goal' }),
    block('paragraph', { text: 'body' }),
  ]);
  assert.equal(out, 'intro\n\n## Goal\nbody');
});

// The defect this task exists for: format-task.js:22 collapsed both list types
// into a dash, which destroyed step ordering in the Steps section of every task.
test('numbered list items keep their ordinals instead of becoming dashes', () => {
  const out = extractBlocks([
    block('numbered_list_item', { text: 'First' }),
    block('numbered_list_item', { text: 'Second' }),
    block('numbered_list_item', { text: 'Third' }),
  ]);
  assert.equal(out, '1. First\n2. Second\n3. Third');
});

test('an ordinal run restarts after a non-numbered sibling', () => {
  const out = extractBlocks([
    block('numbered_list_item', { text: 'One' }),
    block('paragraph', { text: 'break' }),
    block('numbered_list_item', { text: 'One again' }),
  ]);
  assert.equal(out, '1. One\nbreak\n1. One again');
});

test('bulleted list items stay dashes and nest their children', () => {
  const out = extractBlocks([
    block('bulleted_list_item', { text: 'parent' }, [block('bulleted_list_item', { text: 'child' })]),
  ]);
  assert.equal(out, '- parent\n  - child');
});

test('to_do renders its checkbox state', () => {
  assert.equal(extractBlocks([block('to_do', { text: 'done', checked: true })]), '- [x] done');
  assert.equal(extractBlocks([block('to_do', { text: 'open', checked: false })]), '- [ ] open');
});

test('code blocks are fenced with their language; "plain text" carries no info string', () => {
  assert.equal(
    extractBlocks([block('code', { text: 'val x = 1', language: 'kotlin' })]),
    '```kotlin\nval x = 1\n```'
  );
  assert.equal(
    extractBlocks([block('code', { text: 'hi', language: 'plain text' })]),
    '```\nhi\n```'
  );
});

test('divider renders as a thematic break separated from its neighbours', () => {
  const out = extractBlocks([
    block('paragraph', { text: 'above' }),
    { type: 'divider', divider: {} },
    block('paragraph', { text: 'below' }),
  ]);
  // The blank lines matter: `above\n---` would be a setext heading, not a rule.
  assert.equal(out, 'above\n\n---\n\nbelow');
});

test('callout carries its emoji icon and nests children inside the quote', () => {
  const out = extractBlocks([
    block('callout', { text: 'Heads up', icon: { type: 'emoji', emoji: '🔍' } }, [
      block('paragraph', { text: 'detail' }),
    ]),
  ]);
  assert.equal(out, '> 🔍 Heads up\n> detail');
});

test('a non-emoji callout icon is omitted rather than rendered as [object Object]', () => {
  const out = extractBlocks([
    block('callout', { text: 'plain', icon: { type: 'file', file: { url: 'http://x' } } }),
  ]);
  assert.equal(out, '> plain');
});

test('quote renders every line inside the blockquote', () => {
  assert.equal(extractBlocks([block('quote', { text: 'a\nb' })]), '> a\n> b');
});

test('table renders as a markdown pipe table with a header separator', () => {
  const out = extractBlocks([
    block('table', { text: '', table_width: 2, has_column_header: true }, [
      { type: 'table_row', table_row: { cells: [rt('A'), rt('B')] } },
      { type: 'table_row', table_row: { cells: [rt('1'), rt('2')] } },
    ]),
  ]);
  assert.equal(out, '| A | B |\n| --- | --- |\n| 1 | 2 |');
});

test('a headerless table gets an empty header row rather than losing its first row', () => {
  const out = extractBlocks([
    block('table', { text: '', table_width: 2, has_column_header: false }, [
      { type: 'table_row', table_row: { cells: [rt('1'), rt('2')] } },
    ]),
  ]);
  assert.equal(out, '|  |  |\n| --- | --- |\n| 1 | 2 |');
});

// The reason spovishun-185 exists: newtask mandates the agent prompt live in a
// toggle, and the reader dropped it, so notion-task-to-code built a prompt with
// no prompt in it.
test('toggle renders as <details> with its body — the 🤖 prompt case', () => {
  const out = extractBlocks([
    block('toggle', { text: '🤖 prompt' }, [
      block('paragraph', { text: 'Context. Make the reader match the writer.' }),
      block('numbered_list_item', { text: 'Extend extractBlocks.' }),
      block('numbered_list_item', { text: 'Split the list types.' }),
    ]),
  ]);
  assert.equal(
    out,
    '<details>\n<summary>🤖 prompt</summary>\n\n' +
    'Context. Make the reader match the writer.\n' +
    '1. Extend extractBlocks.\n2. Split the list types.\n\n</details>'
  );
});

test('an unhydrated tree (no children fetched) still renders the top level', () => {
  // get-claude-md.js calls extractBlocks on a flat one-level list; it must not
  // start throwing because children are absent.
  const out = extractBlocks([block('toggle', { text: 'summary only' })]);
  assert.ok(out.includes('<summary>summary only</summary>'));
});

test('an unknown block type degrades to its text instead of vanishing', () => {
  assert.equal(extractBlocks([block('bookmark', { text: 'https://example.com' })]), 'https://example.com');
  assert.equal(extractBlocks([{ type: 'unsupported' }]), '');
  assert.equal(extractBlocks(undefined), '');
});

// The reader and the writer are two halves of one contract; this is the assert
// that keeps them from drifting apart again.
test('round trip: reader output feeds back through markdown-to-blocks as the same blocks', () => {
  const source = [
    block('heading_2', { text: '📋 Steps' }),
    block('numbered_list_item', { text: 'First' }),
    block('numbered_list_item', { text: 'Second' }),
    { type: 'divider', divider: {} },
    block('code', { text: 'npm test', language: 'bash' }),
    block('toggle', { text: '🤖 prompt' }, [block('paragraph', { text: 'Do the thing.' })]),
  ];

  const reparsed = markdownToBlocks(extractBlocks(source));

  assert.deepEqual(
    reparsed.map(b => b.type),
    ['heading_2', 'numbered_list_item', 'numbered_list_item', 'divider', 'code', 'toggle']
  );
  const toggle = reparsed.at(-1);
  assert.equal(toggle.toggle.rich_text[0].plain_text, '🤖 prompt');
  assert.equal(toggle.toggle.children[0].paragraph.rich_text[0].plain_text, 'Do the thing.');
});
