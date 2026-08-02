import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {
  makeWorkspace, initRepo, commitOnBranch, currentBranch, loadHookModule,
} from './helpers/hook-harness.js';

const require = createRequire(import.meta.url);

// The git helpers interpolate branch names — sourced from a config scalar and
// from Notion page text, both external — into execSync command lines, and they
// decide whether two parallel tasks may share a working tree. Both are load-
// bearing enough to test against a REAL repo rather than a mocked child_process.

// git-ops.js is a leaf: the base branch is an argument, never ambient config,
// so these tests need no env and no config file — only a real repo and a chdir.
const { mod: git } = loadHookModule(require, { module: 'git-ops.js' });
const BASE = 'develop';

function inRepo(fn, { base = 'develop' } = {}) {
  const cwd = makeWorkspace();
  initRepo(cwd, base);
  const oldCwd = process.cwd();
  process.chdir(cwd);
  try {
    return fn(cwd);
  } finally {
    process.chdir(oldCwd);
  }
}

// ─── assertSafeBranch ─────────────────────────────────────────────────────────

test('assertSafeBranch accepts ordinary refs and rejects shell metacharacters', () => {
  assert.equal(git.assertSafeBranch('feature/demo-1-foo', 'branch'), 'feature/demo-1-foo');
  assert.equal(git.assertSafeBranch('release/v1.2.3', 'branch'), 'release/v1.2.3');
  for (const evil of ['develop; rm -rf /', '$(curl evil)', 'a`b`', 'a b', 'x&&y', 'x|y']) {
    assert.throws(() => git.assertSafeBranch(evil, 'branch'), /unsafe branch name/, evil);
  }
});

test('an unsafe branch name is refused BEFORE it can reach a shell', () => {
  inRepo(() => {
    const result = git.gitSetupBranch('feature/$(touch pwned)', BASE);
    assert.equal(result.ok, false);
    assert.match(result.message, /unsafe branch name/);
    assert.equal(currentBranch(process.cwd()), 'develop', 'nothing ran');
  });
});

// ─── getCurrentBranch ─────────────────────────────────────────────────────────

test('getCurrentBranch reports the checked-out branch, null outside a repo', () => {
  inRepo((cwd) => {
    assert.equal(git.getCurrentBranch(), 'develop');
    execFileSync('git', ['checkout', '-b', 'feature/demo-1-x'], { cwd, stdio: 'pipe' });
    assert.equal(git.getCurrentBranch(), 'feature/demo-1-x');
  });

  const bare = makeWorkspace();
  const oldCwd = process.cwd();
  process.chdir(bare);
  try {
    assert.equal(git.getCurrentBranch(), null, 'a non-repo must not throw');
  } finally {
    process.chdir(oldCwd);
  }
});

// ─── gitSetupBranch ───────────────────────────────────────────────────────────

test('gitSetupBranch creates a new branch off the base and checks it out', () => {
  inRepo((cwd) => {
    const result = git.gitSetupBranch('feature/demo-42-thing', BASE);
    assert.equal(result.ok, true, result.message);
    assert.equal(currentBranch(cwd), 'feature/demo-42-thing');
  });
});

test('gitSetupBranch switches to an existing branch instead of recreating it', () => {
  inRepo((cwd) => {
    commitOnBranch(cwd, 'feature/demo-42-thing', { 'src/a.js': 'a\n' });
    const before = execFileSync('git', ['rev-parse', 'feature/demo-42-thing'], { cwd, stdio: 'pipe' }).toString().trim();

    const result = git.gitSetupBranch('feature/demo-42-thing', BASE);
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /Switched to existing branch/);
    assert.equal(currentBranch(cwd), 'feature/demo-42-thing');
    const after = execFileSync('git', ['rev-parse', 'feature/demo-42-thing'], { cwd, stdio: 'pipe' }).toString().trim();
    assert.equal(after, before, 'existing work must not be rewound to the base');
  });
});

test('with no reachable origin the branch is cut from the local base, with a warning', () => {
  inRepo(() => {
    // No remote is configured, so `git fetch origin develop` fails — the offline
    // path. It must still produce a usable branch rather than abort the apply.
    const result = git.gitSetupBranch('feature/demo-42-thing', BASE);
    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /offline: local base, may be stale/);
  });
});

test('an unknown base branch fails cleanly instead of leaving a half-made branch', () => {
  inRepo((cwd) => {
    execFileSync('git', ['branch', '-m', 'develop', 'trunk'], { cwd, stdio: 'pipe' });
    const result = git.gitSetupBranch('feature/demo-42-thing', BASE);
    assert.equal(result.ok, false);
    assert.equal(currentBranch(cwd), 'trunk');
  });
});

// ─── gitCreateBranchOnly ──────────────────────────────────────────────────────

test('gitCreateBranchOnly creates the ref but never moves HEAD', () => {
  inRepo((cwd) => {
    const result = git.gitCreateBranchOnly('feature/demo-43-parallel', BASE);
    assert.equal(result.ok, true, result.message);
    assert.equal(currentBranch(cwd), 'develop', 'a 2nd+ parallel task must not steal the working tree');
    execFileSync('git', ['rev-parse', '--verify', 'feature/demo-43-parallel'], { cwd, stdio: 'pipe' });
  });
});

test('gitCreateBranchOnly is idempotent for an existing branch', () => {
  inRepo((cwd) => {
    commitOnBranch(cwd, 'feature/demo-43-parallel', { 'src/a.js': 'a\n' });
    const result = git.gitCreateBranchOnly('feature/demo-43-parallel', BASE);
    assert.equal(result.ok, true);
    assert.match(result.message, /Branch already exists/);
  });
});

// ─── conflictCheck ────────────────────────────────────────────────────────────

const activeTask = (branch) => ({ pageId: 'x', branch, status: 'In progress' });

test('conflictCheck reports overlapping files between two active branches', () => {
  inRepo((cwd) => {
    commitOnBranch(cwd, 'feature/demo-40-other', { 'src/shared.js': 'other\n', 'src/only-other.js': 'o\n' });
    commitOnBranch(cwd, 'feature/demo-42-mine', { 'src/shared.js': 'mine\n' });

    const result = git.conflictCheck('feature/demo-42-mine', [activeTask('feature/demo-40-other')], BASE, false);
    assert.equal(result.conflict, true);
    assert.match(result.msg, /overlapping files between feature\/demo-42-mine and feature\/demo-40-other/);
    assert.match(result.msg, /src\/shared\.js/);
    assert.doesNotMatch(result.msg, /only-other/, 'only the intersection is reported');
  });
});

test('conflictCheck passes when the branches touch disjoint files', () => {
  inRepo((cwd) => {
    commitOnBranch(cwd, 'feature/demo-40-other', { 'src/other.js': 'o\n' });
    commitOnBranch(cwd, 'feature/demo-42-mine', { 'src/mine.js': 'm\n' });

    const result = git.conflictCheck('feature/demo-42-mine', [activeTask('feature/demo-40-other')], BASE, false);
    assert.equal(result.conflict, false);
  });
});

test('force bypasses an overlap but keeps the disclaimer', () => {
  inRepo((cwd) => {
    commitOnBranch(cwd, 'feature/demo-40-other', { 'src/shared.js': 'other\n' });
    commitOnBranch(cwd, 'feature/demo-42-mine', { 'src/shared.js': 'mine\n' });

    const result = git.conflictCheck('feature/demo-42-mine', [activeTask('feature/demo-40-other')], BASE, true);
    assert.equal(result.conflict, false);
    assert.match(result.disclaimer, /Parallel tasks active/);
  });
});

test('a branch with no commits of its own cannot conflict — nothing to compare', () => {
  inRepo((cwd) => {
    commitOnBranch(cwd, 'feature/demo-40-other', { 'src/shared.js': 'other\n' });
    // The usual first-apply shape: the new branch does not exist yet.
    const result = git.conflictCheck('feature/demo-42-brand-new', [activeTask('feature/demo-40-other')], BASE, false);
    assert.equal(result.conflict, false);
    assert.match(result.disclaimer, /Parallel tasks active/);
  });
});

test('the disclaimer appears only when another task is actually active', () => {
  inRepo((cwd) => {
    commitOnBranch(cwd, 'feature/demo-42-mine', { 'src/mine.js': 'm\n' });
    const result = git.conflictCheck('feature/demo-42-mine', [], BASE, false);
    assert.equal(result.conflict, false);
    assert.equal(result.disclaimer, '');
  });
});

test('a task is never in conflict with itself', () => {
  inRepo((cwd) => {
    commitOnBranch(cwd, 'feature/demo-42-mine', { 'src/shared.js': 'm\n' });
    const result = git.conflictCheck('feature/demo-42-mine', [activeTask('feature/demo-42-mine')], BASE, false);
    assert.equal(result.conflict, false);
  });
});
