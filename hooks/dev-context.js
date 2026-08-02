'use strict';

// The consumer-side state the hook owns, all under .dev-context/:
//
//   {branch}_prd/branch.txt      — exact branch name
//   {branch}_prd/context.md      — cached task text from Notion
//   {branch}_prd/plan.md         — approved plan (auto-saved on ExitPlanMode)
//   {branch}_prd/session.lock    — "{ppid}:{timestamp}" dedup guard
//   selected-tasks.json          — active tasks shared across Claude instances
//
// Paths resolve from process.cwd() on every call, never at require time: hooks
// run from the consumer root and the tests chdir between cases.

const fs = require('fs');
const path = require('path');

const DEV_CONTEXT_DIR = '.dev-context';
const SELECTED_TASKS_FILE = 'selected-tasks.json';
const SELECTED_TASKS_VERSION = 1;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function branchToFolderName(branch) {
  return branch.replace(/\//g, '-') + '_prd';
}

function getContextDir(branch) {
  return path.join(process.cwd(), DEV_CONTEXT_DIR, branchToFolderName(branch));
}

function contextFilePath(branch, name) {
  return path.join(getContextDir(branch), name);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Session lock ──────────────────────────────────────────────────────────────

/**
 * True when the lock was written by a Claude session that is still alive. Used
 * to inject a task context once per session rather than on every prompt.
 * A dead pid or an expired timestamp both read as "not current".
 */
function isCurrentSession(lockFile) {
  try {
    const [pidStr, tsStr] = fs.readFileSync(lockFile, 'utf8').trim().split(':');
    if (Date.now() - parseInt(tsStr, 10) > SESSION_TTL_MS) return false;
    process.kill(parseInt(pidStr, 10), 0);
    return true;
  } catch { return false; }
}

function writeSessionLock(lockFile) {
  // The parent pid is the Claude session; this process is a short-lived hook.
  fs.writeFileSync(lockFile, `${process.ppid || process.pid}:${Date.now()}`, 'utf8');
}

// ─── Cached task context ───────────────────────────────────────────────────────

/** The banner every cached context and injected prompt opens with. */
function formatContext(name, content) {
  return `## Active Task (Notion)\n**${name}**\n\n${content}`;
}

/** Reads a branch's cached context, or null when there is none. */
function readCachedContext(branch) {
  const contextFile = contextFilePath(branch, 'context.md');
  if (!fs.existsSync(contextFile)) return null;
  const planFile = contextFilePath(branch, 'plan.md');
  return {
    context: fs.readFileSync(contextFile, 'utf8'),
    plan: fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf8') : null,
  };
}

function readPlan(branch) {
  const planFile = contextFilePath(branch, 'plan.md');
  return fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf8') : null;
}

/** True once a branch has any cached task state — what "finish task" gates on. */
function hasTaskContext(branch) {
  return fs.existsSync(contextFilePath(branch, 'task.json'))
    || fs.existsSync(contextFilePath(branch, 'context.md'));
}

/**
 * Writes the full cache for a branch and stamps the session lock.
 * `task` is the task.json payload — kept a caller concern because the picker and
 * the injection path record different Status values for the same page.
 */
function writeTaskContext({ branch, name, content, task }) {
  const dir = getContextDir(branch);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'context.md'), formatContext(name, content), 'utf8');
  fs.writeFileSync(path.join(dir, 'branch.txt'), branch, 'utf8');
  fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(task), 'utf8');
  writeSessionLock(path.join(dir, 'session.lock'));
  return dir;
}

function savePlan(branch, planContent) {
  const dir = getContextDir(branch);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'plan.md'), planContent, 'utf8');
  // Clearing the lock is the point, not housekeeping: the next prompt must
  // re-inject the context so it carries the freshly approved plan.
  const lockFile = path.join(dir, 'session.lock');
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
}

// ─── Selected tasks (shared across parallel Claude instances) ──────────────────

function selectedTasksPath() {
  return path.join(process.cwd(), DEV_CONTEXT_DIR, SELECTED_TASKS_FILE);
}

function loadSelectedTasks() {
  try {
    const data = JSON.parse(fs.readFileSync(selectedTasksPath(), 'utf8'));
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch { return []; }
}

function saveSelectedTasks(tasks) {
  const filePath = selectedTasksPath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify({ version: SELECTED_TASKS_VERSION, tasks }, null, 2), 'utf8');
}

module.exports = {
  DEV_CONTEXT_DIR,
  SELECTED_TASKS_VERSION,
  SESSION_TTL_MS,
  branchToFolderName,
  getContextDir,
  contextFilePath,
  ensureDir,
  isCurrentSession,
  writeSessionLock,
  formatContext,
  readCachedContext,
  readPlan,
  hasTaskContext,
  writeTaskContext,
  savePlan,
  loadSelectedTasks,
  saveSelectedTasks,
};
