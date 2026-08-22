'use strict';

// The CLI side of the one renderer in hooks/notion-render.js — the markdown
// get-task.js / get-claude-md.js print.
//
// Both options are on here and both are load-bearing. The blank line before a
// heading is what section-parser.js indexes on and what get-claude-md.js
// --section slices by; the separators around a fence / <details> / table /
// thematic break are what let this output round-trip through
// markdown-to-blocks.js (asserted by test/scripts-notion-format-task.test.js).
//
// The engine lives under hooks/ because installHooks() runs unconditionally
// while installScripts() skips scripts/notion/ unless stack.notion is on:
// scripts may depend on hooks, never the reverse. `../../../hooks/` resolves
// identically in this repo and in an installed .claude/. Neither side can be a
// bare re-export the way block-tree.js and page-id.js are — the options differ,
// `richText` differs, and `visibleBlocks` exists only on the hook side — so
// both re-export `createRenderer` and test/config-reader-parity.test.js asserts
// the two resolve to the same function.

const { createRenderer } = require('../../../hooks/notion-render.js');

const { extractBlocks } = createRenderer({ headingLead: '\n', standalone: true });

// Trims, unlike the hook's namesake: this one reads page titles and property
// values, where Notion's trailing whitespace is never meaningful.
function richText(blocks) {
  return (blocks || []).map(rt => rt.plain_text).join('').trim();
}

module.exports = { richText, extractBlocks, createRenderer };
