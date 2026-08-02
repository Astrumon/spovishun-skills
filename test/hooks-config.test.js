import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { loadHookModule } from './helpers/hook-harness.js';

const require = createRequire(import.meta.url);

// hooks/hook-config.js resolves the hook's whole environment — .env, token,
// and the four config-derived scalars — at REQUIRE time. Each case therefore
// loads a fresh copy under a controlled env + cwd; loadHookModule() clears the
// entire hooks/ subtree from the require cache to make that honest.

const load = (env, config) => loadHookModule(require, { module: 'hook-config.js', env, config });

// ─── Token resolution ─────────────────────────────────────────────────────────

test('token precedence: NOTION_TOKEN wins over NOTION_SKILLS_TOKEN', () => {
  const { mod } = load({ NOTION_TOKEN: 'primary', NOTION_SKILLS_TOKEN: 'skills' });
  assert.equal(mod.NOTION_TOKEN, 'primary');
  assert.equal(mod.TOKEN_SOURCE, 'NOTION_TOKEN');
});

test('token precedence: NOTION_SKILLS_TOKEN used only when NOTION_TOKEN unset', () => {
  const { mod } = load({ NOTION_TOKEN: undefined, NOTION_SKILLS_TOKEN: 'skills' });
  assert.equal(mod.NOTION_TOKEN, 'skills');
  assert.equal(mod.TOKEN_SOURCE, 'NOTION_SKILLS_TOKEN');
});

test('no token at all resolves to null with no source to blame', () => {
  const { mod } = load({});
  assert.equal(mod.NOTION_TOKEN, null);
  assert.equal(mod.TOKEN_SOURCE, null);
});

test('loadEnv parses a CRLF .env (Windows) — token/db land in process.env', () => {
  // Regression for spovishun-129: split('\n') + `$` anchor failed on trailing \r,
  // so no vars were set and the picker/injection silently skipped.
  const cwd = mkdtempSync(join(tmpdir(), 'hook-crlf-'));
  writeFileSync(join(cwd, '.env'), 'NOTION_TOKEN=secret-crlf\r\nNOTION_DATABASE_ID=db-crlf\r\n', 'utf8');

  const { mod } = loadHookModule(require, { module: 'hook-config.js', cwd });
  assert.equal(mod.NOTION_TOKEN, 'secret-crlf');
  assert.equal(mod.TOKEN_SOURCE, 'NOTION_TOKEN');
  assert.equal(mod.DATABASE_ID, 'db-crlf');
});

test('an existing env var beats the .env file', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hook-env-'));
  writeFileSync(join(cwd, '.env'), 'NOTION_TOKEN=from-file\n', 'utf8');

  const { mod } = loadHookModule(require, { module: 'hook-config.js', cwd, env: { NOTION_TOKEN: 'from-shell' } });
  assert.equal(mod.NOTION_TOKEN, 'from-shell');
});

// ─── Stage filter ─────────────────────────────────────────────────────────────

test('withStageFilter: unset filter returns base filter unchanged (Board v1)', () => {
  const { mod } = load({ NOTION_PICKER_STAGE_FILTER: undefined });
  const base = { property: 'Status', status: { equals: 'To do' } };
  assert.equal(mod.stageFilterClause(), null);
  assert.deepEqual(mod.withStageFilter(base), base);
});

test('withStageFilter: appends to existing and-array, wraps lone filters', () => {
  const { mod } = load({ NOTION_PICKER_STAGE_FILTER: 'Sprint' });
  const stage = { property: 'Stage', select: { equals: 'Sprint' } };

  const lone = { property: 'Status', status: { equals: 'To do' } };
  assert.deepEqual(mod.withStageFilter(lone), { and: [lone, stage] });

  const anded = { and: [lone, { property: 'Priority', select: { equals: 'High' } }] };
  assert.deepEqual(mod.withStageFilter(anded), { and: [...anded.and, stage] });
});

test('stage filter falls back to config picker.stage_filter when env unset', () => {
  const { mod } = load(
    { NOTION_PICKER_STAGE_FILTER: undefined },
    'notion:\n  database_id: "abc"\n  picker:\n    stage_filter: "Sprint"\n'
  );
  assert.deepEqual(mod.stageFilterClause(), { property: 'Stage', select: { equals: 'Sprint' } });
});

// ─── Config-derived scalars ───────────────────────────────────────────────────

// A UTF-8 BOM (which Windows editors add unprompted) used to make the hook's
// own scanner miss every top-level key, so PROJECT_PREFIX silently became the
// literal "project" and the picker queried the board for tasks that cannot
// exist. The shared reader strips it.
test('PROJECT_PREFIX survives a UTF-8 BOM in the config', () => {
  const config = 'project:\n  name: "Spovishun"\nstack:\n  notion: false\ngit:\n  dev_branch: "develop"\n';
  const { mod, stderr } = load({ PROJECT_PREFIX: undefined }, '\uFEFF' + config);
  assert.equal(mod.PROJECT_PREFIX, 'spovishun');
  assert.deepEqual(stderr, [], 'a readable config must not warn');
});

test('a config that exists but cannot answer project.name warns loudly', () => {
  const { mod, stderr } = load({ PROJECT_PREFIX: undefined }, 'project:\n  language: "uk"\n');
  // Still falls back so the session keeps working …
  assert.equal(mod.PROJECT_PREFIX, 'project');
  // … but never silently.
  const warning = stderr.find((line) => line.includes('project.name'));
  assert.ok(warning, `expected a project.name warning, got ${JSON.stringify(stderr)}`);
  assert.match(warning, /\[notion-task-inject\]/);
  assert.match(warning, /spovishun-skills\.config\.yaml/);
});

test('no config file at all resolves defaults silently', () => {
  const { mod, stderr } = load({ PROJECT_PREFIX: undefined });
  assert.equal(mod.PROJECT_PREFIX, 'project');
  assert.equal(mod.DEVELOP_BRANCH, 'develop');
  assert.deepEqual(stderr, [], 'env-only setups are supported, not broken');
});

test('missing notion.database_id warns only when stack.notion is on', () => {
  const off = load(
    { NOTION_DATABASE_ID: undefined },
    'project:\n  name: "X"\nstack:\n  notion: false\ngit:\n  dev_branch: "develop"\n'
  );
  assert.deepEqual(off.stderr, [], 'stack.notion=false legitimately has no notion section');

  const on = load(
    { NOTION_DATABASE_ID: undefined },
    'project:\n  name: "X"\nstack:\n  notion: true\ngit:\n  dev_branch: "develop"\n'
  );
  assert.ok(
    on.stderr.some((line) => line.includes('notion.database_id')),
    `expected a database_id warning, got ${JSON.stringify(on.stderr)}`
  );
});

test('the deprecated NOTION_BOARD_COLLECTION_ID alias still resolves', () => {
  // A misnamed pre-1.2.2 env var that actually held the database id. Consumer
  // .env files still carry it.
  const { mod } = load({ NOTION_DATABASE_ID: undefined, NOTION_BOARD_COLLECTION_ID: 'legacy-db' });
  assert.equal(mod.DATABASE_ID, 'legacy-db');
});

test('dev_branch comes from the config and is overridable by env', () => {
  const config = 'project:\n  name: "X"\ngit:\n  dev_branch: "trunk"\n';
  assert.equal(load({}, config).mod.DEVELOP_BRANCH, 'trunk');
  assert.equal(load({ GIT_DEVELOP_BRANCH: 'main-line' }, config).mod.DEVELOP_BRANCH, 'main-line');
});

test('isBaseBranch knows the branches that never carry a task', () => {
  const { mod } = load({ GIT_DEVELOP_BRANCH: 'develop' });
  assert.equal(mod.isBaseBranch('develop'), true);
  assert.equal(mod.isBaseBranch('main'), true);
  assert.equal(mod.isBaseBranch(null), true, 'outside a repo there is no task branch either');
  assert.equal(mod.isBaseBranch('feature/x-1-y'), false);
});

// ─── HOOK_DIR ─────────────────────────────────────────────────────────────────

test('HOOK_DIR emits a ${CLAUDE_PROJECT_DIR:-<abs>} fallback the agent shell can resolve', () => {
  // Regression for spovishun-132: the picker printed
  // `node "$CLAUDE_PROJECT_DIR/.claude/hooks/notion-task-inject.js" ...`, but the
  // harness sets $CLAUDE_PROJECT_DIR only for hook subprocesses, not the agent's
  // Bash shell — where it expands empty and Git Bash maps the leading "/" to the
  // Git install root → MODULE_NOT_FOUND. HOOK_DIR must carry a concrete fallback.
  const { mod, cwd } = load({ CLAUDE_PROJECT_DIR: undefined });
  assert.equal(mod.HOOK_DIR, '${CLAUDE_PROJECT_DIR:-' + cwd.replace(/\\/g, '/') + '}/.claude/hooks');
  // The bare unresolvable form must not survive.
  assert.equal(mod.HOOK_DIR.includes('$CLAUDE_PROJECT_DIR/'), false);
  // Forward slashes only — a backslash would break in Git Bash on Windows.
  assert.equal(/\\/.test(mod.HOOK_DIR), false);
});

test('HOOK_DIR honors $CLAUDE_PROJECT_DIR when the harness did set it (hook subprocess)', () => {
  const { mod } = load({ CLAUDE_PROJECT_DIR: 'C:\\proj\\spovishun' });
  assert.equal(mod.HOOK_DIR, '${CLAUDE_PROJECT_DIR:-C:/proj/spovishun}/.claude/hooks');
});
