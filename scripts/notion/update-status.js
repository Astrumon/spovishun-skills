#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const { toDashed } = require('./lib/page-id');

const VALID_STATUSES = ['Not started', 'To do', 'In progress', 'Done'];

async function main() {
  const token = loadToken();
  if (!token) {
    process.stderr.write('Error: NOTION_TOKEN or NOTION_SKILLS_TOKEN is required\n');
    process.exit(2);
  }

  const [taskId, newStatus] = process.argv.slice(2);

  if (!taskId) {
    process.stderr.write('Usage: update-status.js <task-id> <new-status>\n');
    process.exit(1);
  }
  if (!newStatus) {
    process.stderr.write(`Usage: update-status.js <task-id> <new-status>\nValid statuses: ${VALID_STATUSES.join(', ')}\n`);
    process.exit(1);
  }
  if (!VALID_STATUSES.includes(newStatus)) {
    process.stderr.write(`Error: invalid status "${newStatus}". Valid: ${VALID_STATUSES.join(', ')}\n`);
    process.exit(1);
  }

  const dashedId = toDashed(taskId);
  const result = await http.patch(token, `/v1/pages/${dashedId}`, {
    properties: { Status: { status: { name: newStatus } } },
  });

  if (result?.object === 'error') {
    process.stderr.write(`Notion API error: ${result.message || result.code}\n`);
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({ id: result.id, status: result.properties?.Status?.status?.name ?? newStatus }) + '\n');
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
