import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { installClaude } from '../adapters/claude/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');

// Sentinel ids. Picked so the assertions can pinpoint the exact bug: a 1.2.0/1.2.1
// regression interpolated these database_ids into MCP `type: "data_source_id"`
// parents, which Notion rejects with 404 object_not_found.
const BOARD_DB_ID = 'aaaaaaaa11111111bbbbbbbb22222222';
const EPICS_DB_ID = 'cccccccc33333333dddddddd44444444';

function makeConsumer() {
  const dir = mkdtempSync(join(tmpdir(), 'notion-render-'));
  writeFileSync(
    join(dir, 'spovishun-skills.config.yaml'),
    [
      'project:',
      '  name: "RenderTest"',
      '  language: "uk"',
      'stack:',
      '  kotlin: true',
      '  postgres: false',
      '  telegram: false',
      '  notion: true',
      '  docker: false',
      'git:',
      '  branch_prefix: "feature/rt"',
      '  main_branch: "main"',
      '  dev_branch: "develop"',
      'notion:',
      '  token_env: "NOTION_TOKEN"',
      `  database_id: "${BOARD_DB_ID}"`,
      `  epics_database_id: "${EPICS_DB_ID}"`,
      '',
    ].join('\n'),
    'utf8'
  );
  return dir;
}

async function installAll() {
  const consumer = makeConsumer();
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(PKG_ROOT);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts, warn: { write: () => {} } });
  return consumer;
}

function readSkill(consumer, id) {
  return readFileSync(join(consumer, '.claude', 'skills', id, 'SKILL.md'), 'utf8');
}

// Patterns to scan rendered output for the bug. We do NOT match on the raw
// `{{NOTION_...}}` token: the template renderer would have thrown
// UNKNOWN_PLACEHOLDER long before this test if the manifest still declared
// the removed key. Instead we check that no expanded `data_source_id: "<32-hex>"`
// value equals a database_id.
const DATA_SOURCE_VALUE_RE = /data_source_id:\s*"([0-9a-f]{32}|[0-9a-f-]{36})"/gi;

function dbIdLeakedAsDataSource(content, dbIds) {
  for (const m of content.matchAll(DATA_SOURCE_VALUE_RE)) {
    const value = m[1].replace(/-/g, '').toLowerCase();
    if (dbIds.has(value)) return value;
  }
  return null;
}

test('newtask renders MCP create with type: "database_id" and the real database_id', async () => {
  const consumer = await installAll();
  const body = readSkill(consumer, 'newtask');

  assert.match(body, /type:\s*"database_id"/, 'must use database_id parent type');
  assert.ok(body.includes(BOARD_DB_ID), 'must interpolate the board database_id');
  const leaked = dbIdLeakedAsDataSource(body, new Set([BOARD_DB_ID, EPICS_DB_ID]));
  assert.equal(leaked, null, `database_id leaked as data_source_id value: ${leaked}`);
});

test('newepic renders MCP create with type: "database_id" and the epics database_id', async () => {
  const consumer = await installAll();
  const body = readSkill(consumer, 'newepic');

  assert.match(body, /type:\s*"database_id"/);
  assert.ok(body.includes(EPICS_DB_ID), 'must interpolate the epics database_id');
  const leaked = dbIdLeakedAsDataSource(body, new Set([BOARD_DB_ID, EPICS_DB_ID]));
  assert.equal(leaked, null, `database_id leaked as data_source_id value: ${leaked}`);
});

test('notion-spovishun-task-manager renders MCP create with type: "database_id"', async () => {
  const consumer = await installAll();
  const body = readSkill(consumer, 'notion-spovishun-task-manager');

  assert.match(body, /type:\s*"database_id"/);
  const leaked = dbIdLeakedAsDataSource(body, new Set([BOARD_DB_ID, EPICS_DB_ID]));
  assert.equal(leaked, null, `database_id leaked as data_source_id value: ${leaked}`);
});

test('task-decomposer no longer interpolates collection://<database_id> URL', async () => {
  const consumer = await installAll();
  const body = readSkill(consumer, 'task-decomposer');

  // The Step 0 board lookup used to read:
  //   notion-search(query: "", data_source_url: "collection://{{NOTION_BOARD_COLLECTION_ID}}")
  // Both the placeholder and the literal "collection://<db-id>" form would fail.
  assert.ok(
    !body.includes(`collection://${BOARD_DB_ID}`),
    'must not interpolate the database_id into a collection:// URL'
  );
  // The Step 0.5 epic-create MCP call must use database_id parent now.
  assert.match(body, /type:\s*"database_id"/);
});

test('notion-navigator prose references NOTION_DATABASE_ID + NOTION_EPICS_DATABASE_ID', async () => {
  const consumer = await installAll();
  const body = readSkill(consumer, 'notion-navigator');

  assert.ok(body.includes(BOARD_DB_ID), 'board database_id must be referenced');
  assert.ok(body.includes(EPICS_DB_ID), 'epics database_id must be referenced');
});

test('newtask passes an explicit Stage in both create paths (Board v2)', async () => {
  const consumer = await installAll();
  const body = readSkill(consumer, 'newtask');

  // Since spovishun-107 the stage is chosen in Step 3.7 (Backlog default,
  // Sprint opt-in) and passed explicitly to both the script stdin JSON and
  // the MCP properties block.
  assert.match(body, /"stage":\s*"<Backlog \| Sprint/, 'create-task.js stdin JSON must carry an explicit stage');
  assert.match(body, /"Stage":\s*"<Backlog \| Sprint/, 'MCP create call must carry an explicit Stage property');
  assert.ok(body.includes('Backlog** (default)'), 'Backlog must be documented as the default stage');
});

test('every Notion-related skill installs cleanly (no UNKNOWN_PLACEHOLDER thrown)', async () => {
  // Implicit: if any rendered body still referenced a removed
  // NOTION_BOARD_COLLECTION_ID / NOTION_EPICS_DATA_SOURCE_ID token, installAll()
  // would have thrown ConfigError(UNKNOWN_PLACEHOLDER). Reaching this assertion
  // is the proof.
  const consumer = await installAll();
  for (const id of [
    'newtask',
    'newepic',
    'notion-spovishun-task-manager',
    'task-decomposer',
    'notion-navigator',
  ]) {
    const body = readSkill(consumer, id);
    assert.ok(body.length > 0, `${id} body must be non-empty`);
    assert.ok(!body.includes('NOTION_BOARD_COLLECTION_ID'), `${id} still references removed key`);
    assert.ok(!body.includes('NOTION_EPICS_DATA_SOURCE_ID'), `${id} still references removed key`);
  }
});
