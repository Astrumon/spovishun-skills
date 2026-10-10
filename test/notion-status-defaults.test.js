import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// The two sides that drifted apart (spovishun-193): create-task.js decides what
// Status a new task carries, get-board.js decides which Statuses the default
// listing shows. Nothing forced them to agree, so a task created with defaults
// was invisible on the default board. Both are CommonJS with a
// `require.main === module` guard, so requiring them runs no CLI.
const createTask = require(join(here, '..', 'scripts', 'notion', 'create-task.js'));
const getBoard = require(join(here, '..', 'scripts', 'notion', 'get-board.js'));
const { TODO_GROUP_STATUSES, DEFAULT_TASK_STATUS } = require(join(here, '..', 'hooks', 'notion-constants.js'));

/** Evaluates a Notion filter tree against a single Status value. */
function matchesStatus(filter, status) {
  if (!filter) return true;
  if (Array.isArray(filter.or)) return filter.or.some(f => matchesStatus(f, status));
  if (Array.isArray(filter.and)) return filter.and.every(f => matchesStatus(f, status));
  if (filter.property !== 'Status') return true;
  return filter.status?.equals === status;
}

function defaultCreatedStatus() {
  const props = createTask.buildProperties({
    title: 'feature/demo-1: regression fixture',
    priority: 'Medium',
    status: undefined,
    stage: undefined,
    epicId: null,
    blockedByIds: [],
  });
  return props.Status.status.name;
}

test('a task created with defaults appears in the default get-board listing', () => {
  const filter = getBoard.buildListFilter({ status: null, epicFilter: null, stageFilter: null });
  assert.ok(
    matchesStatus(filter, defaultCreatedStatus()),
    `create-task.js default Status "${defaultCreatedStatus()}" does not satisfy the default ` +
    `get-board.js filter ${JSON.stringify(filter)}`
  );
});

test('the default status survives an added --stage filter', () => {
  const stageFilter = { property: 'Stage', select: { equals: 'Sprint' } };
  const filter = getBoard.buildListFilter({ status: null, epicFilter: null, stageFilter });
  assert.ok(matchesStatus(filter, defaultCreatedStatus()));
});

test('DEFAULT_STATUS is a member of the to_do group', () => {
  assert.ok(TODO_GROUP_STATUSES.includes(createTask.DEFAULT_STATUS));
});

test('every to_do group member is a valid board status', () => {
  for (const status of TODO_GROUP_STATUSES) {
    assert.ok(getBoard.VALID_STATUSES.includes(status), `"${status}" is not in VALID_STATUSES`);
    assert.ok(createTask.VALID_STATUSES.includes(status), `"${status}" is not accepted by create-task.js`);
  }
});

// hooks/task-picker.js destructures exactly two phases out of this list — a
// primary status and one fallback that carries the --from-not-started promotion.
// Growing the group means teaching the picker to loop, not just adding a string.
test('the to_do group has exactly the two phases task-picker.js walks', () => {
  assert.deepEqual(TODO_GROUP_STATUSES, ['To do', 'Not started']);
});

// One default, declared once (spovishun-201): create-task.js must not grow its
// own literal again, and the default must be the group's preferred member — the
// status the picker offers first and the one task format v2 keeps.
test('create-task.js takes its default from DEFAULT_TASK_STATUS', () => {
  assert.equal(createTask.DEFAULT_STATUS, DEFAULT_TASK_STATUS);
  assert.equal(defaultCreatedStatus(), DEFAULT_TASK_STATUS);
});

test('DEFAULT_TASK_STATUS is the preferred to_do member and a valid board status', () => {
  assert.equal(DEFAULT_TASK_STATUS, TODO_GROUP_STATUSES[0]);
  assert.ok(getBoard.VALID_STATUSES.includes(DEFAULT_TASK_STATUS));
  assert.ok(createTask.VALID_STATUSES.includes(DEFAULT_TASK_STATUS));
});
