'use strict';

// Derives a task's git branch. The prefix is passed in rather than read from
// config here, which keeps this module a leaf: it can be exercised without an
// env or a cwd, and the caller stays the only place that decides what the
// project prefix is.
//
// Not shared with scripts/notion/lib/extract-branch.js — that one hunts for a
// "Branch name"/🌿 header block and slugifies to the first three words, this one
// regex-matches a `feature/...` token anywhere and slugifies to 40 chars. Same
// intent, different output; merging them would silently rename branches.

const { richText } = require('./notion-blocks.js');

/** "feature/demo-42: Add X" → "42". Also matches bare "demo-42:" forms. */
function extractTaskNumber(name) {
  const m = name.match(/[/-](\d+)[:-]/);
  return m ? m[1] : null;
}

/** A branch the task page states explicitly wins over one derived from the title. */
function extractBranchFromBlocks(blocks) {
  for (const b of blocks) {
    if (b.type !== 'paragraph') continue;
    const m = richText(b.paragraph?.rich_text || []).match(/feature\/[\w-]+-\d+[\w-]*/);
    if (m) return m[0];
  }
  return null;
}

function deriveBranchFromName(name, prefix) {
  const num = extractTaskNumber(name);
  if (!num) return null;
  const slug = name
    .replace(/^feature\/[\w-]+-\d+[:\s-]*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `feature/${prefix}-${num}-${slug}`;
}

// PROJECT_PREFIX is slugified when it comes from the config, but the
// PROJECT_PREFIX env var overrides it unfiltered — so escape before compiling.
function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strips the `feature/<prefix>-<N>:` lead-in for display in the picker. */
function displayName(name, prefix) {
  return name.replace(new RegExp(`^feature\\/${escapeForRegex(prefix)}-\\d+[:\\s-]*`, 'i'), '').trim();
}

module.exports = { extractTaskNumber, extractBranchFromBlocks, deriveBranchFromName, displayName };
