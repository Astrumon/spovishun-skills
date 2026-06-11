import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// scripts/notion/create-task.js is CommonJS. It exports the pure helper
// buildProperties and only invokes main() when run directly — see the
// `require.main === module` guard.
const createTask = require(join(here, '..', 'scripts', 'notion', 'create-task.js'));

function build(input = {}) {
  return createTask.buildProperties({
    title: 'feature/x-1: demo',
    priority: 'Medium',
    blockedByIds: [],
    ...input,
  });
}

test('default Status is "Not started" (newtask contract — tasks land in Backlog view)', () => {
  const props = build();
  assert.equal(props.Status.status.name, 'Not started');
  assert.equal(createTask.DEFAULT_STATUS, 'Not started');
});

test('explicit status overrides the default', () => {
  const props = build({ status: 'To do' });
  assert.equal(props.Status.status.name, 'To do');
});

test('default Stage is "Backlog"', () => {
  const props = build();
  assert.equal(props.Stage.select.name, 'Backlog');
});

test('explicit stage overrides the default', () => {
  const props = build({ stage: 'Sprint' });
  assert.equal(props.Stage.select.name, 'Sprint');
});

test('stage: null omits the Stage property entirely (Board v1)', () => {
  const props = build({ stage: null });
  assert.equal('Stage' in props, false);
});

test('validation contracts: status and stage value lists', () => {
  assert.deepEqual(createTask.VALID_STATUSES, ['Not started', 'To do', 'In progress', 'Done']);
  assert.deepEqual(createTask.VALID_STAGES, ['Backlog', 'Sprint', 'Archive']);
});
