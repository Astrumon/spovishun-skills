import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = join(here, '..', 'scripts', 'notion');

// get-claude-md.js is CommonJS and only invokes main() behind a
// `require.main === module` guard, so requiring it here runs nothing. The tests
// drive loadContent() with a plain callback — no HTTP mock, no token, no cache —
// the same way test/scripts-notion-block-tree.test.js drives the walker.
const { loadContent, parseArgs, CACHE_KEY } = require(join(root, 'get-claude-md.js'));
const { extractSection } = require(join(root, 'lib', 'section-parser.js'));

/** getChildrenPage over a `{ blockId: [pages] }` map; records every call. */
function fakeFetcher(pagesByBlock) {
  const calls = [];
  const cursors = new Map();
  const fetcher = async (blockId, cursor) => {
    calls.push({ blockId, cursor });
    const pages = pagesByBlock[blockId] || [{ results: [], has_more: false, next_cursor: null }];
    const index = cursor === null ? 0 : cursors.get(cursor);
    const page = pages[index ?? 0];
    if (page.next_cursor) cursors.set(page.next_cursor, index + 1);
    return page;
  };
  return { fetcher, calls };
}

const rt = text => [{ plain_text: text }];
const only = results => [{ results, has_more: false, next_cursor: null }];

const heading = (id, text) => ({ id, type: 'heading_2', heading_2: { rich_text: rt(text) }, has_children: false });
const para = (id, text) => ({ id, type: 'paragraph', paragraph: { rich_text: rt(text) }, has_children: false });
const code = (id, text, language) => ({ id, type: 'code', code: { rich_text: rt(text), language }, has_children: false });
const table = (id, width) => ({ id, type: 'table', table: { table_width: width, has_column_header: true }, has_children: true });
const row = (id, ...cells) => ({ id, type: 'table_row', table_row: { cells: cells.map(rt) }, has_children: false });
const toggle = (id, summary) => ({ id, type: 'toggle', toggle: { rich_text: rt(summary) }, has_children: true });

test('a table comes back with its rows — the block the flat fetch dropped entirely', async () => {
  // Shaped after "🔑 Ключові IDs (Notion)" on the real CLAUDE.md page. Before
  // spovishun-189 the table block arrived with no children, and renderTable
  // returns '' for a table with no rows: the whole table vanished silently.
  const { fetcher } = fakeFetcher({
    page: only([table('t', 2)]),
    t: only([row('r1', 'Ресурс', 'ID'), row('r2', 'Дошка задач', '36f3462f')]),
  });

  const { content } = await loadContent(fetcher, 'page');

  assert.match(content, /^\| Ресурс \| ID \|$/m);
  assert.match(content, /^\| --- \| --- \|$/m);
  assert.match(content, /^\| Дошка задач \| 36f3462f \|$/m);
});

test('a toggle comes back with its body', async () => {
  const { fetcher } = fakeFetcher({
    page: only([toggle('tg', '🤖 prompt')]),
    tg: only([para('p', 'Detailed agent prompt.')]),
  });

  const { content } = await loadContent(fetcher, 'page');

  assert.match(content, /<summary>🤖 prompt<\/summary>/);
  assert.ok(content.includes('Detailed agent prompt.'), 'toggle body must survive');
});

test('pagination is followed past the first 100 top-level blocks', async () => {
  const { fetcher, calls } = fakeFetcher({
    page: [
      { results: [para('a', 'first')], has_more: true, next_cursor: 'c1' },
      { results: [para('b', 'last')], has_more: false, next_cursor: null },
    ],
  });

  const { content } = await loadContent(fetcher, 'page');

  assert.ok(content.includes('last'), 'a block from the second page must be rendered');
  assert.deepEqual(calls.map(c => c.cursor), [null, 'c1']);
});

test('a structured Notion error rejects instead of rendering an empty page', async () => {
  const fetcher = async () => ({ object: 'error', code: 'unauthorized', message: 'API token is invalid.' });

  await assert.rejects(
    () => loadContent(fetcher, 'page'),
    /Notion API error: API token is invalid\./
  );
});

test('--section survives a fenced block whose lines look like headings', async () => {
  // The real page's "📝 Вміст задачі" section holds a fence listing the five
  // required task sections — `## 🎯 Мета`, `## 📋 Кроки` — plus a shell comment.
  // section-parser.js became fence-aware in spovishun-185, but only against
  // synthetic fixtures; this is the shape that actually ships.
  const fence = [
    '## 🎯 Мета',
    'У чому сенс цієї задачі.',
    '',
    '## 📋 Кроки',
    '1. Перший крок',
    '',
    '# install deps',
    'npm install',
  ].join('\n');

  const { fetcher } = fakeFetcher({
    page: only([
      heading('h1', 'Вміст задачі'),
      para('p1', "Кожна задача повинна містити 5 обов'язкових секцій:"),
      code('c1', fence, 'bash'),
      heading('h2', 'Чого не робити'),
      para('p2', 'Не стави кілька задач в In progress.'),
    ]),
  });

  const { content, sections } = await loadContent(fetcher, 'page');

  assert.deepEqual(
    sections.map(s => s.text),
    ['Вміст задачі', 'Чого не робити'],
    'headings inside the fence must not be indexed'
  );

  const slice = extractSection(content, 'Вміст задачі');
  assert.ok(slice.includes('## 🎯 Мета'), 'the fence body must stay inside its section');
  assert.ok(slice.includes('# install deps'), 'a shell comment must not cut the section short');
  assert.ok(!slice.includes('Не стави кілька задач'), 'the section must stop at the next real heading');
});

test('parseArgs defaults to text and reads --section / --format', () => {
  assert.deepEqual(parseArgs([]), { format: 'text', section: null });
  assert.deepEqual(parseArgs(['--format=json']), { format: 'json', section: null });
  assert.deepEqual(parseArgs(['--section', 'Ключові IDs']), { format: 'text', section: 'Ключові IDs' });
});

test('the cache key is bumped so a pre-189 entry cannot serve a truncated body', () => {
  assert.equal(CACHE_KEY, 'claude-md-v2');
});
