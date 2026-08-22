#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const constants = require('./lib/constants');
const cache = require('./lib/cache');
const { extractBlocks } = require('./lib/format-task');
const { fetchBlockTree } = require('./lib/block-tree');
const { buildSectionIndex, extractSection } = require('./lib/section-parser');

// Bumped when the fetch moved to fetchBlockTree. A v1 entry holds a body
// rendered from a flat, single-page block list: every table and toggle on the
// page is missing from it, and anything past the first 100 top-level blocks
// was never fetched. Serving that for the rest of its hour would hide the fix.
// The orphaned claude-md.json is a few KB and is never read again.
const CACHE_KEY = 'claude-md-v2';
const CACHE_TTL_MS = 3_600_000;
const VALID_FORMATS = ['text', 'md', 'json'];

function parseArgs(argv) {
  let format = 'text';
  let section = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--format=')) { format = argv[i].slice(9); }
    else if (argv[i] === '--format' && argv[i + 1]) { format = argv[++i]; }
    else if (argv[i] === '--section' && argv[i + 1]) { section = argv[++i]; }
  }
  return { format, section };
}

// Fetch + render, with no cache and no process exits, so tests can drive it
// with a plain callback the way test/scripts-notion-block-tree.test.js does.
// fetchBlockTree hydrates nested blocks (table rows, toggle bodies, callout
// children) and follows pagination — both of which a single /children call
// misses — and throws on a structured Notion error, which main()'s catch reports.
async function loadContent(getChildrenPage, pageId) {
  const blocks = await fetchBlockTree(getChildrenPage, pageId);
  const content = extractBlocks(blocks);
  return { content, sections: buildSectionIndex(content) };
}

function readCached() {
  const v = cache.get(CACHE_KEY, CACHE_TTL_MS);
  if (!v) return null;
  if (typeof v === 'string') return { content: v, sections: null };
  return v;
}

async function main() {
  const token = loadToken();
  if (!token) {
    process.stderr.write('Error: NOTION_TOKEN or NOTION_SKILLS_TOKEN is required\n');
    process.exit(2);
  }

  if (!constants.CLAUDE_MD_PAGE_ID) {
    process.stderr.write('Error: NOTION_CLAUDE_MD_PAGE_ID is not configured (set env var or notion.claude_md_page_id in spovishun-skills.config.yaml)\n');
    process.exit(2);
  }

  const { format, section } = parseArgs(process.argv.slice(2));

  if (!VALID_FORMATS.includes(format)) {
    process.stderr.write(`Error: invalid format "${format}". Valid: ${VALID_FORMATS.join(', ')}\n`);
    process.exit(1);
  }

  let entry = readCached();

  if (!entry) {
    entry = await loadContent(http.childrenPageFetcher(token), constants.CLAUDE_MD_PAGE_ID);
    cache.set(CACHE_KEY, entry);
  } else if (!entry.sections) {
    entry.sections = buildSectionIndex(entry.content);
  }

  const { content } = entry;

  if (section !== null) {
    process.stdout.write(extractSection(content, section) + '\n');
    return;
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify({ content }) + '\n');
    return;
  }

  process.stdout.write(content);
}

// Exported for unit tests. The CLI entry runs main() unconditionally below;
// the require.main guard keeps tests from triggering it.
module.exports = { parseArgs, loadContent, CACHE_KEY, VALID_FORMATS };

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
