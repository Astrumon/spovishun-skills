'use strict';

// The single Notion-blocks → markdown renderer. Two call sites bind it with
// different options:
//
//   scripts/notion/lib/format-task.js  → the CLI (get-task.js, get-claude-md.js)
//   hooks/notion-blocks.js             → the session hooks and task.json
//
// It lives under hooks/ because installHooks() runs unconditionally while
// installScripts() skips scripts/notion/ unless stack.notion is set: scripts may
// depend on hooks, never the reverse. Flat in hooks/, not in a subdirectory —
// installHooks() copies hooks/*.js with a non-recursive readdirSync.
//
// Pure and synchronous: it walks a tree that is already hydrated —
// block-tree.js attaches nested blocks as `block.children` before this runs.
// Keeping the fetch out is what lets the renderer be unit-tested on plain
// fixtures, and what lets get-claude-md.js keep calling it with a flat
// one-level list.
//
// Coverage deliberately mirrors scripts/notion/lib/markdown-to-blocks.js:
// whatever the writer can produce, this reads back. A toggle in particular must
// survive the round trip — the newtask skill puts the AI agent prompt inside
// one, and notion-task-to-code builds its prompt from this output.
//
// Only two things are options. Everything else — ordinals, multi-line prefixes,
// the code fence's info string, the table separator row — is one behaviour,
// because the two call sites never wanted to differ on those; one of them was
// simply behind (spovishun-188).

const HEADING_MARKS = { heading_1: '#', heading_2: '##', heading_3: '###' };

function plainText(content) {
  return (content.rich_text || []).map(rt => rt.plain_text).join('');
}

/** Prefixes every line so a multi-line body stays inside its list item / quote. */
function prefixLines(text, prefix, blankPrefix = prefix.trimEnd()) {
  return text
    .split('\n')
    .map(line => (line ? prefix + line : blankPrefix))
    .join('\n');
}

function joinBlock(head, body) {
  return body ? `${head}\n${body}` : head;
}

/**
 * @param {object} [options]
 * @param {string} [options.headingLead] `'\n'` puts a blank line before every
 *   ATX heading — load-bearing for the CLI, where section-parser.js indexes the
 *   output by heading and get-claude-md.js --section slices on it. `''` for the
 *   injected context, which is read by a model, not re-parsed.
 * @param {boolean} [options.standalone] Whether a fence / `<details>` / table /
 *   thematic break is separated from its neighbours by blank lines. Markdown
 *   only recognises those four when a blank line precedes them, so the CLI needs
 *   it for its output to round-trip through markdown-to-blocks.js; the injected
 *   context trades that away for compactness.
 * @returns {{extractBlocks: (blocks: any[]) => string, renderBlock: (block: any, ordinal?: number) => string}}
 */
function createRenderer(options = {}) {
  const headingLead = options.headingLead === undefined ? '\n' : options.headingLead;
  const separateStandalone = options.standalone !== false;

  function standalone(text) {
    if (!text) return '';
    return separateStandalone ? `\n${text}\n` : text;
  }

  function childrenOf(block, prefix) {
    const rendered = extractBlocks(block.children);
    return rendered ? prefixLines(rendered, prefix) : '';
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
        cell.map(rt => rt.plain_text).join('').replace(/\|/g, '\\|').replace(/\n/g, ' ')
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

  function renderBlock(block, ordinal = 1) {
    const type = block?.type;
    const content = type ? block[type] : null;
    // A block whose payload is missing renders empty rather than throwing —
    // renderBlock is called directly, not only through extractBlocks.
    if (!content) return '';
    const text = plainText(content);

    if (HEADING_MARKS[type]) {
      return text ? `${headingLead}${HEADING_MARKS[type]} ${text}` : '';
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
      // finished string keeps blank lines *inside* a code block intact. Inert
      // when `standalone` is off — nothing ends in a newline then.
      const previous = lines[lines.length - 1];
      lines.push(previous && previous.endsWith('\n') ? rendered.replace(/^\n+/, '') : rendered);
    }
    return lines.join('\n').trim();
  }

  return { extractBlocks, renderBlock };
}

module.exports = { createRenderer, plainText };
