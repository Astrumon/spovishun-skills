'use strict';

// The hook side of the one renderer in hooks/notion-render.js — the markdown
// that lands in .dev-context/context.md, in task.json and in the injected
// prompt.
//
// It differs from the CLI binding in scripts/notion/lib/format-task.js by
// exactly two options, both of them compactness: no blank line before a
// heading, and no blank-line separators around a fence / <details> / table /
// thematic break. That output is read by a model, not fed back through
// markdown-to-blocks.js, so it does not need to round-trip.
//
// Nested blocks arrive as `block.children`, hydrated by block-tree.js before
// this runs. Rendering them is not cosmetic: notion-task-to-code reads the
// cached task.json first, and the newtask skill puts the agent prompt inside a
// toggle — without the children the agent gets a task with no prompt.

const { createRenderer } = require('./notion-render.js');

const { extractBlocks, renderBlock } = createRenderer({ headingLead: '', standalone: false });

// Not the renderer's business, and deliberately not the CLI's `richText`: that
// one trims, because it reads page titles and property values. This one is
// consumed by branch-name.js, which regex-matches raw paragraph text.
function richText(blocks) {
  return (blocks || []).map(b => b.plain_text || '').join('');
}

/** One block, outside any numbered run — so a numbered item renders as `1.`. */
function blockToMd(block) {
  return renderBlock(block, 1);
}

/**
 * Everything except `toggle` blocks. Toggles hold the task template's collapsed
 * scaffolding, which is noise in an injected prompt but is kept verbatim in
 * task.json — so the filter belongs at the call site, named, and never inside
 * the renderer.
 */
function visibleBlocks(blocks) {
  return blocks.filter(b => b.type !== 'toggle');
}

module.exports = { richText, blockToMd, extractBlocks, visibleBlocks, createRenderer };
