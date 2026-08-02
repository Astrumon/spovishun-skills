import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeWorkspace, initRepo, runHook, page } from './helpers/hook-harness.js';

// The picker's product is a DIRECTIVE on stdout that Claude executes verbatim —
// the AskUserQuestion block, the `--apply-pick` command lines, the flags that
// ride along. That text is the hook's output contract, so these tests assert on
// it rather than on internal state.
//
// Route order matters: queryByPriorityTier walks High → Medium → Low → any, so
// each POST /query route below answers one tier in declaration order.

const CONFIG = [
  'project:',
  '  name: "Demo"',
  'stack:',
  '  notion: true',
  'git:',
  '  dev_branch: "develop"',
  'notion:',
  '  database_id: "db-1"',
  '',
].join('\n');

const ID_A = 'aaaaaaaa11112222333344445555bbbb';
const ID_B = 'bbbbbbbb11112222333344445555cccc';
const ID_C = 'cccccccc11112222333344445555dddd';

const query = (results) => ({ method: 'POST', path: '/v1/databases/db-1/query', body: { results } });
const emptyTiers = (n) => Array.from({ length: n }, () => query([]));

function pickerWorkspace({ selected = null, branch = null, config = CONFIG } = {}) {
  const cwd = makeWorkspace({ config });
  const git = initRepo(cwd);
  if (branch) git('checkout', '-b', branch);
  if (selected) {
    mkdirSync(join(cwd, '.dev-context'), { recursive: true });
    writeFileSync(
      join(cwd, '.dev-context', 'selected-tasks.json'),
      JSON.stringify({ version: 1, tasks: selected }, null, 2),
      'utf8'
    );
  }
  return cwd;
}

function startTask(cwd, routes, prompt = 'start new task') {
  return runHook({ cwd, stdin: JSON.stringify({ prompt }), env: { NOTION_TOKEN: 'tok' }, routes });
}

test('a single available task is applied automatically, without asking the user', () => {
  const cwd = pickerWorkspace();
  const r = startTask(cwd, [
    query([page({ id: ID_A, name: 'feature/demo-42: Add ban command' })]),
    query([]), // the orphaned In-progress sweep
  ]);

  assert.equal(r.status, 0);
  assert.match(r.output, /Only one task available — apply automatically without asking the user/);
  assert.match(r.output, new RegExp(`--apply-pick ${ID_A}`));
  assert.doesNotMatch(r.output, /AskUserQuestion/, 'one option needs no question');
  assert.match(r.output, /invoke the `notion-task-to-code` skill/);
  assert.match(r.output, /If stderr starts with `CONFLICT:`/);
});

test('several available tasks produce an AskUserQuestion block with one option each', () => {
  const cwd = pickerWorkspace();
  const r = startTask(cwd, [
    query([
      page({ id: ID_A, name: 'feature/demo-42: Add ban command' }),
      page({ id: ID_B, name: 'feature/demo-43: Fix the parser' }),
    ]),
    query([]),
  ]);

  assert.match(r.output, /Call `AskUserQuestion`/);
  assert.match(r.output, /multiSelect: true/);
  assert.match(r.output, new RegExp(`\\{label: "demo-42 — Add ban command", value: "${ID_A}"\\}`));
  assert.match(r.output, new RegExp(`\\{label: "demo-43 — Fix the parser", value: "${ID_B}"\\}`));
  assert.match(r.output, /\{label: "Cancel", value: "cancel"\}/);
  // Second and later picks must not check out — parallel tasks run in separate instances.
  assert.match(r.output, /2nd\+ task:.*--no-switch/);
});

test('an empty "To do" board falls through to "Not started" and flags the promotion', () => {
  const cwd = pickerWorkspace();
  const r = startTask(cwd, [
    ...emptyTiers(4), // To do: High, Medium, Low, any-priority fallback
    query([page({ id: ID_A, name: 'feature/demo-9: Later work', status: 'Not started' })]),
    query([]),
  ]);

  assert.match(r.output, /No "To do" tasks found — showing "Not started"/);
  assert.match(r.output, /--apply-pick \w+ --from-not-started/);
});

test('untracked "In progress" tasks are listed first for recovery', () => {
  const cwd = pickerWorkspace();
  const r = startTask(cwd, [
    query([page({ id: ID_A, name: 'feature/demo-42: Add ban command' })]),
    query([page({ id: ID_C, name: 'feature/demo-8: Half-done thing', status: 'In progress' })]),
  ]);

  assert.match(r.output, /Untracked "In progress" tasks found — listed first for recovery/);
  assert.match(r.output, /1\. \*\*demo-8\*\*.*\n.*\n2\. \*\*demo-42\*\*/);
  assert.match(r.output, /\(In progress — untracked\)/);
  assert.match(r.output, new RegExp(`\\{label: "demo-8 — Half-done thing \\(resume\\)", value: "${ID_C}"\\}`));
});

test('nothing anywhere reports "No Tasks Available" instead of failing silently', () => {
  const cwd = pickerWorkspace();
  const r = startTask(cwd, [...emptyTiers(8), query([])]);
  assert.equal(r.status, 0);
  assert.match(r.output, /## No Tasks Available/);
});

test('tasks already selected are excluded from the candidate list', () => {
  const cwd = pickerWorkspace({
    selected: [{ pageId: ID_A, taskNumber: '42', name: 'x', branch: 'feature/demo-42-x', status: 'In progress' }],
  });
  const r = startTask(cwd, [
    { method: 'GET', path: '/v1/pages/', body: page({ id: ID_A, name: 'x', status: 'In progress' }) },
    query([
      page({ id: ID_A, name: 'feature/demo-42: Add ban command' }),
      page({ id: ID_B, name: 'feature/demo-43: Fix the parser' }),
    ]),
    query([]),
  ]);

  assert.doesNotMatch(r.output, new RegExp(ID_A), 'an active task must not be offered twice');
  assert.match(r.output, new RegExp(ID_B));
  assert.match(r.output, /1 task\(s\) currently active/);
});

test('an active task that left To do / In progress resets the selection file', () => {
  const cwd = pickerWorkspace({
    selected: [{ pageId: ID_A, taskNumber: '42', name: 'x', branch: 'feature/demo-42-x', status: 'In progress' }],
  });
  const r = startTask(cwd, [
    { method: 'GET', path: '/v1/pages/', body: page({ id: ID_A, name: 'x', status: 'Done' }) },
    query([page({ id: ID_B, name: 'feature/demo-43: Fix the parser' })]),
    query([]),
  ]);

  const state = JSON.parse(readFileSync(join(cwd, '.dev-context', 'selected-tasks.json'), 'utf8'));
  assert.deepEqual(state.tasks, [], 'a task finished elsewhere must stop counting as active');
  assert.doesNotMatch(r.output, /task\(s\) currently active/);
});

test('being on an active task branch resumes from cache and re-asserts In progress', () => {
  const branch = 'feature/demo-42-add-ban-command';
  const cwd = pickerWorkspace({
    branch,
    selected: [{ pageId: ID_A, taskNumber: '42', name: 'x', branch, status: 'In progress' }],
  });
  const ctx = join(cwd, '.dev-context', branch.replace(/\//g, '-') + '_prd');
  mkdirSync(ctx, { recursive: true });
  writeFileSync(join(ctx, 'context.md'), '## Active Task (Notion)\n**demo-42**\n', 'utf8');

  const r = startTask(cwd, [
    { method: 'GET', path: '/v1/pages/', body: page({ id: ID_A, name: 'x', status: 'In progress' }) },
    { method: 'PATCH', path: '/v1/pages/', body: { object: 'page' } },
  ]);

  assert.match(r.output, /\*\*demo-42\*\*/);
  assert.match(r.output, /Already on active task branch — skipping checkout/);
  assert.match(r.output, /You MUST call the EnterPlanMode tool immediately/);
  const patch = r.requests.find((q) => q.method === 'PATCH');
  assert.equal(patch.body.properties.Status.status.name, 'In progress');
  assert.equal(
    r.requests.some((q) => q.path.includes('/query')), false,
    'a resumable branch must not re-query the board'
  );
});

test('the grill modifier changes the directive instead of entering Plan Mode directly', () => {
  const cwd = pickerWorkspace();
  const r = startTask(cwd, [
    query([page({ id: ID_A, name: 'feature/demo-42: Add ban command' })]),
    query([]),
  ], 'start new task with grill');

  assert.match(r.output, /grillFirst=true/);
  assert.match(r.output, /runs `grill-me` to stress-test the plan/);
});

test('a configured Stage filter is AND-ed into every board query', () => {
  const config = CONFIG.replace('  database_id: "db-1"', '  database_id: "db-1"\n  picker:\n    stage_filter: "Sprint"');
  const cwd = pickerWorkspace({ config });
  const r = startTask(cwd, [
    query([page({ id: ID_A, name: 'feature/demo-42: Add ban command' })]),
    query([]),
  ]);

  const queries = r.requests.filter((q) => q.path.includes('/query'));
  assert.ok(queries.length >= 2);
  for (const q of queries) {
    const clauses = JSON.stringify(q.body.filter);
    assert.match(clauses, /"property":"Stage","select":\{"equals":"Sprint"\}/, `missing Stage clause in ${clauses}`);
  }
});

test('a picker failure is logged and still exits 0 — the session must survive', () => {
  const cwd = pickerWorkspace();
  const r = startTask(cwd, [
    { method: 'POST', path: '/v1/databases/db-1/query', networkError: 'socket hang up' },
  ]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /Picker error: socket hang up/);
  assert.equal(r.stdout, '');
});
