#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const { toDashed } = require('./lib/page-id');

async function main() {
  const token = loadToken();
  if (!token) {
    process.stderr.write('Error: NOTION_TOKEN or NOTION_SKILLS_TOKEN is required\n');
    process.exit(2);
  }

  const args = process.argv.slice(2);
  let unarchive = false;
  const positional = [];
  for (const a of args) {
    if (a === '--unarchive') unarchive = true;
    else positional.push(a);
  }
  const taskId = positional[0];

  if (!taskId) {
    process.stderr.write('Usage: archive-task.js <pageId> [--unarchive]\n');
    process.stderr.write('Note: this script accepts a page id only (not a <prefix>-N task number).\n');
    process.exit(1);
  }

  const dashedId = toDashed(taskId);
  const result = await http.patch(token, `/v1/pages/${dashedId}`, {
    archived: !unarchive,
  });

  if (result?.object === 'error') {
    process.stderr.write(`Notion API error: ${result.message || result.code}\n`);
    process.exit(1);
  }

  process.stdout.write(JSON.stringify({ id: result.id, archived: result.archived }) + '\n');
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
