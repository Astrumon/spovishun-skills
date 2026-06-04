#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const constants = require('./lib/constants');
const { queryByPriorityTier } = require('./lib/query-tasks');
const { richText } = require('./lib/format-task');
const { deriveBranchFromName } = require('./lib/extract-branch');
const { resolveRelationIds, extractRelationIds } = require('./lib/resolve-relations');

const VALID_STATUSES = ['Not started', 'To do', 'In progress', 'Done'];
const VALID_FORMATS = ['json', 'md', 'text'];

function parseArgs(argv) {
  let priorityTier = false;
  let latest = false;
  let status = 'To do';
  let format = 'json';
  let epicFilter = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--priority-tier') { priorityTier = true; }
    else if (argv[i] === '--latest') { latest = true; }
    else if (argv[i] === '--status' && argv[i + 1]) { status = argv[++i]; }
    else if (argv[i].startsWith('--format=')) { format = argv[i].slice(9); }
    else if (argv[i] === '--format' && argv[i + 1]) { format = argv[++i]; }
    else if (argv[i].startsWith('--epic=')) { epicFilter = argv[i].slice(7); }
    else if (argv[i] === '--epic' && argv[i + 1]) { epicFilter = argv[++i]; }
  }
  return { priorityTier, latest, status, format, epicFilter };
}

function mapPageRaw(page) {
  const props = page.properties || {};
  const title = richText(props.Name?.title);
  return {
    id: page.id,
    title,
    status: props.Status?.status?.name ?? null,
    branch: deriveBranchFromName(title),
    priority: props.Priority?.select?.name ?? null,
    epicIds: extractRelationIds(props.Epic),
    blockedByIds: extractRelationIds(props['Blocked by']),
  };
}

function enrichWithRelations(rawTasks, titleMap) {
  return rawTasks.map(t => {
    const { epicIds, blockedByIds, ...rest } = t;
    return {
      ...rest,
      epic: epicIds[0]
        ? { id: epicIds[0], title: titleMap.get(epicIds[0]) ?? null }
        : null,
      blockedBy: blockedByIds.map(id => ({ id, title: titleMap.get(id) ?? null })),
    };
  });
}

function renderMd(tasks) {
  if (tasks.length === 0) return '*(no tasks)*';
  const rows = tasks.map(t => {
    const epic = t.epic?.title ?? '';
    const blockers = t.blockedBy.map(b => b.title ?? b.id.slice(0, 8)).join(', ');
    return `| ${t.title} | ${t.status ?? ''} | ${t.priority ?? ''} | ${epic} | ${blockers} |`;
  });
  return [
    '| Title | Status | Priority | Epic | Blocked by |',
    '|-------|--------|----------|------|------------|',
    ...rows,
  ].join('\n');
}

function renderText(tasks) {
  if (tasks.length === 0) return '(no tasks)';
  const pad = (s, n) => (s ?? '').padEnd(n);
  const epicLabel = t => t.epic?.title ?? '';
  const blockersLabel = t => t.blockedBy.map(b => b.title ?? b.id.slice(0, 8)).join(',');
  const maxTitle = Math.max(5, ...tasks.map(t => t.title.length));
  const maxStatus = Math.max(6, ...tasks.map(t => (t.status ?? '').length));
  const maxPriority = Math.max(8, ...tasks.map(t => (t.priority ?? '').length));
  const maxEpic = Math.max(4, ...tasks.map(t => epicLabel(t).length));
  const header = `${pad('Title', maxTitle)}  ${pad('Status', maxStatus)}  ${pad('Priority', maxPriority)}  ${pad('Epic', maxEpic)}  Blocked by`;
  const sep = `${'-'.repeat(maxTitle)}  ${'-'.repeat(maxStatus)}  ${'-'.repeat(maxPriority)}  ${'-'.repeat(maxEpic)}  ----------`;
  const rows = tasks.map(t =>
    `${pad(t.title, maxTitle)}  ${pad(t.status ?? '', maxStatus)}  ${pad(t.priority ?? '', maxPriority)}  ${pad(epicLabel(t), maxEpic)}  ${blockersLabel(t)}`
  );
  return [header, sep, ...rows].join('\n');
}

async function resolveEpicFilter(token, epicFilter) {
  if (!epicFilter) return null;
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(epicFilter)) {
    return epicFilter;
  }
  const result = await http.post(token, `/v1/databases/${constants.EPICS_DATABASE_ID}/query`, {
    filter: { property: 'Name', title: { contains: epicFilter } },
    page_size: 1,
  });
  if (result?.object === 'error') {
    process.stderr.write(`Notion API error resolving epic: ${result.message || result.code}\n`);
    process.exit(1);
  }
  const page = result?.results?.[0];
  if (!page) {
    process.stderr.write(`Error: epic "${epicFilter}" not found\n`);
    process.exit(1);
  }
  return page.id;
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

  const { priorityTier, latest, status, format, epicFilter } = parseArgs(process.argv.slice(2));

  if (!latest && !VALID_STATUSES.includes(status)) {
    process.stderr.write(`Error: invalid status "${status}". Valid: ${VALID_STATUSES.join(', ')}\n`);
    process.exit(1);
  }

  if (!VALID_FORMATS.includes(format)) {
    process.stderr.write(`Error: invalid format "${format}". Valid: ${VALID_FORMATS.join(', ')}\n`);
    process.exit(1);
  }

  const epicPageId = await resolveEpicFilter(token, epicFilter);

  let pages;

  if (latest) {
    const result = await http.post(token, `/v1/databases/${constants.DATABASE_ID}/query`, {
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 10,
    });
    if (result?.object === 'error') {
      process.stderr.write(`Notion API error: ${result.message || result.code}\n`);
      process.exit(1);
    }
    pages = result?.results || [];
  } else if (priorityTier) {
    const { candidates } = await queryByPriorityTier(http, token, status, new Set());
    pages = candidates;
  } else {
    const result = await http.post(token, `/v1/databases/${constants.DATABASE_ID}/query`, {
      filter: { property: 'Status', status: { equals: status } },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    });
    if (result?.object === 'error') {
      process.stderr.write(`Notion API error: ${result.message || result.code}\n`);
      process.exit(1);
    }
    pages = result?.results || [];
  }

  let rawTasks = pages.map(mapPageRaw);

  if (epicPageId) {
    const compact = epicPageId.replace(/-/g, '');
    rawTasks = rawTasks.filter(t => t.epicIds.some(id => id.replace(/-/g, '') === compact));
  }

  const relationIds = rawTasks.flatMap(t => [...t.epicIds, ...t.blockedByIds]);
  const titleMap = await resolveRelationIds(token, relationIds);
  const tasks = enrichWithRelations(rawTasks, titleMap);

  if (format === 'md') {
    process.stdout.write(renderMd(tasks) + '\n');
  } else if (format === 'text') {
    process.stdout.write(renderText(tasks) + '\n');
  } else {
    process.stdout.write(JSON.stringify(tasks) + '\n');
  }
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
