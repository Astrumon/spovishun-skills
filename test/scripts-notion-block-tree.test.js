import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { fetchBlockTree, MAX_BLOCK_DEPTH } = require(
  join(here, '..', 'scripts', 'notion', 'lib', 'block-tree.js')
);

// The walker is transport-agnostic on purpose, so the whole surface is testable
// with a plain callback — no HTTP mock, no token.

/**
 * Builds a getChildrenPage over a `{ blockId: [pages] }` map and records every
 * call, so a test can assert on what was NOT requested too.
 */
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

const leaf = id => ({ id, type: 'paragraph', paragraph: { rich_text: [] }, has_children: false });
const parent = id => ({ id, type: 'toggle', toggle: { rich_text: [] }, has_children: true });

test('follows has_more / next_cursor to the end of the level', async () => {
  const { fetcher, calls } = fakeFetcher({
    page: [
      { results: [leaf('a'), leaf('b')], has_more: true, next_cursor: 'c1' },
      { results: [leaf('c')], has_more: true, next_cursor: 'c2' },
      { results: [leaf('d')], has_more: false, next_cursor: null },
    ],
  });

  const blocks = await fetchBlockTree(fetcher, 'page');

  assert.deepEqual(blocks.map(b => b.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(calls.map(c => c.cursor), [null, 'c1', 'c2']);
});

test('attaches nested blocks as children when has_children is set', async () => {
  const { fetcher } = fakeFetcher({
    page: [{ results: [parent('t1')], has_more: false, next_cursor: null }],
    t1: [{ results: [leaf('body')], has_more: false, next_cursor: null }],
  });

  const [toggle] = await fetchBlockTree(fetcher, 'page');

  assert.deepEqual(toggle.children.map(b => b.id), ['body']);
});

test('a block without has_children is never requested', async () => {
  const { fetcher, calls } = fakeFetcher({
    page: [{ results: [leaf('a')], has_more: false, next_cursor: null }],
  });

  const blocks = await fetchBlockTree(fetcher, 'page');

  assert.equal(blocks[0].children, undefined);
  assert.deepEqual(calls.map(c => c.blockId), ['page']);
});

test('depth is a hard budget: at 0 children are left unfetched, not partially attached', async () => {
  const { fetcher, calls } = fakeFetcher({
    page: [{ results: [parent('t1')], has_more: false, next_cursor: null }],
    t1: [{ results: [leaf('body')], has_more: false, next_cursor: null }],
  });

  const [toggle] = await fetchBlockTree(fetcher, 'page', { depth: 0 });

  assert.equal(toggle.children, undefined);
  assert.deepEqual(calls.map(c => c.blockId), ['page']);
});

test('recursion descends exactly `depth` levels', async () => {
  const { fetcher, calls } = fakeFetcher({
    page: [{ results: [parent('l1')], has_more: false, next_cursor: null }],
    l1: [{ results: [parent('l2')], has_more: false, next_cursor: null }],
    l2: [{ results: [parent('l3')], has_more: false, next_cursor: null }],
    l3: [{ results: [leaf('deep')], has_more: false, next_cursor: null }],
  });

  const [top] = await fetchBlockTree(fetcher, 'page', { depth: 2 });

  assert.deepEqual(top.children[0].children.map(b => b.id), ['l3']);
  assert.equal(top.children[0].children[0].children, undefined);
  assert.deepEqual(calls.map(c => c.blockId), ['page', 'l1', 'l2']);
});

test('a structured Notion error rejects instead of rendering an empty body', async () => {
  const fetcher = async () => ({ object: 'error', code: 'object_not_found', message: 'Could not find block' });

  await assert.rejects(
    () => fetchBlockTree(fetcher, 'page'),
    /Could not find block/
  );
});

test('MAX_BLOCK_DEPTH is the default and covers toggle > list > sub-list', () => {
  assert.equal(MAX_BLOCK_DEPTH, 3);
});
