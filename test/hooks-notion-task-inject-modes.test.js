import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  makeWorkspace, initRepo, runHook, currentBranch,
} from './helpers/hook-harness.js';

// End-to-end coverage of the three hook MODES — UserPromptSubmit dispatch,
// --post-exit-plan and --apply-pick argv validation. Every case drives the real
// CLI in a subprocess, so it asserts exit codes and the stdout directive that
// Claude actually consumes, and stays true no matter how the hook is split up
// internally. Notion is scripted by test/helpers/notion-stub.cjs; git is real.

const NOTION_CONFIG = [
  'project:',
  '  name: "Demo"',
  '  language: "uk"',
  'stack:',
  '  notion: true',
  'git:',
  '  dev_branch: "develop"',
  'notion:',
  '  token_env: "NOTION_TOKEN"',
  '  database_id: "db-1"',
  '',
].join('\n');

const NO_NOTION_CONFIG = [
  'project:',
  '  name: "Demo"',
  'stack:',
  '  notion: false',
  'git:',
  '  dev_branch: "develop"',
  '',
].join('\n');

function prompt(text) {
  return JSON.stringify({ prompt: text });
}

function ctxDirFor(cwd, branch) {
  return join(cwd, '.dev-context', branch.replace(/\//g, '-') + '_prd');
}

// ─── main(): trigger dispatch ──────────────────────────────────────────────────

test('a prompt with no trigger word produces no output at all', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const r = runHook({ cwd, stdin: prompt('what does this file do?'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.deepEqual(r.requests, [], 'a non-trigger prompt must not reach Notion');
});

test('malformed stdin exits 0 without output — a hook must never brick a session', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const r = runHook({ cwd, stdin: 'not json at all', env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('a trigger word with no database id skips loudly and exits 0', () => {
  const cwd = makeWorkspace({ config: NO_NOTION_CONFIG });
  const r = runHook({ cwd, stdin: prompt('implement the parser'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /NOTION_DATABASE_ID not set, skipping/);
});

test('"start new task" without a token skips the picker instead of failing', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  initRepo(cwd);
  const r = runHook({ cwd, stdin: prompt('start new task') });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /NOTION_TOKEN not set, skipping picker/);
  assert.deepEqual(r.requests, []);
});

// ─── main(): finish-task ───────────────────────────────────────────────────────

test('"finish task" on the base branch skips — there is no active task there', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  initRepo(cwd);
  const r = runHook({ cwd, stdin: prompt('finish task'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /finish task: not on an active task branch, skipping/);
});

test('"finish task" on a task branch with no .dev-context skips', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const git = initRepo(cwd);
  git('checkout', '-b', 'feature/demo-7-thing');
  const r = runHook({ cwd, stdin: prompt('finish task'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /finish task: no \.dev-context for this branch, skipping/);
});

test('"finish task" on a cached task branch emits the finish-task gate directive', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const git = initRepo(cwd);
  git('checkout', '-b', 'feature/demo-7-thing');
  const ctx = ctxDirFor(cwd, 'feature/demo-7-thing');
  mkdirSync(ctx, { recursive: true });
  writeFileSync(join(ctx, 'context.md'), '## Active Task (Notion)\n', 'utf8');

  const r = runHook({ cwd, stdin: prompt('завершити задачу'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.match(r.output, /## Finish Task/);
  assert.match(r.output, /feature\/demo-7-thing/);
  assert.match(r.output, /invoke the `finish-task` skill/);
  // The gate is advisory-then-blocking: nothing may be pushed automatically.
  assert.match(r.output, /Do NOT push, open a PR, or set Notion Status=Done automatically/);
  assert.deepEqual(r.requests, [], 'finish-task is local and must not call Notion');
});

// ─── main(): cache-first injection ─────────────────────────────────────────────

test('a trigger word on a cached task branch injects the cache without touching Notion', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const git = initRepo(cwd);
  git('checkout', '-b', 'feature/demo-7-thing');
  const ctx = ctxDirFor(cwd, 'feature/demo-7-thing');
  mkdirSync(ctx, { recursive: true });
  writeFileSync(join(ctx, 'context.md'), '## Active Task (Notion)\n**demo-7**\n', 'utf8');
  writeFileSync(join(ctx, 'plan.md'), 'step one', 'utf8');

  const r = runHook({ cwd, stdin: prompt('refactor the loader'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.match(r.output, /\*\*demo-7\*\*/);
  assert.match(r.output, /## Approved Plan\nstep one/);
  assert.deepEqual(r.requests, [], 'the cache must win over a network round-trip');
  assert.ok(existsSync(join(ctx, 'session.lock')), 'the session lock is written on injection');
});

test('the session lock suppresses a second injection in the same session', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const git = initRepo(cwd);
  git('checkout', '-b', 'feature/demo-7-thing');
  const ctx = ctxDirFor(cwd, 'feature/demo-7-thing');
  mkdirSync(ctx, { recursive: true });
  writeFileSync(join(ctx, 'context.md'), '## Active Task (Notion)\n', 'utf8');
  // The lock records the PARENT pid — here, this test process, which is alive.
  writeFileSync(join(ctx, 'session.lock'), `${process.pid}:${Date.now()}`, 'utf8');

  const r = runHook({ cwd, stdin: prompt('таск'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'an injection already happened this session');
});

test('a stale session lock (dead pid) does not suppress injection', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const git = initRepo(cwd);
  git('checkout', '-b', 'feature/demo-7-thing');
  const ctx = ctxDirFor(cwd, 'feature/demo-7-thing');
  mkdirSync(ctx, { recursive: true });
  writeFileSync(join(ctx, 'context.md'), '## Active Task (Notion)\n**demo-7**\n', 'utf8');
  writeFileSync(join(ctx, 'session.lock'), `999999999:${Date.now()}`, 'utf8');

  const r = runHook({ cwd, stdin: prompt('таск'), env: { NOTION_TOKEN: 'tok' } });
  assert.match(r.output, /\*\*demo-7\*\*/);
});

// ─── main(): Notion fetch when there is no cache ───────────────────────────────

test('with no cache the hook fetches the active task and writes .dev-context', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  initRepo(cwd);
  const r = runHook({
    cwd,
    stdin: prompt('реалізуй'),
    env: { NOTION_TOKEN: 'tok' },
    routes: [
      {
        method: 'POST', path: '/v1/databases/db-1/query',
        body: {
          results: [{
            id: 'aaaaaaaa11112222333344445555bbbb',
            properties: {
              Name: { title: [{ plain_text: 'feature/demo-42: Add ban command' }] },
              Status: { status: { name: 'To do' } },
              Priority: { select: { name: 'High' } },
            },
          }],
        },
      },
      {
        method: 'GET', path: '/children',
        body: {
          results: [
            { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Goal' }] } },
            { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Ban members.' }] } },
            { type: 'toggle', toggle: { rich_text: [{ plain_text: 'hidden detail' }] } },
          ],
        },
      },
    ],
  });

  assert.equal(r.status, 0);
  assert.match(r.output, /## Goal/);
  assert.match(r.output, /Ban members\./);
  assert.doesNotMatch(r.output, /hidden detail/, 'toggle blocks are excluded from the injected context');

  const ctx = ctxDirFor(cwd, 'feature/demo-42-add-ban-command');
  assert.equal(readFileSync(join(ctx, 'branch.txt'), 'utf8'), 'feature/demo-42-add-ban-command');
  const taskJson = JSON.parse(readFileSync(join(ctx, 'task.json'), 'utf8'));
  assert.equal(taskJson.title, 'feature/demo-42: Add ban command');
  assert.equal(taskJson.priority, 'High');
  assert.match(taskJson.content, /hidden detail/, 'task.json keeps the full block list');
});

test('an empty board produces no output rather than an empty task banner', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  initRepo(cwd);
  const r = runHook({
    cwd, stdin: prompt('задача'), env: { NOTION_TOKEN: 'tok' },
    routes: [{ method: 'POST', path: '/query', body: { results: [] } }],
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('a Notion auth failure is reported on stderr and still exits 0', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  initRepo(cwd);
  const r = runHook({
    cwd, stdin: prompt('задача'), env: { NOTION_SKILLS_TOKEN: 'stale' },
    routes: [{ method: 'POST', path: '/query', status: 401, body: { object: 'error', code: 'unauthorized' } }],
  });
  assert.equal(r.status, 0, 'a broken token must not brick the session');
  assert.match(r.stderr, /auth failed/);
  assert.match(r.stderr, /NOTION_SKILLS_TOKEN/, 'the error names the env var that supplied the token');
});

// ─── --post-exit-plan ──────────────────────────────────────────────────────────

test('--post-exit-plan saves the approved plan and clears the session lock', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const git = initRepo(cwd);
  git('checkout', '-b', 'feature/demo-7-thing');
  const ctx = ctxDirFor(cwd, 'feature/demo-7-thing');
  mkdirSync(ctx, { recursive: true });
  writeFileSync(join(ctx, 'session.lock'), `${process.pid}:${Date.now()}`, 'utf8');

  const r = runHook({
    cwd, args: ['--post-exit-plan'],
    stdin: JSON.stringify({ tool_input: { plan: '# Plan\n- do the thing' } }),
  });

  assert.equal(r.status, 0);
  assert.equal(readFileSync(join(ctx, 'plan.md'), 'utf8'), '# Plan\n- do the thing');
  assert.equal(
    existsSync(join(ctx, 'session.lock')), false,
    'the lock is cleared so the next prompt re-injects the context with the plan'
  );
  assert.match(r.stderr, /plan saved/);
});

test('--post-exit-plan on the base branch writes nothing', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  initRepo(cwd);
  const r = runHook({
    cwd, args: ['--post-exit-plan'],
    stdin: JSON.stringify({ tool_input: { plan: 'x' } }),
  });
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(cwd, '.dev-context')), false);
});

test('--post-exit-plan tolerates a payload with no plan', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const git = initRepo(cwd);
  git('checkout', '-b', 'feature/demo-7-thing');
  const r = runHook({ cwd, args: ['--post-exit-plan'], stdin: JSON.stringify({ tool_input: {} }) });
  assert.equal(r.status, 0);
  assert.equal(existsSync(join(cwd, '.dev-context')), false);
});

// ─── --apply-pick argv guards ──────────────────────────────────────────────────

test('--apply-pick without a pageId exits 1 with usage', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const r = runHook({ cwd, args: ['--apply-pick'], env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 1, 'apply-pick failures must be visible to Claude');
  assert.match(r.stderr, /Usage: --apply-pick <pageId>/);
});

test('--apply-pick without a token exits 1', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const r = runHook({ cwd, args: ['--apply-pick', 'aaaaaaaa11112222333344445555bbbb'] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /NOTION_TOKEN not set/);
});

// A hook that cannot resolve its own config must still run — the warning is the
// deliverable, not an abort. Guards the readConfigValueOrWarn contract end to end.
test('a broken config warns on stderr but the hook still completes', () => {
  const cwd = makeWorkspace({ config: 'project:\n  language: "uk"\nstack:\n  notion: true\n' });
  initRepo(cwd);
  const r = runHook({ cwd, stdin: prompt('finish task'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /project\.name is unreadable/);
  assert.match(r.stderr, /notion\.database_id is unreadable/);
});

test('git state is untouched by the read-only modes', () => {
  const cwd = makeWorkspace({ config: NOTION_CONFIG });
  const git = initRepo(cwd);
  git('checkout', '-b', 'feature/demo-7-thing');
  runHook({ cwd, stdin: prompt('finish task'), env: { NOTION_TOKEN: 'tok' } });
  assert.equal(currentBranch(cwd), 'feature/demo-7-thing');
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], { cwd, stdio: 'pipe' }).toString().trim(),
    '',
    'no mode may leave the working tree dirty'
  );
});
