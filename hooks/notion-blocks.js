'use strict';

// Renders Notion blocks to the markdown that lands in .dev-context/context.md
// and in the injected prompt.
//
// Deliberately NOT shared with scripts/notion/lib/format-task.js: that renderer
// answers a different question (a compact board summary — it drops to_do/code/
// divider blocks and prefixes headings with a blank line). Unifying them would
// change CLI output, so the two stay separate and say so.

function richText(blocks) {
  return (blocks || []).map(b => b.plain_text || '').join('');
}

function blockToMd(block) {
  const t = block.type;
  if (!block[t]) return '';
  const text = richText(block[t].rich_text || []);
  if (t === 'heading_1') return `# ${text}`;
  if (t === 'heading_2') return `## ${text}`;
  if (t === 'heading_3') return `### ${text}`;
  if (t === 'bulleted_list_item') return `- ${text}`;
  if (t === 'numbered_list_item') return `1. ${text}`;
  if (t === 'to_do') return `- [${block[t].checked ? 'x' : ' '}] ${text}`;
  if (t === 'code') return `\`\`\`\n${text}\n\`\`\``;
  if (t === 'divider') return '---';
  return text;
}

function extractBlocks(blocks) {
  return blocks.map(blockToMd).filter(Boolean).join('\n');
}

/**
 * Everything except `toggle` blocks. Toggles hold the task template's collapsed
 * scaffolding, which is noise in an injected prompt but is kept verbatim in
 * task.json — so the filter belongs at the call site, named.
 */
function visibleBlocks(blocks) {
  return blocks.filter(b => b.type !== 'toggle');
}

module.exports = { richText, blockToMd, extractBlocks, visibleBlocks };
