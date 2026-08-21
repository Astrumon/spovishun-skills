'use strict';

// Renders Notion blocks to the markdown that lands in .dev-context/context.md
// and in the injected prompt.
//
// Deliberately NOT shared with scripts/notion/lib/format-task.js: that renderer
// answers a different question (a compact board summary — it prefixes headings
// with a blank line and separates standalone blocks so its output can be fed
// back through markdown-to-blocks.js). Unifying them would change CLI output,
// so the two stay separate and say so.
//
// Nested blocks arrive as `block.children`, hydrated by block-tree.js before
// this runs. Rendering them is not cosmetic: notion-task-to-code reads the
// cached task.json first, and the newtask skill puts the agent prompt inside a
// toggle — without the children the agent gets a task with no prompt.

function richText(blocks) {
  return (blocks || []).map(b => b.plain_text || '').join('');
}

/** Prefixes every line so a multi-line body stays inside its quote / callout. */
function prefixLines(text, prefix) {
  return text.split('\n').map(line => (line ? prefix + line : prefix.trimEnd())).join('\n');
}

function childrenMd(block, prefix) {
  const rendered = extractBlocks(block.children || []);
  return rendered ? prefixLines(rendered, prefix) : '';
}

function withChildren(head, body) {
  return body ? `${head}\n${body}` : head;
}

function tableMd(block) {
  const rows = (block.children || []).filter(b => b.type === 'table_row');
  if (rows.length === 0) return '';
  return rows
    .map(row => `| ${(row.table_row.cells || [])
      .map(cell => richText(cell).replace(/\|/g, '\\|').replace(/\n/g, ' '))
      .join(' | ')} |`)
    .join('\n');
}

function blockToMd(block) {
  const t = block.type;
  if (!block[t]) return '';
  const text = richText(block[t].rich_text || []);
  if (t === 'heading_1') return `# ${text}`;
  if (t === 'heading_2') return `## ${text}`;
  if (t === 'heading_3') return `### ${text}`;
  if (t === 'bulleted_list_item') return withChildren(`- ${text}`, childrenMd(block, '  '));
  if (t === 'numbered_list_item') return withChildren(`1. ${text}`, childrenMd(block, '  '));
  if (t === 'to_do') return `- [${block[t].checked ? 'x' : ' '}] ${text}`;
  if (t === 'code') return `\`\`\`\n${text}\n\`\`\``;
  if (t === 'divider') return '---';
  if (t === 'quote') return withChildren(prefixLines(text, '> '), childrenMd(block, '> '));
  if (t === 'table') return tableMd(block);
  if (t === 'callout') {
    const icon = block[t].icon?.type === 'emoji' ? block[t].icon.emoji : null;
    const head = prefixLines([icon, text].filter(Boolean).join(' '), '> ');
    return withChildren(head, childrenMd(block, '> '));
  }
  if (t === 'toggle') {
    // Same <details> shape as the CLI renderer, so a prompt copied out of
    // task.json can be written straight back through markdown-to-blocks.js.
    return `<details>\n<summary>${text}</summary>\n\n${childrenMd(block, '')}\n\n</details>`;
  }
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
