'use strict';

// Renders Notion blocks back to the markdown that get-task.js / get-claude-md.js
// print. Pure and synchronous: it walks a tree that is already hydrated —
// lib/block-tree.js attaches nested blocks as `block.children` before this runs.
// Keeping the fetch out of here is what lets the renderer be unit-tested on
// plain fixtures, and what lets get-claude-md.js keep calling it with a flat
// one-level list.
//
// Coverage deliberately mirrors lib/markdown-to-blocks.js: whatever the writer
// can produce, this reads back. A toggle in particular must survive the round
// trip — the newtask skill puts the AI agent prompt inside one, and
// notion-task-to-code builds its prompt from this output.
//
// Deliberately NOT shared with hooks/notion-blocks.js: that renderer answers a
// different question (a compact injected context) and prefixes headings
// differently. Unifying them would change CLI output.

function richText(blocks) {
  return (blocks || []).map(rt => rt.plain_text).join('').trim();
}

function plainText(content) {
  return (content.rich_text || []).map(rt => rt.plain_text).join('');
}

const HEADING_MARKS = { heading_1: '#', heading_2: '##', heading_3: '###' };

/** Prefixes every line so a multi-line body stays inside its list item / quote. */
function prefixLines(text, prefix, blankPrefix = prefix.trimEnd()) {
  return text
    .split('\n')
    .map(line => (line ? prefix + line : blankPrefix))
    .join('\n');
}

function childrenOf(block, prefix) {
  const rendered = extractBlocks(block.children);
  return rendered ? prefixLines(rendered, prefix) : '';
}

function joinBlock(head, body) {
  return body ? `${head}\n${body}` : head;
}

// Markdown only recognises a fence, an HTML block, a table or a thematic break
// when a blank line separates it from its neighbours — without that, feeding
// this output back through markdown-to-blocks.js would swallow the next block
// (or turn the preceding paragraph into a setext heading). Headings carry the
// same leading blank line for the same reason.
function standalone(text) {
  return text ? `
${text}
` : '';
}

function renderCode(content) {
  const text = plainText(content);
  // 'plain text' is the writer's fallback for an unrecognised fence language;
  // echoing it back as an info string would be noise.
  const lang = content.language && content.language !== 'plain text' ? content.language : '';
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function renderToggle(block, content) {
  // <details>/<summary> so the output round-trips: markdown-to-blocks.js parses
  // exactly this shape back into a toggle block.
  const body = extractBlocks(block.children);
  const summary = plainText(content);
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

// A callout comes back as a quote carrying its real icon, not as a `> [!NOTE]`
// alert. The writer recognises only five alert variants, so mapping an arbitrary
// emoji onto one of them would invent a category the page never had; keeping the
// icon is the faithful half of the trade. Re-writing this output therefore
// produces a quote block, not a callout.
function renderCallout(block, content) {
  const icon = content.icon?.type === 'emoji' ? content.icon.emoji : null;
  const text = plainText(content);
  const head = prefixLines([icon, text].filter(Boolean).join(' '), '> ');
  return joinBlock(head, childrenOf(block, '> '));
}

function renderTable(block, content) {
  const rows = (block.children || []).filter(b => b.type === 'table_row');
  if (rows.length === 0) return '';
  const cells = rows.map(row =>
    (row.table_row.cells || []).map(cell =>
      cell.map(rt => rt.plain_text).join('').replace(/\|/g, '\|').replace(/\n/g, ' ')
    )
  );
  const width = content.table_width || cells[0].length;
  const line = row => `| ${row.join(' | ')} |`;
  const separator = `|${' --- |'.repeat(width)}`;
  // A markdown table has no headerless form, so a Notion table without a column
  // header gets an empty header row rather than losing its first data row.
  const body = content.has_column_header === false
    ? [line(new Array(width).fill('')), separator, ...cells.map(line)]
    : [line(cells[0]), separator, ...cells.slice(1).map(line)];
  return body.join('\n');
}

function renderBlock(block, ordinal) {
  const type = block.type;
  const content = block[type];
  const text = plainText(content);

  if (HEADING_MARKS[type]) {
    // The leading blank line is load-bearing: section-parser.js indexes this
    // output by heading, and get-claude-md.js --section slices on it.
    return text ? `\n${HEADING_MARKS[type]} ${text}` : '';
  }
  if (type === 'divider') return standalone('---');
  if (type === 'code') return standalone(renderCode(content));
  if (type === 'toggle') return standalone(renderToggle(block, content));
  if (type === 'callout') return renderCallout(block, content);
  if (type === 'table') return standalone(renderTable(block, content));

  if (!text && !block.children) return '';

  if (type === 'paragraph') return joinBlock(text, childrenOf(block, '  '));
  if (type === 'bulleted_list_item') {
    return joinBlock(prefixLines(text, '  ').replace(/^ {2}/, '- '), childrenOf(block, '  '));
  }
  if (type === 'numbered_list_item') {
    const marker = `${ordinal}. `;
    return joinBlock(
      prefixLines(text, ' '.repeat(marker.length)).replace(/^ +/, marker),
      childrenOf(block, '  ')
    );
  }
  if (type === 'to_do') {
    const box = content.checked ? '- [x] ' : '- [ ] ';
    return joinBlock(prefixLines(text, '      ').replace(/^ +/, box), childrenOf(block, '  '));
  }
  if (type === 'quote') return joinBlock(prefixLines(text, '> '), childrenOf(block, '> '));

  // Unknown type (image caption, bookmark, …): emit whatever text it carries
  // rather than dropping the author's content silently.
  return text;
}

function extractBlocks(blocks) {
  const lines = [];
  let ordinal = 0;
  for (const block of blocks || []) {
    const type = block?.type;
    if (!type || !block[type]) continue;
    // Ordinals restart on the first sibling that is not a numbered item, which
    // is how Notion itself scopes a numbered run.
    ordinal = type === 'numbered_list_item' ? ordinal + 1 : 0;
    const rendered = renderBlock(block, ordinal);
    if (!rendered) continue;
    // Two standalone blocks in a row would otherwise stack their separators
    // into a double blank line. Trimming here rather than with a regex over the
    // finished string keeps blank lines *inside* a code block intact.
    const previous = lines[lines.length - 1];
    lines.push(previous && previous.endsWith('\n') ? rendered.replace(/^\n+/, '') : rendered);
  }
  return lines.join('\n').trim();
}

module.exports = { richText, extractBlocks };
