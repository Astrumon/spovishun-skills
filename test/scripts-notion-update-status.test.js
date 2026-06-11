import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// scripts/notion/update-status.js is CommonJS. It exports the pure helpers
// (parseArgs, buildProperties) and only invokes main() when run directly —
// see the `require.main === module` guard.
const updateStatus = require(join(here, '..', 'scripts', 'notion', 'update-status.js'));

test('parseArgs: positional contract <task-id> <new-status> is preserved', () => {
  const { taskId, newStatus, stage } = updateStatus.parseArgs(['abc123', 'Done']);
  assert.equal(taskId, 'abc123');
  assert.equal(newStatus, 'Done');
  assert.equal(stage, null);
});

test('parseArgs: --stage alone leaves newStatus null', () => {
  const { taskId, newStatus, stage } = updateStatus.parseArgs(['abc123', '--stage', 'Sprint']);
  assert.equal(taskId, 'abc123');
  assert.equal(newStatus, null);
  assert.equal(stage, 'Sprint');
});

test('parseArgs: status and --stage= combine in one call', () => {
  const { taskId, newStatus, stage } = updateStatus.parseArgs(['abc123', 'Done', '--stage=Archive']);
  assert.equal(taskId, 'abc123');
  assert.equal(newStatus, 'Done');
  assert.equal(stage, 'Archive');
});

test('parseArgs: missing args yield undefined taskId / null status (main rejects)', () => {
  const parsed = updateStatus.parseArgs([]);
  assert.equal(parsed.taskId, undefined);
  assert.equal(parsed.newStatus, null);
  assert.equal(parsed.stage, null);
});

test('buildProperties: status only', () => {
  assert.deepEqual(updateStatus.buildProperties('Done', null), {
    Status: { status: { name: 'Done' } },
  });
});

test('buildProperties: stage only', () => {
  assert.deepEqual(updateStatus.buildProperties(null, 'Sprint'), {
    Stage: { select: { name: 'Sprint' } },
  });
});

test('buildProperties: both status and stage in a single PATCH payload', () => {
  assert.deepEqual(updateStatus.buildProperties('Done', 'Archive'), {
    Status: { status: { name: 'Done' } },
    Stage: { select: { name: 'Archive' } },
  });
});

test('validation contracts: stage and status value lists', () => {
  assert.deepEqual(updateStatus.VALID_STAGES, ['Backlog', 'Sprint', 'Archive']);
  assert.deepEqual(updateStatus.VALID_STATUSES, ['Not started', 'To do', 'In progress', 'Done']);
});
