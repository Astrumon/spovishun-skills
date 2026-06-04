#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const constants = require('./lib/constants');
const cache = require('./lib/cache');
const { extractBlocks } = require('./lib/format-task');
const { buildSectionIndex, extractSection } = require('./lib/section-parser');

const CACHE_KEY = 'claude-md';
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
    const blocksResult = await http.get(token, `/v1/blocks/${constants.CLAUDE_MD_PAGE_ID}/children?page_size=100`);
    if (blocksResult?.object === 'error') {
      process.stderr.write(`Notion API error: ${blocksResult.message || blocksResult.code}\n`);
      process.exit(1);
    }
    const content = extractBlocks(blocksResult?.results || []);
    const sections = buildSectionIndex(content);
    cache.set(CACHE_KEY, { content, sections });
    entry = { content, sections };
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

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
