#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const constants = require('./lib/constants');
const { richText } = require('./lib/format-task');

const VALID_FORMATS = ['json', 'md', 'text'];
const VALID_STATUSES = ['Planned', 'Active', 'Completed'];

function parseArgs(argv) {
  let format = 'json';
  let status = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--format=')) { format = argv[i].slice(9); }
    else if (argv[i] === '--format' && argv[i + 1]) { format = argv[++i]; }
    else if (argv[i].startsWith('--status=')) { status = argv[i].slice(9); }
    else if (argv[i] === '--status' && argv[i + 1]) { status = argv[++i]; }
  }
  return { format, status };
}

function mapEpic(page) {
  const props = page.properties || {};
  return {
    id: page.id,
    url: page.url,
    title: richText(props.Name?.title),
    status: props.Status?.select?.name ?? null,
    goal: richText(props.Goal?.rich_text),
    relatedTask: props['Related Notion task']?.url ?? null,
  };
}

function renderMd(epics) {
  if (epics.length === 0) return '*(no epics)*';
  const rows = epics.map(e => `| ${e.title} | ${e.status ?? ''} | ${e.goal ?? ''} |`);
  return ['| Title | Status | Goal |', '|-------|--------|------|', ...rows].join('\n');
}

function renderText(epics) {
  if (epics.length === 0) return '(no epics)';
  return epics.map((e, i) => `${i + 1}. [${e.status ?? '-'}] ${e.title} — ${e.goal ?? ''}`).join('\n');
}

async function main() {
  const token = loadToken();
  if (!token) {
    process.stderr.write('Error: NOTION_TOKEN or NOTION_SKILLS_TOKEN is required\n');
    process.exit(2);
  }

  if (!constants.EPICS_DATABASE_ID) {
    process.stderr.write('Error: NOTION_EPICS_DATABASE_ID is not configured (set env var or notion.epics_database_id in spovishun-skills.config.yaml)\n');
    process.exit(2);
  }

  const { format, status } = parseArgs(process.argv.slice(2));

  if (!VALID_FORMATS.includes(format)) {
    process.stderr.write(`Error: invalid format "${format}". Valid: ${VALID_FORMATS.join(', ')}\n`);
    process.exit(1);
  }
  if (status && !VALID_STATUSES.includes(status)) {
    process.stderr.write(`Error: invalid status "${status}". Valid: ${VALID_STATUSES.join(', ')}\n`);
    process.exit(1);
  }

  const body = {
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: 50,
  };
  if (status) {
    body.filter = { property: 'Status', select: { equals: status } };
  }

  const result = await http.post(token, `/v1/databases/${constants.EPICS_DATABASE_ID}/query`, body);
  if (result?.object === 'error') {
    process.stderr.write(`Notion API error: ${result.message || result.code}\n`);
    process.exit(1);
  }

  const epics = (result.results || []).map(mapEpic);

  if (format === 'md') {
    process.stdout.write(renderMd(epics) + '\n');
  } else if (format === 'text') {
    process.stdout.write(renderText(epics) + '\n');
  } else {
    process.stdout.write(JSON.stringify(epics) + '\n');
  }
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
