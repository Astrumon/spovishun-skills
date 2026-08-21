'use strict';

// Hydrates a Notion block list into a tree: paginates one level and, for every
// block that reports `has_children`, recurses and attaches the result as
// `block.children`.
//
// Transport-agnostic on purpose. hooks/ and scripts/notion/ have deliberately
// separate HTTP layers (see hooks/notion-api.js) and may not require each
// other's, so the caller passes in the one page-fetch it already owns. That
// keeps this file dependency-free, which is what lets scripts/notion/lib/
// block-tree.js re-export it instead of growing a second copy of the walk.

// Deep enough for the shapes the writer produces — toggle > list > sub-list,
// table > row — and shallow enough that a pathological page cannot fan out into
// hundreds of requests.
const MAX_BLOCK_DEPTH = 3;

/**
 * @param {(blockId: string, cursor: string|null) => Promise<object>} getChildrenPage
 *        Resolves one page of `GET /v1/blocks/{id}/children`:
 *        `{ results, has_more, next_cursor }`.
 * @param {string} blockId
 * @param {{ depth?: number }} [opts] Remaining levels to descend. At 0 the
 *        children of a block are left unfetched rather than partially attached.
 * @returns {Promise<Array<object>>} Top-level blocks, each with `children` when
 *        it has any within the depth budget.
 */
async function fetchBlockTree(getChildrenPage, blockId, { depth = MAX_BLOCK_DEPTH } = {}) {
  const blocks = await fetchAllChildren(getChildrenPage, blockId);
  if (depth <= 0) return blocks;

  // Siblings are fetched in parallel: a task page with four toggles would
  // otherwise cost four sequential round-trips before the prompt is readable.
  await Promise.all(
    blocks
      .filter(b => b && b.has_children)
      .map(async b => {
        b.children = await fetchBlockTree(getChildrenPage, b.id, { depth: depth - 1 });
      })
  );
  return blocks;
}

/** Follows `has_more` / `next_cursor` to the end — one level, every block. */
async function fetchAllChildren(getChildrenPage, blockId) {
  const out = [];
  let cursor = null;
  do {
    const page = await getChildrenPage(blockId, cursor);
    // A structured Notion error resolves rather than throws in both transports;
    // surfacing it here beats silently rendering an empty page body.
    if (page && page.object === 'error') {
      throw new Error(`Notion API error: ${page.message || page.code}`);
    }
    out.push(...(page?.results || []));
    cursor = page?.has_more ? page.next_cursor : null;
  } while (cursor);
  return out;
}

module.exports = { fetchBlockTree, MAX_BLOCK_DEPTH };
