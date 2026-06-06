'use strict';

// Converts a markdown string into an array of Notion API block objects ready
// to be passed as `children` (or appended via /blocks/{id}/children).
//
// Backed by marked@15 (CommonJS-compatible; zero runtime deps). We use only
// the lexer — Notion blocks are our render target, not HTML, so there is no
// renderer chain.
//
// Covered block types: heading_1/2/3, paragraph, bulleted_list_item,
// numbered_list_item, to_do, code, quote, callout (GitHub alerts), divider,
// table (with header), toggle (<details><summary>). Inline annotations:
// bold, italic, code, strikethrough, links. Unknown HTML / unsupported
// markdown falls back to a verbatim paragraph so content is never lost.
//
// Chunking:
//   - Single `rich_text` segment is split at MAX_RICH_TEXT_LEN (Notion's hard
//     limit per text run is 2000 chars).
//   - The output array is NOT chunked at the children-per-request limit
//     (100). The caller is responsible for splitting if needed; create-task /
//     create-epic post the page in one shot today, so we exit with a warning
//     when blocks exceed 100.

// marked is bundled as a vendored copy under lib/vendor/ so the installed
// scripts work in any consumer project without an additional `npm install`
// step. The bundled file is byte-identical to `node_modules/marked/lib/marked.cjs`
// from the version pinned in the plugin's root package.json (`marked@15.x`).
// CI re-vendors on every release; do not edit the file in vendor/ by hand.
const { marked } = require('./vendor/marked.cjs');

const MAX_RICH_TEXT_LEN = 2000;
const MAX_CHILDREN_PER_BLOCK = 100;

// GitHub-style alerts (https://docs.github.com/get-started/writing-on-github/working-with-advanced-formatting/basic-writing-and-formatting-syntax#alerts)
// → Notion callout. The icon and color are picked to match the GitHub render.
const ALERT_STYLES = {
  NOTE:      { emoji: 'ℹ️', color: 'blue_background'   },
  TIP:       { emoji: '💡', color: 'green_background'  },
  IMPORTANT: { emoji: '❗', color: 'purple_background' },
  WARNING:   { emoji: '⚠️', color: 'yellow_background' },
  CAUTION:   { emoji: '🚫', color: 'red_background'    },
};
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;

/**
 * Entry point.
 * @param {string} markdown
 * @returns {Array<object>}  Notion API block objects.
 */
function markdownToBlocks(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') return [];
  const tokens = marked.lexer(markdown);
  const blocks = walkTopLevel(tokens);
  if (blocks.length > MAX_CHILDREN_PER_BLOCK) {
    process.stderr.write(
      `[markdown-to-blocks] Warning: ${blocks.length} blocks exceeds Notion's ` +
      `${MAX_CHILDREN_PER_BLOCK}-children-per-request limit; the page create call ` +
      `may be rejected. Consider splitting the input or appending children in batches.\n`
    );
  }
  return blocks;
}

// ─── Top-level walker with <details>/</details> state machine ──────────────────

function walkTopLevel(tokens) {
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    // Skip whitespace separators.
    if (t.type === 'space') { i++; continue; }

    // <details>...</details> wins over generic html: greedy-collect until the
    // matching closing tag, then nest the inner tokens as toggle children.
    if (isDetailsOpen(t)) {
      const summary = parseSummary(t.raw);
      const inner = [];
      i++;
      while (i < tokens.length && !isDetailsClose(tokens[i])) {
        inner.push(tokens[i]);
        i++;
      }
      // Consume the closing tag if present; missing closer is tolerated.
      if (i < tokens.length) i++;
      const children = walkTopLevel(inner);
      out.push(toggleBlock(summary, children));
      continue;
    }

    const block = tokenToBlock(t);
    if (Array.isArray(block)) out.push(...block);
    else if (block) out.push(block);
    i++;
  }
  return out;
}

function isDetailsOpen(t) {
  return t.type === 'html' && t.block && /^<details\b/i.test(t.raw.trim());
}

function isDetailsClose(t) {
  return t.type === 'html' && t.block && /<\/details>/i.test(t.raw);
}

function parseSummary(rawHtml) {
  const m = rawHtml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  return m ? m[1].trim() : 'Toggle';
}

// ─── Per-token dispatcher ────────────────────────────────────────────────────

function tokenToBlock(t) {
  switch (t.type) {
    case 'heading':    return headingBlock(t);
    case 'paragraph':  return paragraphBlock(t);
    case 'list':       return listBlocks(t);
    case 'code':       return codeBlock(t);
    case 'blockquote': return blockquoteOrAlert(t);
    case 'table':      return tableBlock(t);
    case 'hr':         return { object: 'block', type: 'divider', divider: {} };
    case 'html':       return htmlFallback(t);
    case 'text':       return paragraphFromInlineTokens(t.tokens ?? [{ type: 'text', text: t.text ?? t.raw ?? '' }]);
    default:           return null; // space, def, escape — silently ignored
  }
}

// ─── Block builders ──────────────────────────────────────────────────────────

function headingBlock(t) {
  const depth = Math.min(3, Math.max(1, t.depth));
  const key = `heading_${depth}`;
  return {
    object: 'block',
    type: key,
    [key]: { rich_text: inlineTokensToRichText(t.tokens) },
  };
}

function paragraphBlock(t) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: inlineTokensToRichText(t.tokens) },
  };
}

function paragraphFromInlineTokens(tokens) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: inlineTokensToRichText(tokens) },
  };
}

function codeBlock(t) {
  // Notion's code block expects a recognised `language` enum; falls back to
  // 'plain text' when the fence lang isn't one Notion understands.
  return {
    object: 'block',
    type: 'code',
    code: {
      rich_text: chunkRichText(t.text ?? ''),
      language: normalizeCodeLang(t.lang),
    },
  };
}

// Notion's code-block language list — common values pre-validated; everything
// else falls back to plain text rather than risking a 400.
const NOTION_CODE_LANGS = new Set([
  'abap','arduino','bash','basic','c','clojure','coffeescript','c++','c#','css','dart',
  'diff','docker','elixir','elm','erlang','flow','fortran','f#','gherkin','glsl','go',
  'graphql','groovy','haskell','html','java','javascript','json','julia','kotlin','latex',
  'less','lisp','livescript','lua','makefile','markdown','markup','matlab','mermaid','nix',
  'objective-c','ocaml','pascal','perl','php','plain text','powershell','prolog','protobuf',
  'python','r','reason','ruby','rust','sass','scala','scheme','scss','shell','sql','swift',
  'typescript','vb.net','verilog','vhdl','visual basic','webassembly','xml','yaml',
]);
function normalizeCodeLang(lang) {
  if (!lang) return 'plain text';
  const l = String(lang).toLowerCase();
  if (NOTION_CODE_LANGS.has(l)) return l;
  // Common aliases.
  if (l === 'js')   return 'javascript';
  if (l === 'ts')   return 'typescript';
  if (l === 'sh' || l === 'zsh') return 'bash';
  if (l === 'py')   return 'python';
  if (l === 'rb')   return 'ruby';
  if (l === 'rs')   return 'rust';
  if (l === 'kt')   return 'kotlin';
  if (l === 'yml')  return 'yaml';
  return 'plain text';
}

function blockquoteOrAlert(t) {
  // Try GitHub alert syntax first: blockquote whose first paragraph starts
  // with `[!NOTE]` etc. marked doesn't tokenize alerts natively in v15.
  const alert = extractAlert(t);
  if (alert) return calloutBlock(alert.variant, alert.bodyTokens);
  return quoteBlock(t);
}

function extractAlert(blockquoteToken) {
  const first = blockquoteToken.tokens?.[0];
  if (!first || first.type !== 'paragraph') return null;
  const rawText = first.text ?? '';
  // The label can be the first line; the body either follows on the next line
  // or in subsequent paragraph tokens within the blockquote.
  const lines = rawText.split('\n');
  const m = lines[0].match(ALERT_RE);
  if (!m) return null;
  const variant = m[1].toUpperCase();
  const remainderText = [m[2], ...lines.slice(1)].join('\n').trim();

  // Build a synthetic token list for the body: drop the label line, keep the
  // rest of the first paragraph (if any) plus all subsequent blockquote
  // children.
  const bodyTokens = [];
  if (remainderText) {
    bodyTokens.push({
      type: 'paragraph',
      tokens: [{ type: 'text', text: remainderText, raw: remainderText }],
    });
  }
  for (const sib of blockquoteToken.tokens.slice(1)) bodyTokens.push(sib);
  return { variant, bodyTokens };
}

function calloutBlock(variant, bodyTokens) {
  const style = ALERT_STYLES[variant] ?? ALERT_STYLES.NOTE;
  // Take the first paragraph as the inline text on the callout itself; nest
  // any further block tokens (lists, code) as callout children.
  const [head, ...rest] = bodyTokens;
  const headRich = head && head.type === 'paragraph'
    ? inlineTokensToRichText(head.tokens)
    : [];
  const children = walkTopLevel(rest);
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: headRich,
      icon: { type: 'emoji', emoji: style.emoji },
      color: style.color,
      ...(children.length > 0 ? { children } : {}),
    },
  };
}

function quoteBlock(t) {
  // Flatten the blockquote's inner paragraphs into a single rich_text run; any
  // nested block-level tokens (e.g. a code fence inside the quote) come out as
  // children of the quote block.
  const inlineParas = [];
  const blockChildren = [];
  for (const child of t.tokens ?? []) {
    if (child.type === 'paragraph') inlineParas.push(child);
    else                            blockChildren.push(child);
  }
  const richText = inlineParas.flatMap((p, i) => {
    const out = inlineTokensToRichText(p.tokens);
    if (i < inlineParas.length - 1) out.push(plainTextSegment('\n'));
    return out;
  });
  const children = walkTopLevel(blockChildren);
  return {
    object: 'block',
    type: 'quote',
    quote: {
      rich_text: richText,
      ...(children.length > 0 ? { children } : {}),
    },
  };
}

function listBlocks(t) {
  return t.items.map(item => listItemToBlock(item, t.ordered));
}

function listItemToBlock(item, ordered) {
  // Separate the inline content of the item from any nested block tokens
  // (sub-lists, code fences, etc.).
  const inlineTokens = [];
  const blockTokens = [];
  for (const child of item.tokens ?? []) {
    if (child.type === 'text' || isInlineToken(child)) inlineTokens.push(...(child.tokens ?? [child]));
    else                                                blockTokens.push(child);
  }
  const children = walkTopLevel(blockTokens);
  const richText = inlineTokensToRichText(inlineTokens);

  if (item.task) {
    return {
      object: 'block',
      type: 'to_do',
      to_do: {
        rich_text: richText,
        checked: !!item.checked,
        ...(children.length > 0 ? { children } : {}),
      },
    };
  }
  const key = ordered ? 'numbered_list_item' : 'bulleted_list_item';
  return {
    object: 'block',
    type: key,
    [key]: {
      rich_text: richText,
      ...(children.length > 0 ? { children } : {}),
    },
  };
}

function tableBlock(t) {
  const rows = [];
  rows.push(tableRow(t.header.map(h => h.tokens)));
  for (const r of t.rows) rows.push(tableRow(r.map(c => c.tokens)));
  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: t.header.length,
      has_column_header: true,
      has_row_header: false,
      children: rows,
    },
  };
}

function tableRow(cellTokensArr) {
  return {
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: cellTokensArr.map(tokens => inlineTokensToRichText(tokens)),
    },
  };
}

function toggleBlock(summary, children) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [plainTextSegment(summary)],
      ...(children.length > 0 ? { children } : {}),
    },
  };
}

function htmlFallback(t) {
  // Unknown raw HTML survives as a paragraph carrying the literal text — the
  // alternative is dropping the user's content silently.
  const raw = (t.raw ?? t.text ?? '').trim();
  if (!raw) return null;
  return paragraphFromInlineTokens([{ type: 'text', text: raw, raw }]);
}

// ─── Inline → rich_text ──────────────────────────────────────────────────────

function isInlineToken(t) {
  return ['text', 'strong', 'em', 'codespan', 'del', 'link', 'br', 'escape'].includes(t.type);
}

/**
 * Turns marked's inline token tree into a flat array of Notion rich_text
 * segments. Annotations compose (bold + italic + code), and `chunkRichText`
 * enforces the 2000-char-per-segment hard limit.
 */
function inlineTokensToRichText(tokens, base = {}) {
  if (!tokens || tokens.length === 0) return [];
  const out = [];
  for (const t of tokens) {
    out.push(...inlineTokenToRichText(t, base));
  }
  return mergeAndChunk(out);
}

function inlineTokenToRichText(t, base) {
  switch (t.type) {
    case 'text':
    case 'escape':
      // marked.lexer wraps escape inside a text token; the .text already has
      // the unescaped character. For raw text tokens with no nested
      // formatting, .text is final.
      if (t.tokens && t.tokens.length > 0 && t.tokens[0] !== t) {
        return t.tokens.flatMap(c => inlineTokenToRichText(c, base));
      }
      return [textSegment(t.text ?? t.raw ?? '', base)];
    case 'strong':
      return inlineTokenChildren(t, { ...base, bold: true });
    case 'em':
      return inlineTokenChildren(t, { ...base, italic: true });
    case 'codespan':
      return [textSegment(t.text ?? '', { ...base, code: true })];
    case 'del':
      return inlineTokenChildren(t, { ...base, strikethrough: true });
    case 'link':
      return inlineTokenChildren(t, { ...base, link: t.href });
    case 'br':
      return [textSegment('\n', base)];
    default:
      // Unknown inline (e.g. image) — fall back to its raw text.
      return [textSegment(t.text ?? t.raw ?? '', base)];
  }
}

function inlineTokenChildren(t, base) {
  if (t.tokens && t.tokens.length > 0) {
    return t.tokens.flatMap(c => inlineTokenToRichText(c, base));
  }
  return [textSegment(t.text ?? '', base)];
}

function textSegment(content, base) {
  const annotations = {
    bold: !!base.bold,
    italic: !!base.italic,
    strikethrough: !!base.strikethrough,
    underline: false,
    code: !!base.code,
    color: 'default',
  };
  const seg = {
    type: 'text',
    text: { content, link: base.link ? { url: base.link } : null },
    annotations,
    plain_text: content,
    href: base.link ?? null,
  };
  return seg;
}

function plainTextSegment(content) {
  return textSegment(content, {});
}

/**
 * Splits any segment whose content exceeds MAX_RICH_TEXT_LEN into multiple
 * sibling segments preserving the annotations + link. Also merges trivially
 * empty adjacent segments to keep the API call clean.
 */
function mergeAndChunk(segments) {
  return segments.flatMap(seg => chunkSegment(seg)).filter(s => s.text.content.length > 0);
}

function chunkSegment(seg) {
  const content = seg.text.content;
  if (content.length <= MAX_RICH_TEXT_LEN) return [seg];
  const parts = [];
  for (let i = 0; i < content.length; i += MAX_RICH_TEXT_LEN) {
    parts.push({
      ...seg,
      text: { ...seg.text, content: content.slice(i, i + MAX_RICH_TEXT_LEN) },
      plain_text: content.slice(i, i + MAX_RICH_TEXT_LEN),
    });
  }
  return parts;
}

function chunkRichText(content) {
  return chunkSegment(plainTextSegment(content));
}

module.exports = {
  markdownToBlocks,
  // Exposed for direct unit testing.
  inlineTokensToRichText,
  extractAlert,
  normalizeCodeLang,
  MAX_RICH_TEXT_LEN,
  MAX_CHILDREN_PER_BLOCK,
};
