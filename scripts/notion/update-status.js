#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const { toDashed } = require('./lib/page-id');

const VALID_STATUSES = ['Not started', 'To do', 'In progress', 'Done'];
// Board v2 (Scrum) Stage select — promote Backlog → Sprint, freeze → Archive.
const VALID_STAGES = ['Backlog', 'Sprint', 'Archive'];

const USAGE = `Usage: update-status.js <task-id> [new-status] [--stage <stage>]
Valid statuses: ${VALID_STATUSES.join(', ')}
Valid stages: ${VALID_STAGES.join(', ')}
At least one of <new-status> or --stage is required.`;

// Returns { taskId, newStatus, stage } without validating values; the
// positional contract `update-status.js <task-id> <new-status>` is preserved.
function parseArgs(argv) {
  let stage = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--stage=')) { stage = argv[i].slice(8); }
    else if (argv[i] === '--stage' && argv[i + 1]) { stage = argv[++i]; }
    else { positional.push(argv[i]); }
  }
  return { taskId: positional[0], newStatus: positional[1] ?? null, stage };
}

function buildProperties(newStatus, stage) {
  const properties = {};
  if (newStatus) properties.Status = { status: { name: newStatus } };
  if (stage) properties.Stage = { select: { name: stage } };
  return properties;
}

async function main() {
  const token = loadToken();
  if (!token) {
    process.stderr.write('Error: NOTION_TOKEN or NOTION_SKILLS_TOKEN is required\n');
    process.exit(2);
  }

  const { taskId, newStatus, stage } = parseArgs(process.argv.slice(2));

  if (!taskId || (!newStatus && !stage)) {
    process.stderr.write(USAGE + '\n');
    process.exit(1);
  }
  if (newStatus && !VALID_STATUSES.includes(newStatus)) {
    process.stderr.write(`Error: invalid status "${newStatus}". Valid: ${VALID_STATUSES.join(', ')}\n`);
    process.exit(1);
  }
  if (stage && !VALID_STAGES.includes(stage)) {
    process.stderr.write(`Error: invalid stage "${stage}". Valid: ${VALID_STAGES.join(', ')}\n`);
    process.exit(1);
  }

  const dashedId = toDashed(taskId);
  const result = await http.patch(token, `/v1/pages/${dashedId}`, {
    properties: buildProperties(newStatus, stage),
  });

  if (result?.object === 'error') {
    process.stderr.write(`Notion API error: ${result.message || result.code}\n`);
    process.exit(1);
  }

  const output = { id: result.id };
  if (newStatus) output.status = result.properties?.Status?.status?.name ?? newStatus;
  if (stage) output.stage = result.properties?.Stage?.select?.name ?? stage;
  process.stdout.write(JSON.stringify(output) + '\n');
}

// Exported for unit tests; the require.main guard keeps tests from
// triggering the CLI entry — same pattern as get-task.js.
module.exports = { parseArgs, buildProperties, VALID_STATUSES, VALID_STAGES };

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
