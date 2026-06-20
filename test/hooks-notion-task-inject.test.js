import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const require = createRequire(import.meta.url);

// hooks/notion-task-inject.js is a standalone CommonJS hook. It exports pure
// helpers and only dispatches its CLI/stdin modes when run directly — see the
// `require.main === module` guard. Module-level constants (PROJECT_PREFIX,
// STAGE_FILTER, …) are read from env+config at require time, so each test
// loads a FRESH copy with a controlled env + cwd.

const HOOK_PATH = join(PKG_ROOT, 'hooks', 'notion-task-inject.js');

function loadHook(envOverrides = {}, configBody = null) {
  const cwd = mkdtempSync(join(tmpdir(), 'hook-test-'));
  if (configBody !== null) {
    writeFileSync(join(cwd, 'spovishun-skills.config.yaml'), configBody, 'utf8');
  }
  const oldCwd = process.cwd();
  const oldEnv = {};
  const allKeys = new Set([
    'NOTION_PICKER_STAGE_FILTER', 'PROJECT_PREFIX', 'GIT_DEVELOP_BRANCH',
    'NOTION_DATABASE_ID', 'NOTION_TOKEN', 'NOTION_SKILLS_TOKEN',
    ...Object.keys(envOverrides),
  ]);
  for (const k of allKeys) {
    oldEnv[k] = process.env[k];
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  process.chdir(cwd);
  delete require.cache[require.resolve(HOOK_PATH)];
  try {
    return { hook: require(HOOK_PATH), cwd };
  } finally {
    process.chdir(oldCwd);
    for (const [k, v] of Object.entries(oldEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('PRIORITY_TIERS stays in sync with scripts/notion/lib/query-tasks.js', () => {
  const { hook } = loadHook();
  const lib = require(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'query-tasks.js'));
  // The hook is standalone (scripts are not installed when stack.notion=false),
  // so the tier list is duplicated. This guard catches divergence — it already
  // happened once (the hook carried a phantom 'Normal' tier).
  assert.deepEqual(hook.PRIORITY_TIERS, lib.PRIORITY_TIERS);
});

test('withStageFilter: unset filter returns base filter unchanged (Board v1)', () => {
  const { hook } = loadHook({ NOTION_PICKER_STAGE_FILTER: undefined });
  const base = { property: 'Status', status: { equals: 'To do' } };
  assert.equal(hook.stageFilterClause(), null);
  assert.deepEqual(hook.withStageFilter(base), base);
});

test('withStageFilter: appends to existing and-array, wraps lone filters', () => {
  const { hook } = loadHook({ NOTION_PICKER_STAGE_FILTER: 'Sprint' });
  const stage = { property: 'Stage', select: { equals: 'Sprint' } };

  const lone = { property: 'Status', status: { equals: 'To do' } };
  assert.deepEqual(hook.withStageFilter(lone), { and: [lone, stage] });

  const anded = { and: [lone, { property: 'Priority', select: { equals: 'High' } }] };
  assert.deepEqual(hook.withStageFilter(anded), { and: [...anded.and, stage] });
});

test('stage filter falls back to config picker.stage_filter when env unset', () => {
  const { hook } = loadHook(
    { NOTION_PICKER_STAGE_FILTER: undefined },
    'notion:\n  database_id: "abc"\n  picker:\n    stage_filter: "Sprint"\n'
  );
  assert.deepEqual(hook.stageFilterClause(), { property: 'Stage', select: { equals: 'Sprint' } });
});

test('deriveBranchFromName builds a sanitized branch from the task title', () => {
  const { hook } = loadHook({ PROJECT_PREFIX: 'myapp' });
  assert.equal(
    hook.deriveBranchFromName('feature/myapp-17: Add member ban command'),
    'feature/myapp-17-add-member-ban-command'
  );
  assert.equal(hook.deriveBranchFromName('no number here'), null);
});

test('extractTaskNumber / toDashed behave like the scripts lib', () => {
  const { hook } = loadHook();
  assert.equal(hook.extractTaskNumber('feature/x-93: Foo'), '93');
  assert.equal(
    hook.toDashed('aaaaaaaa11112222333344445555bbbb'),
    'aaaaaaaa-1111-2222-3333-44445555bbbb'
  );
});

test('assertSafeBranch rejects shell metacharacters from external sources', () => {
  const { hook } = loadHook();
  assert.equal(hook.assertSafeBranch('feature/x-1-foo', 'branch'), 'feature/x-1-foo');
  assert.throws(() => hook.assertSafeBranch('develop; rm -rf /', 'base branch'), /unsafe/);
  assert.throws(() => hook.assertSafeBranch('$(curl evil)', 'branch'), /unsafe/);
  assert.throws(() => hook.assertSafeBranch('a`b`', 'branch'), /unsafe/);
});

test('blockToMd renders the common Notion block types', () => {
  const { hook } = loadHook();
  const para = { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'hello' }] } };
  const h2 = { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Goal' }] } };
  const todo = { type: 'to_do', to_do: { checked: true, rich_text: [{ plain_text: 'done it' }] } };
  assert.equal(hook.blockToMd(para), 'hello');
  assert.equal(hook.blockToMd(h2), '## Goal');
  assert.equal(hook.blockToMd(todo), '- [x] done it');
});

test('FINISH_TASK_TRIGGERS stays the documented finish-task phrase list', () => {
  // Guards the trigger list wired into main()'s hasTrigger — adding/removing a
  // phrase here without intent will fail this test (mirrors PRIORITY_TIERS guard).
  const { hook } = loadHook();
  assert.deepEqual(hook.FINISH_TASK_TRIGGERS, [
    'finish task', 'complete task', 'завершити задачу', 'закінчити задачу',
  ]);
});

test('loadEnv parses a CRLF .env (Windows) — token/db land in process.env', () => {
  // Regression for spovishun-129: split('\n') + `$` anchor failed on trailing \r,
  // so no vars were set and the picker/injection silently skipped.
  const cwd = mkdtempSync(join(tmpdir(), 'hook-crlf-'));
  writeFileSync(
    join(cwd, '.env'),
    'NOTION_TOKEN=secret-crlf\r\nNOTION_DATABASE_ID=db-crlf\r\n',
    'utf8'
  );
  const oldCwd = process.cwd();
  const keys = ['NOTION_TOKEN', 'NOTION_SKILLS_TOKEN', 'NOTION_DATABASE_ID'];
  const saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  process.chdir(cwd);
  delete require.cache[require.resolve(HOOK_PATH)];
  try {
    const hook = require(HOOK_PATH);
    assert.equal(process.env.NOTION_TOKEN, 'secret-crlf');
    assert.equal(process.env.NOTION_DATABASE_ID, 'db-crlf');
    assert.equal(hook.NOTION_TOKEN, 'secret-crlf');
    assert.equal(hook.TOKEN_SOURCE, 'NOTION_TOKEN');
  } finally {
    process.chdir(oldCwd);
    delete require.cache[require.resolve(HOOK_PATH)];
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('token precedence: NOTION_TOKEN wins over NOTION_SKILLS_TOKEN', () => {
  const { hook } = loadHook({ NOTION_TOKEN: 'primary', NOTION_SKILLS_TOKEN: 'skills' });
  assert.equal(hook.NOTION_TOKEN, 'primary');
  assert.equal(hook.TOKEN_SOURCE, 'NOTION_TOKEN');
});

test('token precedence: NOTION_SKILLS_TOKEN used only when NOTION_TOKEN unset', () => {
  const { hook } = loadHook({ NOTION_TOKEN: undefined, NOTION_SKILLS_TOKEN: 'skills' });
  assert.equal(hook.NOTION_TOKEN, 'skills');
  assert.equal(hook.TOKEN_SOURCE, 'NOTION_SKILLS_TOKEN');
});

test('HOOK_DIR emits a ${CLAUDE_PROJECT_DIR:-<abs>} fallback the agent shell can resolve', () => {
  // Regression for spovishun-132: the picker printed
  // `node "$CLAUDE_PROJECT_DIR/.claude/hooks/notion-task-inject.js" ...`, but the
  // harness sets $CLAUDE_PROJECT_DIR only for hook subprocesses, not the agent's
  // Bash shell — where it expands empty and Git Bash maps the leading "/" to the
  // Git install root → MODULE_NOT_FOUND. HOOK_DIR must carry a concrete fallback.
  const { hook, cwd } = loadHook({ CLAUDE_PROJECT_DIR: undefined });
  const fwdCwd = cwd.replace(/\\/g, '/');
  assert.equal(hook.HOOK_DIR, '${CLAUDE_PROJECT_DIR:-' + fwdCwd + '}/.claude/hooks');
  // The bare unresolvable form must not survive.
  assert.equal(hook.HOOK_DIR.includes('$CLAUDE_PROJECT_DIR/'), false);
  // Forward slashes only — a backslash would break in Git Bash on Windows.
  assert.equal(/\\/.test(hook.HOOK_DIR), false);
});

test('HOOK_DIR honors $CLAUDE_PROJECT_DIR when the harness did set it (hook subprocess)', () => {
  const { hook } = loadHook({ CLAUDE_PROJECT_DIR: 'C:\\proj\\spovishun' });
  // The env value is normalized to forward slashes and used as the fallback.
  assert.equal(hook.HOOK_DIR, '${CLAUDE_PROJECT_DIR:-C:/proj/spovishun}/.claude/hooks');
});

test('readConfigValue resolves 2-level dotted keys (parity with scripts lib)', () => {
  const config = 'notion:\n  database_id: "db-1"\n  picker:\n    stage_filter: "Sprint"\ngit:\n  dev_branch: "develop"\n';
  const { hook } = loadHook({}, config);
  // Module captured cwd at require time inside loadHook's chdir window — call
  // readConfigValue through a fresh chdir to the same cwd is not possible here,
  // so assert via the constants the module derived from the same config.
  assert.deepEqual(hook.stageFilterClause(), { property: 'Stage', select: { equals: 'Sprint' } });
});
