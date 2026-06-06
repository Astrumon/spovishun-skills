#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const constants = require('./lib/constants');
const { markdownToBlocks } = require('./lib/markdown-to-blocks');

const VALID_STATUSES = ['Planned', 'Active', 'Completed'];

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
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

  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write('Error: invalid JSON on stdin\n');
    process.exit(1);
  }

  const { name, goal, status, relatedNotionTask, icon, content } = input;

  if (!name || typeof name !== 'string' || !name.trim()) {
    process.stderr.write('Error: "name" is required and must be a non-empty string\n');
    process.exit(1);
  }
  if (goal !== undefined && typeof goal !== 'string') {
    process.stderr.write('Error: "goal" must be a string\n');
    process.exit(1);
  }
  const epicStatus = status ?? 'Planned';
  if (!VALID_STATUSES.includes(epicStatus)) {
    process.stderr.write(`Error: "status" must be one of: ${VALID_STATUSES.join(', ')}\n`);
    process.exit(1);
  }
  if (relatedNotionTask !== undefined && relatedNotionTask !== null && typeof relatedNotionTask !== 'string') {
    process.stderr.write('Error: "relatedNotionTask" must be a string URL\n');
    process.exit(1);
  }
  if (content !== undefined && typeof content !== 'string') {
    process.stderr.write('Error: "content" must be a string\n');
    process.exit(1);
  }

  const properties = {
    Name: { title: [{ type: 'text', text: { content: name.trim() } }] },
    Status: { select: { name: epicStatus } },
  };
  if (goal && goal.trim()) {
    properties.Goal = { rich_text: [{ type: 'text', text: { content: goal.trim() } }] };
  }
  if (relatedNotionTask && relatedNotionTask.trim()) {
    properties['Related Notion task'] = { url: relatedNotionTask.trim() };
  }

  const body = {
    parent: { database_id: constants.EPICS_DATABASE_ID },
    properties,
    // Parse markdown content into native Notion blocks instead of a single
    // paragraph; see lib/markdown-to-blocks.js for the supported syntax.
    children: content ? markdownToBlocks(content) : [],
  };

  if (icon && typeof icon === 'string') {
    body.icon = { type: 'emoji', emoji: icon };
  }

  const result = await http.post(token, '/v1/pages', body);

  if (result?.object === 'error') {
    process.stderr.write(`Notion API error: ${result.message || result.code}\n`);
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({ id: result.id, url: result.url }) + '\n');
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
