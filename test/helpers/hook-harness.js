import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = join(here, '..', '..');
export const HOOK_PATH = join(PKG_ROOT, 'hooks', 'notion-task-inject.js');
const STUB_PRELOAD = join(here, 'notion-stub.cjs');

// Every NOTION_*/PROJECT_*/GIT_* var the hook reads, cleared before each run so
// a developer's own .env-exported token cannot make a test pass (or fail) for
// reasons the test never states.
const SCRUBBED = [
  'NOTION_TOKEN', 'NOTION_SKILLS_TOKEN', 'NOTION_DATABASE_ID',
  'NOTION_BOARD_COLLECTION_ID', 'NOTION_PICKER_STAGE_FILTER',
  'PROJECT_PREFIX', 'GIT_DEVELOP_BRANCH', 'CLAUDE_PROJECT_DIR',
];

export function makeWorkspace({ config = null, env = null } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'hook-e2e-'));
  if (config !== null) writeFileSync(join(cwd, 'spovishun-skills.config.yaml'), config, 'utf8');
  if (env !== null) writeFileSync(join(cwd, '.env'), env, 'utf8');
  return cwd;
}

/**
 * Initialises a git repo whose default branch is `base`, with one commit so
 * `git rev-parse` and `git diff` have something to work with. `git init -b` is
 * avoided — it needs git ≥ 2.28; symbolic-ref works everywhere.
 */
export function initRepo(cwd, base = 'develop') {
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git('init');
  git('symbolic-ref', 'HEAD', `refs/heads/${base}`);
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(cwd, 'README.md'), '# base\n', 'utf8');
  git('add', '.');
  git('commit', '-m', 'base');
  return git;
}

/** Commits `files` ({ path: content }) on a new branch cut from `base`. */
export function commitOnBranch(cwd, branch, files, base = 'develop') {
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git('checkout', '-b', branch, base);
  for (const [rel, content] of Object.entries(files)) {
    const dest = join(cwd, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content, 'utf8');
  }
  git('add', '.');
  git('commit', '-m', `work on ${branch}`);
  git('checkout', base);
}

export function currentBranch(cwd) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, stdio: 'pipe' })
    .toString().trim();
}

/**
 * Runs hooks/notion-task-inject.js as a real subprocess with https scripted by
 * `routes` (see test/helpers/notion-stub.cjs).
 *
 * @returns {{ status, stdout, stderr, requests, output }} — `output` is the
 *   parsed hookSpecificOutput.additionalContext when stdout carries one, else null.
 */
export function runHook({ cwd, args = [], stdin = '', env = {}, routes = [] }) {
  // The stub's scratch files live OUTSIDE the workspace: `cwd` is usually a git
  // repo, and a routes file dropped in it would show up as an untracked change
  // in exactly the assertions that check the hook left the tree clean.
  const stubDir = mkdtempSync(join(tmpdir(), 'hook-stub-'));
  const stubFile = join(stubDir, 'routes.json');
  const logFile = join(stubDir, 'requests.jsonl');
  writeFileSync(stubFile, JSON.stringify(routes), 'utf8');

  const childEnv = { ...process.env };
  for (const key of SCRUBBED) delete childEnv[key];
  Object.assign(childEnv, env, { NOTION_STUB_FILE: stubFile, NOTION_STUB_LOG: logFile });

  const result = spawnSync(
    process.execPath,
    ['--require', STUB_PRELOAD, HOOK_PATH, ...args],
    { cwd, input: stdin, encoding: 'utf8', env: childEnv }
  );

  const requests = existsSync(logFile)
    ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

  let output = null;
  if (result.stdout.trim().startsWith('{')) {
    try {
      output = JSON.parse(result.stdout).hookSpecificOutput?.additionalContext ?? null;
    } catch { output = null; }
  }

  return { status: result.status, stdout: result.stdout, stderr: result.stderr, requests, output };
}

/**
 * Requires one hooks/ module in-process with a controlled env + cwd, for the
 * paths pure enough to call directly (git helpers, notionRequest, the render
 * helpers). Anything that can reach process.exit() belongs in runHook().
 *
 * hook-config.js resolves its constants at REQUIRE time and every other module
 * reads them from there, so the whole hooks/ subtree has to leave the require
 * cache between cases — purging one file would hand the next case a stale
 * PROJECT_PREFIX from the previous one's config.
 *
 * @returns {{ mod, cwd, stderr }} `stderr` collects everything written during
 *   the require, which is where the config warnings fire.
 */
export function loadHookModule(require, { module = 'notion-task-inject.js', env = {}, config = null, cwd = null } = {}) {
  const workspace = cwd ?? makeWorkspace({ config });
  const oldCwd = process.cwd();
  const oldEnv = {};
  for (const key of new Set([...SCRUBBED, ...Object.keys(env)])) {
    oldEnv[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  process.chdir(workspace);
  purgeHookModules(require);

  const stderr = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  try {
    return { mod: require(join(PKG_ROOT, 'hooks', module)), cwd: workspace, stderr };
  } finally {
    process.stderr.write = realWrite;
    process.chdir(oldCwd);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Drops every hooks/*.js module from the CJS require cache. */
export function purgeHookModules(require) {
  const hooksDir = join(PKG_ROOT, 'hooks');
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(hooksDir)) delete require.cache[id];
  }
}

/** A Notion page object shaped like the fields the hook actually reads. */
export function page({ id, name, status = 'To do', priority = 'High' }) {
  return {
    object: 'page',
    id,
    properties: {
      Name: { title: [{ plain_text: name }] },
      Status: { status: { name: status } },
      Priority: { select: { name: priority } },
    },
  };
}

export function paragraph(text) {
  return { type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] } };
}
