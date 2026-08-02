'use strict';

// Git side of applying a task pick. Every entry point takes the base branch as
// an argument instead of reading it from config: these functions build shell
// command lines, so the fewer ambient inputs they have, the smaller the surface
// that has to be audited — and it makes them testable against a real repo
// without an env or a config file.
//
// Failures are returned as { ok, message }, never thrown: a branch that cannot
// be created must not strand a task whose context was already written.

const { execSync } = require('child_process');

const LABEL = 'notion-task-inject';

// Branch names reach execSync command lines. Both sources are external (config
// scalar, Notion page text), so refuse anything outside safe git-ref characters
// before interpolating — double quotes alone do not stop $(...) on POSIX shells.
const SAFE_BRANCH_RE = /^[\w./-]+$/;

function assertSafeBranch(name, label) {
  if (!SAFE_BRANCH_RE.test(name)) {
    throw new Error(`unsafe ${label} name "${name}" — only [A-Za-z0-9_./-] allowed`);
  }
  return name;
}

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' }).toString().trim();
  } catch { return null; }
}

function branchExists(branch) {
  try {
    execSync(`git rev-parse --verify "${branch}"`, { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

/**
 * `git fetch` updates origin/<base>, NEVER the local <base>, so a new branch is
 * cut from the remote-tracking ref to avoid inheriting a stale local develop.
 * Offline → fall back to the local base with a warning rather than failing the
 * apply outright.
 *
 * @returns {{ start: string, fetched: boolean }}
 */
function resolveStartPoint(base) {
  try {
    execSync(`git fetch origin "${base}" --quiet`, { stdio: 'pipe' });
    return { start: `origin/${base}`, fetched: true };
  } catch {
    return { start: base, fetched: false };
  }
}

/**
 * Suffix for the success message, and — when offline — the stderr warning that
 * goes with it. The consumer has to learn their branch may be behind origin.
 */
function originNote(branch, base, fetched) {
  if (fetched) return ` (from origin/${base})`;
  process.stderr.write(`[${LABEL}] git fetch failed — branched ${branch} from local ${base} (may be stale)\n`);
  return ' (offline: local base, may be stale)';
}

function validateRefs(branch, base) {
  try {
    assertSafeBranch(branch, 'branch');
    assertSafeBranch(base, 'base branch');
    return null;
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/** Creates or switches to `branch`, leaving it checked out. */
function gitSetupBranch(branch, base) {
  const invalid = validateRefs(branch, base);
  if (invalid) return invalid;

  if (branchExists(branch)) {
    try {
      execSync(`git checkout "${branch}"`, { stdio: 'pipe' });
      return { ok: true, message: `Switched to existing branch: ${branch}` };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  const { start, fetched } = resolveStartPoint(base);
  try {
    execSync(`git checkout -b "${branch}" "${start}"`, { stdio: 'pipe' });
    return { ok: true, message: `Created and switched to: ${branch}${originNote(branch, base, fetched)}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/** Creates `branch` without moving HEAD — the 2nd+ parallel task. */
function gitCreateBranchOnly(branch, base) {
  const invalid = validateRefs(branch, base);
  if (invalid) return invalid;

  if (branchExists(branch)) return { ok: true, message: `Branch already exists: ${branch}` };

  const { start, fetched } = resolveStartPoint(base);
  try {
    execSync(`git branch "${branch}" "${start}"`, { stdio: 'pipe' });
    return { ok: true, message: `Created branch (no checkout): ${branch}${originNote(branch, base, fetched)}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * Files a branch changed relative to `base`, or null when the branch has no
 * commits of its own (or does not exist yet — the ordinary first-apply shape).
 */
function changedFiles(branch, base) {
  try {
    assertSafeBranch(branch, 'branch');
    assertSafeBranch(base, 'base branch');
    const count = parseInt(
      execSync(`git rev-list "${base}".."${branch}" --count`, { stdio: 'pipe' }).toString().trim(), 10
    );
    if (isNaN(count) || count === 0) return null;
    const out = execSync(`git diff --name-only "${base}"..."${branch}"`, { stdio: 'pipe' }).toString();
    return new Set(out.split('\n').filter(Boolean));
  } catch { return null; }
}

/**
 * Refuses to start a task whose branch already overlaps another active task's
 * files — parallel tasks share one working tree only if they touch disjoint code.
 */
function conflictCheck(newBranch, existingTasks, base, force) {
  const newFiles = changedFiles(newBranch, base);
  const disclaimer = existingTasks.length > 0
    ? 'DISCLAIMER: Parallel tasks active; run each in a separate Claude Code instance.'
    : '';

  if (!newFiles) return { conflict: false, disclaimer };

  for (const task of existingTasks) {
    if (task.branch === newBranch) continue;
    const otherFiles = changedFiles(task.branch, base);
    if (!otherFiles) continue;
    const intersection = [...newFiles].filter(f => otherFiles.has(f));
    if (intersection.length > 0 && !force) {
      return {
        conflict: true,
        msg: `CONFLICT: overlapping files between ${newBranch} and ${task.branch}: [${intersection.join(', ')}]. Retry with --force to bypass.`,
        disclaimer,
      };
    }
  }
  return { conflict: false, disclaimer };
}

module.exports = {
  assertSafeBranch,
  getCurrentBranch,
  branchExists,
  gitSetupBranch,
  gitCreateBranchOnly,
  changedFiles,
  conflictCheck,
};
