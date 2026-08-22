#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const constants = require('./lib/constants');
const { richText, extractBlocks } = require('./lib/format-task');
const { fetchBlockTree } = require('./lib/block-tree');
const { extractBranchFromBlocks, deriveBranchFromName } = require('./lib/extract-branch');
const { toDashed } = require('./lib/page-id');
const { resolveRelationIds, extractRelationIds } = require('./lib/resolve-relations');
const { taskIdRegex, projectPrefix } = require('./lib/project-prefix');

const VALID_FORMATS = ['json', 'md', 'text'];

function parseArgs(argv) {
  let format = 'json';
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--format=')) { format = argv[i].slice(9); }
    else if (argv[i] === '--format' && argv[i + 1]) { format = argv[++i]; }
    else { positional.push(argv[i]); }
  }
  return { format, arg: positional[0] };
}

// A bare task number ("93") is shorthand for "<prefix>-93". Without this
// normalization the arg would fall through to toDashed() in resolvePageId
// and be sent as an invalid Notion page_id, producing
// "path.page_id should be a valid uuid".
function normalizeTaskArg(arg) {
  if (typeof arg !== 'string') return arg;
  if (/^\d+$/.test(arg)) return `${projectPrefix()}-${arg}`;
  return arg;
}

async function resolvePageId(token, rawArg) {
  const arg = normalizeTaskArg(rawArg);
  if (taskIdRegex().test(arg)) {
    const result = await http.post(token, `/v1/databases/${constants.DATABASE_ID}/query`, {
      filter: { property: 'Name', title: { contains: arg } },
      page_size: 1,
    });
    if (result?.object === 'error') {
      process.stderr.write(`Notion API error: ${result.message || result.code}\n`);
      process.exit(1);
    }
    const page = result?.results?.[0];
    if (!page) {
      process.stderr.write(`Error: task "${arg}" not found\n`);
      process.exit(1);
    }
    return page.id;
  }
  return toDashed(arg);
}

function renderMd(task) {
  const meta = [task.status, task.stage, task.priority, task.branch].filter(Boolean).join(' | ');
  const parts = [`# ${task.title}`];
  if (meta) parts.push(meta);
  if (task.epic) parts.push(`**Epic:** ${task.epic.title ?? task.epic.id}`);
  if (task.blockedBy && task.blockedBy.length > 0) {
    const list = task.blockedBy.map(b => `- ${b.title ?? b.id}`).join('\n');
    parts.push(`**Blocked by:**\n${list}`);
  }
  if (task.content) parts.push('---', task.content);
  return parts.join('\n\n');
}

function renderText(task) {
  const lines = [task.title];
  const meta = [task.status, task.stage, task.priority, task.branch].filter(Boolean).join(' | ');
  if (meta) lines.push(meta);
  if (task.epic) lines.push(`Epic: ${task.epic.title ?? task.epic.id}`);
  if (task.blockedBy && task.blockedBy.length > 0) {
    const list = task.blockedBy.map(b => `  - ${b.title ?? b.id}`).join('\n');
    lines.push(`Blocked by:\n${list}`);
  }
  if (task.content) {
    lines.push('');
    lines.push(task.content);
  }
  return lines.join('\n');
}

async function main() {
  const token = loadToken();
  if (!token) {
    process.stderr.write('Error: NOTION_TOKEN or NOTION_SKILLS_TOKEN is required\n');
    process.exit(2);
  }

  if (!constants.DATABASE_ID) {
    process.stderr.write('Error: NOTION_DATABASE_ID is not configured (set env var or notion.database_id in spovishun-skills.config.yaml)\n');
    process.exit(2);
  }

  const { format, arg } = parseArgs(process.argv.slice(2));

  if (!arg) {
    const p = projectPrefix();
    process.stderr.write(`Usage: get-task.js <${p}-N | N | pageId> [--format=json|md|text]\n`);
    process.exit(1);
  }

  if (!VALID_FORMATS.includes(format)) {
    process.stderr.write(`Error: invalid format "${format}". Valid: ${VALID_FORMATS.join(', ')}\n`);
    process.exit(1);
  }

  const pageId = await resolvePageId(token, arg);

  const [page, blocks] = await Promise.all([
    http.get(token, `/v1/pages/${pageId}`),
    // Hydrates nested blocks (toggle bodies, callout children, table rows) and
    // follows pagination, both of which a single /children call misses.
    fetchBlockTree(http.childrenPageFetcher(token), pageId),
  ]);

  if (page?.object === 'error') {
    process.stderr.write(`Notion API error: ${page.message || page.code}\n`);
    process.exit(1);
  }

  const props = page.properties || {};
  const title = richText(props.Name?.title);
  const epicIds = extractRelationIds(props.Epic);
  const blockedByIds = extractRelationIds(props['Blocked by']);
  const titleMap = await resolveRelationIds(token, [...epicIds, ...blockedByIds]);

  const task = {
    id: page.id,
    title,
    status: props.Status?.status?.name ?? null,
    // Board v2 Stage; null on Board v1 boards without the property.
    stage: props.Stage?.select?.name ?? null,
    branch: extractBranchFromBlocks(blocks) ?? deriveBranchFromName(title),
    priority: props.Priority?.select?.name ?? null,
    epic: epicIds[0]
      ? { id: epicIds[0], title: titleMap.get(epicIds[0]) ?? null }
      : null,
    blockedBy: blockedByIds.map(id => ({ id, title: titleMap.get(id) ?? null })),
    content: extractBlocks(blocks),
  };

  if (format === 'md') {
    process.stdout.write(renderMd(task) + '\n');
  } else if (format === 'text') {
    process.stdout.write(renderText(task) + '\n');
  } else {
    process.stdout.write(JSON.stringify(task) + '\n');
  }
}

// Exported for unit tests. The CLI entry runs main() unconditionally below;
// the require.main guard keeps tests from triggering it.
module.exports = { normalizeTaskArg, renderMd, renderText, resolvePageId, VALID_FORMATS };

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
