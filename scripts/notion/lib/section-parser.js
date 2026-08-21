'use strict';

// Indexes the markdown produced by format-task.js by its ATX headings, so
// get-claude-md.js can slice out one section.
//
// Fence tracking is not cosmetic: format-task.js renders `code` blocks as
// fenced markdown, and a shell snippet whose first line is `# install deps`
// would otherwise register as a heading and cut the real section short.

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,3})\s+(.+)$/;

function buildSectionIndex(content) {
  const lines = content.split('\n');
  const index = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i].match(HEADING_RE);
    if (m) index.push({ level: m[1].length, text: m[2].trim(), line: i });
  }
  return index;
}

function extractSection(content, query) {
  const lines = content.split('\n');
  const index = buildSectionIndex(content);
  const lower = query.toLowerCase();
  const matches = index.filter(h => h.text.toLowerCase().includes(lower));

  if (matches.length === 0) {
    const avail = index.map(h => '#'.repeat(h.level) + ' ' + h.text).join('\n');
    process.stderr.write(`No section matching "${query}". Available sections:\n${avail}\n`);
    process.exit(1);
  }

  if (matches.length > 1) {
    process.stderr.write(`Multiple matches for "${query}": ${matches.map(h => h.text).join(', ')}\n`);
  }

  const sections = matches.map(h => {
    // The section runs to the next heading of the same or shallower level.
    // Headings are already fence-filtered in the index, so reuse it instead of
    // re-scanning the raw lines.
    const next = index.find(other => other.line > h.line && other.level <= h.level);
    const end = next ? next.line : lines.length;
    return lines.slice(h.line, end).join('\n').trim();
  });

  return sections.join('\n\n---\n\n');
}

module.exports = { buildSectionIndex, extractSection };
