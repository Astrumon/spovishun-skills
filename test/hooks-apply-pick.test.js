import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  makeWorkspace, initRepo, commitOnBranch, currentBranch, runHook, page, paragraph,
} from './helpers/hook-harness.js';

// `--apply-pick` is the only mode that mutates three systems at once — git, the
// .dev-context cache and the Notion board — and the only one that exits non-zero
// so Claude can surface the failure. Both properties are asserted here against
// the real CLI: a stubbed Notion, a real git repo, real files on disk.

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
const BRANCH_A = 'feature/demo-42-add-ban-command';

const blocks = (results) => ({ method: 'GET', path: '/children', body: { results } });
const getPage = (body) => ({ method: 'GET', path: '/v1/pages/', body });
const patchOk = () => ({ method: 'PATCH', path: '/v1/pages/', body: { object: 'page' } });

const TASK_BLOCKS = [
  { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Goal' }] } },
  { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Ban members.' }] } },
  { type: 'toggle', toggle: { rich_text: [{ plain_text: 'hidden detail' }] } },
];

function workspace() {
  const cwd = makeWorkspace({ config: CONFIG });
  initRepo(cwd);
  return cwd;
}

function applyPick(cwd, pageId, flags, routes) {
  return runHook({
    cwd, args: ['--apply-pick', pageId, ...flags],
    env: { NOTION_TOKEN: 'tok' }, routes,
  });
}

function ctxDirFor(cwd, branch) {
  return join(cwd, '.dev-context', branch.replace(/\//g, '-') + '_prd');
}

function selectedTasks(cwd) {
  return JSON.parse(readFileSync(join(cwd, '.dev-context', 'selected-tasks.json'), 'utf8')).tasks;
}

test('a To-do task is checked out, cached and moved to In progress', () => {
  const cwd = workspace();
  const r = applyPick(cwd, ID_A, [], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command' })),
    blocks(TASK_BLOCKS),
    patchOk(),
  ]);

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK: demo-42 activated on feature\/demo-42-add-ban-command/);
  assert.equal(currentBranch(cwd), BRANCH_A);

  const ctx = ctxDirFor(cwd, BRANCH_A);
  assert.match(readFileSync(join(ctx, 'context.md'), 'utf8'), /## Goal\nBan members\./);
  assert.doesNotMatch(readFileSync(join(ctx, 'context.md'), 'utf8'), /hidden detail/);
  assert.equal(readFileSync(join(ctx, 'branch.txt'), 'utf8'), BRANCH_A);
  assert.ok(existsSync(join(ctx, 'session.lock')));

  const task = JSON.parse(readFileSync(join(ctx, 'task.json'), 'utf8'));
  assert.equal(task.status, 'In progress');
  assert.equal(task.branch, BRANCH_A);

  assert.deepEqual(selectedTasks(cwd).map((t) => t.pageId), [ID_A]);
  const patch = r.requests.find((q) => q.method === 'PATCH');
  assert.equal(patch.body.properties.Status.status.name, 'In progress');
});

test('the branch declared in the page body wins over one derived from the title', () => {
  const cwd = workspace();
  const r = applyPick(cwd, ID_A, [], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command' })),
    blocks([paragraph('Branch: feature/demo-42-explicit-name'), ...TASK_BLOCKS]),
    patchOk(),
  ]);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(currentBranch(cwd), 'feature/demo-42-explicit-name');
});

test('--from-not-started promotes the task to "To do" before anything else', () => {
  const cwd = workspace();
  const r = applyPick(cwd, ID_A, ['--from-not-started'], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command', status: 'Not started' })),
    patchOk(),
    blocks(TASK_BLOCKS),
    patchOk(),
  ]);

  assert.equal(r.status, 0, r.stderr);
  const patches = r.requests.filter((q) => q.method === 'PATCH');
  assert.deepEqual(
    patches.map((q) => q.body.properties.Status.status.name),
    ['To do', 'In progress'],
    'the board must pass through To do so the picker\'s own filters stay coherent'
  );
});

test('a task in an unexpected status is refused rather than silently started', () => {
  const cwd = workspace();
  const r = applyPick(cwd, ID_A, [], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command', status: 'Done' })),
  ]);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /Task status is "Done", expected "To do" or "In progress"/);
  assert.equal(currentBranch(cwd), 'develop', 'a refused apply must not touch git');
  assert.equal(existsSync(join(cwd, '.dev-context')), false);
});

test('a task whose name carries no number cannot yield a branch and exits 1', () => {
  const cwd = workspace();
  const r = applyPick(cwd, ID_A, [], [
    getPage(page({ id: ID_A, name: 'Nameless work item' })),
    blocks(TASK_BLOCKS),
  ]);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /Cannot derive branch name from task: "Nameless work item"/);
});

test('a page that cannot be fetched exits 1 with the error body', () => {
  const cwd = workspace();
  const r = applyPick(cwd, ID_A, [], [
    getPage({ object: 'error', code: 'object_not_found', message: 'nope' }),
  ]);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /Failed to fetch page/);
  assert.match(r.stderr, /object_not_found/);
});

test('--no-switch creates the branch but leaves HEAD where it was', () => {
  const cwd = workspace();
  const r = applyPick(cwd, ID_A, ['--no-switch'], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command' })),
    blocks(TASK_BLOCKS),
    patchOk(),
  ]);

  assert.equal(r.status, 0, r.stderr);
  assert.equal(currentBranch(cwd), 'develop', 'a 2nd+ parallel task must not steal the working tree');
  assert.ok(existsSync(ctxDirFor(cwd, BRANCH_A)), 'its context is still cached');
});

test('re-applying the same task replaces its entry instead of duplicating it', () => {
  const cwd = workspace();
  const routes = () => [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command' })),
    blocks(TASK_BLOCKS),
    patchOk(),
  ];
  applyPick(cwd, ID_A, [], routes());
  const second = applyPick(cwd, ID_A, [], routes());

  assert.equal(second.status, 0, second.stderr);
  assert.equal(selectedTasks(cwd).length, 1);
});

test('a failed Status patch warns but does not undo a completed local setup', () => {
  const cwd = workspace();
  const r = applyPick(cwd, ID_A, [], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command' })),
    blocks(TASK_BLOCKS),
    { method: 'PATCH', path: '/v1/pages/', status: 409, body: { object: 'error', code: 'conflict_error', message: 'locked' } },
  ]);

  assert.equal(r.status, 0, 'the branch and context already exist — failing here would strand them');
  assert.match(r.stderr, /Warning: failed to set Status=In progress in Notion/);
  assert.equal(currentBranch(cwd), BRANCH_A);
  assert.deepEqual(selectedTasks(cwd).map((t) => t.pageId), [ID_A]);
});

// ─── Parallel-task conflict detection ─────────────────────────────────────────

test('overlapping files with another active task abort the apply', () => {
  const cwd = workspace();
  commitOnBranch(cwd, 'feature/demo-40-other', { 'src/shared.js': 'other\n' });
  commitOnBranch(cwd, BRANCH_A, { 'src/shared.js': 'mine\n' });
  mkdirSync(join(cwd, '.dev-context'), { recursive: true });
  writeFileSync(join(cwd, '.dev-context', 'selected-tasks.json'), JSON.stringify({
    version: 1,
    tasks: [{ pageId: ID_B, taskNumber: '40', name: 'other', branch: 'feature/demo-40-other', status: 'In progress' }],
  }), 'utf8');

  const r = applyPick(cwd, ID_A, [], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command' })),
    blocks(TASK_BLOCKS),
  ]);

  assert.equal(r.status, 1);
  assert.match(r.stderr, /CONFLICT: overlapping files between feature\/demo-42-add-ban-command and feature\/demo-40-other/);
  assert.match(r.stderr, /src\/shared\.js/);
  assert.match(r.stderr, /Retry with --force to bypass/);
  assert.equal(currentBranch(cwd), 'develop');
});

test('--force bypasses the conflict and reports the parallel-task disclaimer', () => {
  const cwd = workspace();
  commitOnBranch(cwd, 'feature/demo-40-other', { 'src/shared.js': 'other\n' });
  commitOnBranch(cwd, BRANCH_A, { 'src/shared.js': 'mine\n' });
  mkdirSync(join(cwd, '.dev-context'), { recursive: true });
  writeFileSync(join(cwd, '.dev-context', 'selected-tasks.json'), JSON.stringify({
    version: 1,
    tasks: [{ pageId: ID_B, taskNumber: '40', name: 'other', branch: 'feature/demo-40-other', status: 'In progress' }],
  }), 'utf8');

  const r = applyPick(cwd, ID_A, ['--force'], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command' })),
    blocks(TASK_BLOCKS),
    patchOk(),
  ]);

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DISCLAIMER: Parallel tasks active; run each in a separate Claude Code instance\./);
  assert.equal(currentBranch(cwd), BRANCH_A);
  assert.equal(selectedTasks(cwd).length, 2);
});

test('disjoint files across parallel branches are not a conflict', () => {
  const cwd = workspace();
  commitOnBranch(cwd, 'feature/demo-40-other', { 'src/other.js': 'other\n' });
  commitOnBranch(cwd, BRANCH_A, { 'src/mine.js': 'mine\n' });
  mkdirSync(join(cwd, '.dev-context'), { recursive: true });
  writeFileSync(join(cwd, '.dev-context', 'selected-tasks.json'), JSON.stringify({
    version: 1,
    tasks: [{ pageId: ID_B, taskNumber: '40', name: 'other', branch: 'feature/demo-40-other', status: 'In progress' }],
  }), 'utf8');

  const r = applyPick(cwd, ID_A, [], [
    getPage(page({ id: ID_A, name: 'feature/demo-42: Add ban command' })),
    blocks(TASK_BLOCKS),
    patchOk(),
  ]);

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DISCLAIMER: Parallel tasks active/);
});
