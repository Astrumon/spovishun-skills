#!/usr/bin/env node
'use strict';

// bootstrap-config.js — fills spovishun-skills.config.yaml from a freshly
// duplicated Notion project template.
//
// The companion to the "Notion project template": a user duplicates the
// template page in Notion, then runs this BEFORE renaming anything. The
// extractor walks the copy by its fixed English anchor titles
// and resolves every Notion id the CLI scripts need, then either prints a
// ready `notion:` YAML block or patches the consumer's config in place.
//
// Why title-matching: after a Notion duplication every id changes, but titles
// survive verbatim. Titles are therefore the only stable signal to re-identify
// each anchor in the copy — hence the hard "run before rename" rule.
//
// Zero-dependency on purpose (no js-yaml), mirroring lib/config-reader.js, so
// it stays installable into any consumer's .claude/scripts/notion/ verbatim.

const fs = require('fs');
const path = require('path');
const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const { toDashed } = require('./lib/page-id');

// title (as authored in the template) → config key under notion.categories.
const CATEGORY_TITLE_TO_KEY = {
  'Architecture': 'architecture',
  'Database': 'database',
  'Testing': 'testing',
  'CI/CD': 'cicd',
  'Features': 'features',
  'AI Tools': 'aitools',
  'Epics': 'epics',
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests — no network, no fs side effects)
// ---------------------------------------------------------------------------

// Accepts a Notion page URL or a bare id and returns the dashed uuid.
// Notion URLs end in a 32-hex id (optionally after a slugged title); we take
// the last 32-hex run so query strings and titles don't interfere.
function parsePageId(input) {
  if (!input || typeof input !== 'string') return null;
  const matches = input.replace(/-/g, '').match(/[0-9a-f]{32}/gi);
  if (!matches || matches.length === 0) return null;
  return toDashed(matches[matches.length - 1].toLowerCase());
}

// Title of a child_page / child_database block, or '' for anything else.
function titleOfBlock(block) {
  if (!block || typeof block !== 'object') return '';
  if (block.type === 'child_page') return block.child_page?.title ?? '';
  if (block.type === 'child_database') return block.child_database?.title ?? '';
  return '';
}

// First child block of the given type whose title matches exactly.
function pickChild(children, type, title) {
  return (children || []).find(b => b.type === type && titleOfBlock(b) === title) || null;
}

// Line-based patcher: replaces the values of known notion.* keys (and the
// notion.categories.* sub-keys) in an existing config, preserving indentation,
// surrounding lines, and inline comments. Mirrors the manual scanner in
// config-reader.js rather than pulling in a YAML library.
//
// `values` maps flat keys to ids, e.g. { database_id, root_page_id,
// 'categories.architecture', ... }. Returns the patched string. Keys not
// present in the file are reported via the returned `missing` array.
function patchConfigYaml(yaml, values) {
  const topKeys = new Set([
    'database_id', 'root_page_id', 'docs_root_id',
    'claude_md_page_id', 'epics_database_id', 'epics_group_page_id',
  ]);
  const categoryKeys = new Set(Object.values(CATEGORY_TITLE_TO_KEY));

  const lines = yaml.split('\n');
  const applied = new Set();

  let inNotion = false;
  let inCategories = false;
  let categoriesIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Top-level section header (zero indent, `word:`).
    if (/^[A-Za-z0-9_]+:/.test(line)) {
      inNotion = line.startsWith('notion:');
      inCategories = false;
      categoriesIndent = -1;
      continue;
    }
    if (!inNotion) continue;

    const indentMatch = line.match(/^(\s+)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    if (indent === 0) continue;

    // Track entering / leaving the categories: sub-block.
    const headerMatch = line.match(/^(\s+)([A-Za-z0-9_]+):\s*$/);
    if (headerMatch && headerMatch[2] === 'categories') {
      inCategories = true;
      categoriesIndent = headerMatch[1].length;
      continue;
    }
    if (inCategories && indent <= categoriesIndent) {
      inCategories = false;
    }

    const kv = line.match(/^(\s+)([A-Za-z0-9_]+):(\s*)("[^"]*"|'[^']*'|[^\s#]+)?(\s*(?:#.*)?)$/);
    if (!kv) continue;
    const [, lead, key, gap, , trailing] = kv;

    let flatKey = null;
    if (inCategories && categoryKeys.has(key)) flatKey = `categories.${key}`;
    else if (!inCategories && topKeys.has(key)) flatKey = key;
    if (!flatKey || !(flatKey in values)) continue;

    lines[i] = `${lead}${key}:${gap || ' '}"${values[flatKey]}"${trailing || ''}`;
    applied.add(flatKey);
  }

  const missing = Object.keys(values).filter(k => !applied.has(k));
  return { yaml: lines.join('\n'), applied: [...applied], missing };
}

// Renders the resolved anchors as a `notion:` YAML block (for printing).
function renderYaml(anchors) {
  const c = anchors.categories;
  return [
    'notion:',
    `  database_id: "${anchors.database_id}"`,
    `  root_page_id: "${anchors.root_page_id}"`,
    `  docs_root_id: "${anchors.docs_root_id}"`,
    `  claude_md_page_id: "${anchors.claude_md_page_id}"`,
    `  epics_database_id: "${anchors.epics_database_id}"`,
    `  epics_group_page_id: "${anchors.epics_group_page_id}"`,
    '  categories:',
    `    architecture: "${c.architecture}"`,
    `    database: "${c.database}"`,
    `    testing: "${c.testing}"`,
    `    cicd: "${c.cicd}"`,
    `    features: "${c.features}"`,
    `    aitools: "${c.aitools}"`,
    `    epics: "${c.epics}"`,
  ].join('\n');
}

// Flattens the nested anchors object into the flat key map patchConfigYaml wants.
function flattenAnchors(anchors) {
  const flat = {
    database_id: anchors.database_id,
    root_page_id: anchors.root_page_id,
    docs_root_id: anchors.docs_root_id,
    claude_md_page_id: anchors.claude_md_page_id,
    epics_database_id: anchors.epics_database_id,
    epics_group_page_id: anchors.epics_group_page_id,
  };
  for (const [k, v] of Object.entries(anchors.categories)) flat[`categories.${k}`] = v;
  return flat;
}

// ---------------------------------------------------------------------------
// Network traversal
// ---------------------------------------------------------------------------

// All child blocks of a page/database, following pagination.
async function fetchChildren(token, blockId) {
  const out = [];
  let cursor;
  do {
    const qs = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const res = await http.get(token, `/v1/blocks/${toDashed(blockId)}/children${qs}`);
    if (res?.object === 'error') {
      throw new Error(`Notion API error reading children of ${blockId}: ${res.message || res.code}`);
    }
    out.push(...(res?.results || []));
    cursor = res?.has_more ? res.next_cursor : null;
  } while (cursor);
  return out;
}

// Walks the duplicated template tree and resolves every anchor by title.
// Throws with a precise message naming the first missing anchor so the user
// knows exactly which title drifted (or that they renamed before extracting).
async function extractAnchors(token, rootId) {
  const root = toDashed(rootId);
  const rootChildren = await fetchChildren(token, root);

  const boardPage = pickChild(rootChildren, 'child_page', 'Board');
  if (!boardPage) throw new Error('Anchor not found: child page "Board" under the root page');
  const docsPage = pickChild(rootChildren, 'child_page', 'Documentation');
  if (!docsPage) throw new Error('Anchor not found: child page "Documentation" under the root page');

  const boardChildren = await fetchChildren(token, boardPage.id);
  const tasksDb = pickChild(boardChildren, 'child_database', 'Tasks');
  if (!tasksDb) throw new Error('Anchor not found: child database "Tasks" under "Board"');

  const docsChildren = await fetchChildren(token, docsPage.id);
  const claudeMd = pickChild(docsChildren, 'child_page', 'CLAUDE.md');
  if (!claudeMd) throw new Error('Anchor not found: child page "CLAUDE.md" under "Documentation"');

  const categories = {};
  for (const [title, key] of Object.entries(CATEGORY_TITLE_TO_KEY)) {
    const page = pickChild(docsChildren, 'child_page', title);
    if (!page) throw new Error(`Anchor not found: category page "${title}" under "Documentation"`);
    categories[key] = page.id;
  }

  const epicsGroupPage = pickChild(docsChildren, 'child_page', 'Epics');
  const epicsChildren = await fetchChildren(token, epicsGroupPage.id);
  const epicsDb = pickChild(epicsChildren, 'child_database', 'Epics');
  if (!epicsDb) throw new Error('Anchor not found: child database "Epics" under "Epics"');

  return {
    root_page_id: root,
    database_id: tasksDb.id,
    docs_root_id: docsPage.id,
    claude_md_page_id: claudeMd.id,
    epics_database_id: epicsDb.id,
    epics_group_page_id: epicsGroupPage.id,
    categories,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let url = null;
  let write = false;
  let format = 'yaml';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') write = true;
    else if (a.startsWith('--format=')) format = a.slice(9);
    else if (a === '--format' && argv[i + 1]) format = argv[++i];
    else if (!a.startsWith('--')) url = a;
  }
  return { url, write, format };
}

async function main() {
  const token = loadToken();
  if (!token) {
    process.stderr.write('Error: NOTION_TOKEN or NOTION_SKILLS_TOKEN is required\n');
    process.exit(2);
  }

  const { url, write, format } = parseArgs(process.argv.slice(2));
  const rootId = parsePageId(url);
  if (!rootId) {
    process.stderr.write('Usage: bootstrap-config.js <new-template-page-url> [--write] [--format yaml|json]\n');
    process.exit(1);
  }

  const anchors = await extractAnchors(token, rootId);

  if (write) {
    const configPath = path.join(process.cwd(), 'spovishun-skills.config.yaml');
    if (!fs.existsSync(configPath)) {
      process.stderr.write(`Error: ${configPath} not found. Run from the new project's repo root.\n`);
      process.exit(1);
    }
    const original = fs.readFileSync(configPath, 'utf8');
    const { yaml: patched, missing } = patchConfigYaml(original, flattenAnchors(anchors));
    fs.writeFileSync(configPath, patched, 'utf8');
    if (missing.length > 0) {
      process.stderr.write(`Warning: these keys were absent from the config and not written: ${missing.join(', ')}\n`);
    }
    process.stdout.write(`Wrote ${Object.keys(flattenAnchors(anchors)).length - missing.length} Notion ids into ${configPath}\n`);
    return;
  }

  if (format === 'json') {
    process.stdout.write(JSON.stringify(anchors, null, 2) + '\n');
  } else {
    process.stdout.write(renderYaml(anchors) + '\n');
  }
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parsePageId,
  titleOfBlock,
  pickChild,
  patchConfigYaml,
  renderYaml,
  flattenAnchors,
  extractAnchors,
  fetchChildren,
  CATEGORY_TITLE_TO_KEY,
};
