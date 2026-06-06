import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { markdownToBlocks, MAX_RICH_TEXT_LEN } = require(
  join(here, '..', 'scripts', 'notion', 'lib', 'markdown-to-blocks.js')
);

// ─── Smoke ───────────────────────────────────────────────────────────────────

test('empty / whitespace input returns []', () => {
  assert.deepEqual(markdownToBlocks(''), []);
  assert.deepEqual(markdownToBlocks('   \n  '), []);
  assert.deepEqual(markdownToBlocks(undefined), []);
});

// ─── Block types ─────────────────────────────────────────────────────────────

test('headings level 1-3 map to heading_1/2/3', () => {
  const blocks = markdownToBlocks('# H1\n\n## H2\n\n### H3');
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].type, 'heading_1');
  assert.equal(blocks[1].type, 'heading_2');
  assert.equal(blocks[2].type, 'heading_3');
  assert.equal(blocks[0].heading_1.rich_text[0].plain_text, 'H1');
});

test('headings level 4+ collapse to heading_3 (Notion does not expose deeper levels)', () => {
  const blocks = markdownToBlocks('#### H4\n##### H5');
  for (const b of blocks) assert.equal(b.type, 'heading_3');
});

test('paragraph carries inline bold/italic/code/strike/link annotations', () => {
  const blocks = markdownToBlocks(
    'Plain **bold** _ital_ `code` ~~strike~~ [link](http://x).'
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  const rt = blocks[0].paragraph.rich_text;
  const byContent = Object.fromEntries(rt.map(s => [s.plain_text, s.annotations]));
  assert.equal(byContent['bold'].bold, true);
  assert.equal(byContent['ital'].italic, true);
  assert.equal(byContent['code'].code, true);
  assert.equal(byContent['strike'].strikethrough, true);
  const linkSeg = rt.find(s => s.plain_text === 'link');
  assert.equal(linkSeg.href, 'http://x');
  assert.equal(linkSeg.text.link.url, 'http://x');
});

test('bulleted list each item is a bulleted_list_item block', () => {
  const blocks = markdownToBlocks('- one\n- two\n- three');
  assert.equal(blocks.length, 3);
  for (const b of blocks) assert.equal(b.type, 'bulleted_list_item');
  assert.equal(blocks[0].bulleted_list_item.rich_text[0].plain_text, 'one');
});

test('numbered list maps to numbered_list_item', () => {
  const blocks = markdownToBlocks('1. one\n2. two');
  assert.equal(blocks.length, 2);
  for (const b of blocks) assert.equal(b.type, 'numbered_list_item');
});

test('nested list becomes a child of the parent list item', () => {
  const blocks = markdownToBlocks('- outer\n  - inner');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'bulleted_list_item');
  const children = blocks[0].bulleted_list_item.children;
  assert.ok(Array.isArray(children) && children.length === 1);
  assert.equal(children[0].type, 'bulleted_list_item');
  assert.equal(children[0].bulleted_list_item.rich_text[0].plain_text, 'inner');
});

test('task list items become to_do blocks with `checked` reflecting the source', () => {
  const blocks = markdownToBlocks('- [ ] todo\n- [x] done');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, 'to_do');
  assert.equal(blocks[0].to_do.checked, false);
  assert.equal(blocks[1].to_do.checked, true);
});

test('fenced code block carries language + content', () => {
  const blocks = markdownToBlocks('```js\nconst x = 1;\n```');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].code.language, 'javascript');
  assert.equal(blocks[0].code.rich_text[0].plain_text, 'const x = 1;');
});

test('code block with unknown language falls back to "plain text"', () => {
  const blocks = markdownToBlocks('```nosuchlang\nbody\n```');
  assert.equal(blocks[0].code.language, 'plain text');
});

test('code block with no language fence falls back to "plain text"', () => {
  const blocks = markdownToBlocks('```\nplain body\n```');
  assert.equal(blocks[0].code.language, 'plain text');
});

test('horizontal rule maps to a divider block', () => {
  const blocks = markdownToBlocks('Above\n\n---\n\nBelow');
  assert.equal(blocks.length, 3);
  assert.equal(blocks[1].type, 'divider');
});

test('blockquote without an alert label becomes a quote block', () => {
  const blocks = markdownToBlocks('> quoted line one\n> line two');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'quote');
  const t = blocks[0].quote.rich_text.map(s => s.plain_text).join('');
  assert.ok(t.includes('quoted line one'));
  assert.ok(t.includes('line two'));
});

test('GitHub alert > [!NOTE] becomes a callout with info emoji + blue bg', () => {
  const blocks = markdownToBlocks('> [!NOTE]\n> A note.');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'callout');
  assert.equal(blocks[0].callout.icon.emoji, 'ℹ️');
  assert.equal(blocks[0].callout.color, 'blue_background');
  assert.equal(blocks[0].callout.rich_text[0].plain_text, 'A note.');
});

test('GitHub alert > [!WARNING] uses warning emoji + yellow bg', () => {
  const blocks = markdownToBlocks('> [!WARNING]\n> Be careful.');
  assert.equal(blocks[0].callout.icon.emoji, '⚠️');
  assert.equal(blocks[0].callout.color, 'yellow_background');
});

test('all five GitHub alert variants are recognised case-insensitively', () => {
  for (const v of ['note', 'TIP', 'Important', 'WARNING', 'caution']) {
    const blocks = markdownToBlocks(`> [!${v}]\n> body`);
    assert.equal(blocks[0]?.type, 'callout', `variant ${v} should produce a callout`);
  }
});

test('table maps to a table block with header row + data rows + correct width', () => {
  const blocks = markdownToBlocks(
    '| h1 | h2 |\n|----|----|\n| a  | b  |\n| c  | d  |'
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'table');
  assert.equal(blocks[0].table.table_width, 2);
  assert.equal(blocks[0].table.has_column_header, true);
  const rows = blocks[0].table.children;
  assert.equal(rows.length, 3); // header + 2 data
  assert.equal(rows[0].type, 'table_row');
  assert.equal(rows[0].table_row.cells[0][0].plain_text, 'h1');
  assert.equal(rows[2].table_row.cells[1][0].plain_text, 'd');
});

test('<details><summary>X</summary>...</details> becomes a toggle with the inner blocks as children', () => {
  const md = [
    '<details>',
    '<summary>My Toggle</summary>',
    '',
    'Para inside.',
    '',
    '- bullet inside',
    '',
    '</details>',
  ].join('\n');
  const blocks = markdownToBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'toggle');
  assert.equal(blocks[0].toggle.rich_text[0].plain_text, 'My Toggle');
  const children = blocks[0].toggle.children;
  assert.ok(Array.isArray(children));
  const types = children.map(c => c.type);
  assert.ok(types.includes('paragraph'));
  assert.ok(types.includes('bulleted_list_item'));
});

test('toggle without a closing tag is tolerated (greedy collect to end)', () => {
  const md = '<details>\n<summary>Open</summary>\n\nLone content.';
  const blocks = markdownToBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'toggle');
  assert.equal(blocks[0].toggle.children[0].type, 'paragraph');
});

// ─── Chunking ────────────────────────────────────────────────────────────────

test('paragraph rich_text longer than MAX_RICH_TEXT_LEN is split into multiple segments', () => {
  const long = 'a'.repeat(MAX_RICH_TEXT_LEN * 2 + 50);
  const blocks = markdownToBlocks(long);
  assert.equal(blocks.length, 1);
  const rt = blocks[0].paragraph.rich_text;
  assert.equal(rt.length, 3, 'expected 3 segments for 2*MAX + 50 chars');
  for (const seg of rt) assert.ok(seg.text.content.length <= MAX_RICH_TEXT_LEN);
  const reassembled = rt.map(s => s.text.content).join('');
  assert.equal(reassembled, long);
});

test('code block rich_text is also chunked at the 2000-char limit', () => {
  const longCode = 'x'.repeat(MAX_RICH_TEXT_LEN + 10);
  const blocks = markdownToBlocks('```\n' + longCode + '\n```');
  assert.equal(blocks[0].type, 'code');
  assert.ok(blocks[0].code.rich_text.length >= 2);
  for (const seg of blocks[0].code.rich_text) {
    assert.ok(seg.text.content.length <= MAX_RICH_TEXT_LEN);
  }
});

// ─── Realistic 5-section newtask body ────────────────────────────────────────

test('a full newtask 5-section body produces the expected mix of blocks (smoke)', () => {
  const md = [
    '## 🎯 Goal',
    'Implement the foo widget so users can bar.',
    '',
    '## 🌿 Branch name',
    'feature/proj-42-foo-widget',
    '',
    '## 📋 Steps',
    '1. Add the data model.',
    '2. Wire the UI.',
    '3. Write tests.',
    '',
    '## ✅ Definition of Done',
    '- [ ] Tests pass',
    '- [ ] No lint warnings',
    '',
    '<details>',
    '<summary>🤖 prompt</summary>',
    '',
    'You are implementing a feature. Tech stack: Kotlin.',
    '',
    '```kotlin',
    'fun bar() = "baz"',
    '```',
    '',
    '</details>',
  ].join('\n');
  const blocks = markdownToBlocks(md);
  const types = blocks.map(b => b.type);

  // No silent drops: every heading + the toggle made it through.
  assert.equal(types.filter(t => t === 'heading_2').length, 4);
  assert.ok(types.includes('numbered_list_item'));
  assert.ok(types.includes('to_do'));
  assert.ok(types.includes('toggle'));

  // The toggle contains the code block as a child with the right language.
  const toggle = blocks.find(b => b.type === 'toggle');
  const childTypes = toggle.toggle.children.map(c => c.type);
  assert.ok(childTypes.includes('code'));
  const code = toggle.toggle.children.find(c => c.type === 'code');
  assert.equal(code.code.language, 'kotlin');
});

// ─── No raw HTML / no silent drops ───────────────────────────────────────────

test('unknown raw HTML survives as a paragraph (never silently dropped)', () => {
  const blocks = markdownToBlocks('<div class="x">hi</div>');
  assert.ok(blocks.length >= 1);
  // Some token shape must carry the raw HTML text.
  const reassembled = JSON.stringify(blocks);
  assert.ok(reassembled.includes('hi'), 'inner text "hi" must reach the output');
});
