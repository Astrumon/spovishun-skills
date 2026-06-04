#!/usr/bin/env node
'use strict';

const http = require('./lib/notion-http');
const { loadToken } = require('./lib/load-token');
const constants = require('./lib/constants');
const { toDashed } = require('./lib/page-id');

const VALID_PRIORITIES = ['High', 'Medium', 'Low'];
// Board v2 (Scrum) Stage. New tasks default to Backlog so they appear in the
// Backlog view (`Stage = Backlog`) and can be promoted into a Sprint. Pass
// `stage` on stdin to override. Boards without a Stage property (Board v1)
// should set `stage: null` to omit the Stage field entirely.
const VALID_STAGES = ['Backlog', 'Sprint', 'Archive'];
const DEFAULT_STAGE = 'Backlog';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function normalizeRelationIds(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    process.stderr.write(`Error: "${fieldName}" must be an array of page IDs\n`);
    process.exit(1);
  }
  return value.map(id => {
    if (typeof id !== 'string' || !id.trim()) {
      process.stderr.write(`Error: "${fieldName}" entries must be non-empty strings\n`);
      process.exit(1);
    }
    return toDashed(id.trim());
  });
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

  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write('Error: invalid JSON on stdin\n');
    process.exit(1);
  }

  const { title, priority, content, icon, epicId, blockedBy, stage } = input;

  if (!title || typeof title !== 'string' || !title.trim()) {
    process.stderr.write('Error: "title" is required and must be a non-empty string\n');
    process.exit(1);
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    process.stderr.write(`Error: "priority" must be one of: ${VALID_PRIORITIES.join(', ')}\n`);
    process.exit(1);
  }
  if (stage !== undefined && stage !== null && !VALID_STAGES.includes(stage)) {
    process.stderr.write(`Error: "stage" must be one of: ${VALID_STAGES.join(', ')} (or null to omit)\n`);
    process.exit(1);
  }
  if (content !== undefined && typeof content !== 'string') {
    process.stderr.write('Error: "content" must be a string\n');
    process.exit(1);
  }
  if (epicId !== undefined && epicId !== null && (typeof epicId !== 'string' || !epicId.trim())) {
    process.stderr.write('Error: "epicId" must be a non-empty string when provided\n');
    process.exit(1);
  }

  const blockedByIds = normalizeRelationIds(blockedBy, 'blockedBy');

  const properties = {
    Name: { title: [{ type: 'text', text: { content: title.trim() } }] },
    Priority: { select: { name: priority } },
    Status: { status: { name: 'To do' } },
  };
  // stage === null means "Board v1, no Stage column"; omit. Default = Backlog.
  if (stage !== null) {
    properties.Stage = { select: { name: stage ?? DEFAULT_STAGE } };
  }
  if (epicId) {
    properties.Epic = { relation: [{ id: toDashed(epicId.trim()) }] };
  }
  if (blockedByIds.length > 0) {
    properties['Blocked by'] = { relation: blockedByIds.map(id => ({ id })) };
  }

  const body = {
    parent: { database_id: constants.DATABASE_ID },
    properties,
    children: content
      ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }]
      : [],
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
