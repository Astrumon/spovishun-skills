'use strict';

// `--apply-pick <pageId>` — the only mode that mutates three systems at once:
// git (branch), .dev-context/ (cache + selection) and the Notion board (Status).
// Claude runs it after the user picks from the picker's AskUserQuestion.
//
// It is also the only mode that exits NON-ZERO: a failed apply must be visible
// to Claude so it can report it instead of proceeding on a task it never started.

const { notionRequest } = require('./notion-api.js');
const { PROJECT_PREFIX, DEVELOP_BRANCH } = require('./hook-config.js');
const { extractBranchFromBlocks, deriveBranchFromName, extractTaskNumber } = require('./branch-name.js');
const { toDashed, toCompact } = require('./page-id.js');
const { extractBlocks, visibleBlocks } = require('./notion-blocks.js');
const { gitSetupBranch, gitCreateBranchOnly, conflictCheck } = require('./git-ops.js');
const { writeTaskContext, loadSelectedTasks, saveSelectedTasks } = require('./dev-context.js');

const ACTIONABLE_STATUSES = ['To do', 'In progress'];

/** Every failure path exits 1 — see the module header for why. */
function fail(message) {
  process.stderr.write(`[apply-pick] ${message}\n`);
  process.exit(1);
}

async function fetchTask(token, pageId) {
  const page = await notionRequest(token, 'GET', `/v1/pages/${toDashed(pageId)}`, null);
  if (!page || page.object === 'error') fail(`Failed to fetch page ${pageId}: ${JSON.stringify(page)}`);
  return {
    page,
    name: (page.properties?.Name?.title || []).map(t => t.plain_text).join('') || 'Unknown',
    status: page.properties?.Status?.status?.name,
  };
}

/**
 * A "Not started" pick is promoted through "To do" first rather than straight to
 * "In progress": the picker's own filters and any board automation both key off
 * that transition, so skipping it would leave the board internally inconsistent.
 */
async function ensureActionable(token, page, status, fromNotStarted) {
  if (!fromNotStarted) {
    if (!ACTIONABLE_STATUSES.includes(status)) {
      fail(`Task status is "${status}", expected "To do" or "In progress"`);
    }
    return;
  }
  const patch = await notionRequest(token, 'PATCH', `/v1/pages/${page.id}`, {
    properties: { Status: { status: { name: 'To do' } } },
  });
  if (patch?.object === 'error') fail(`Failed to update status: ${JSON.stringify(patch)}`);
}

/** A branch the page states explicitly wins; otherwise derive one from the title. */
function resolveTaskBranch(blocks, name) {
  const branch = extractBranchFromBlocks(blocks) || deriveBranchFromName(name, PROJECT_PREFIX);
  if (!branch) fail(`Cannot derive branch name from task: "${name}"`);
  return branch;
}

function guardAgainstConflicts(taskBranch, cleanPageId, force) {
  const otherTasks = loadSelectedTasks().filter(t => t.pageId !== cleanPageId);
  const check = conflictCheck(taskBranch, otherTasks, DEVELOP_BRANCH, force);
  if (check.conflict) {
    // Not routed through fail(): the CONFLICT: prefix is the contract the picker
    // directive tells Claude to look for, so it must lead the line.
    process.stderr.write(check.msg + '\n');
    process.exit(1);
  }
  return check.disclaimer;
}

/** Replaces this task's entry rather than appending, so re-applying is idempotent. */
function recordSelection({ cleanPageId, taskNumber, name, taskBranch }) {
  const tasks = loadSelectedTasks().filter(t => t.pageId !== cleanPageId);
  tasks.push({
    pageId: cleanPageId, taskNumber, name, branch: taskBranch,
    addedAt: Date.now(), status: 'In progress',
  });
  saveSelectedTasks(tasks);
}

async function applyPickMain(token, pageId, { force, fromNotStarted, noSwitch }) {
  const { page, name, status } = await fetchTask(token, pageId);
  const cleanPageId = toCompact(page.id);
  await ensureActionable(token, page, status, fromNotStarted);

  const blocksResult = await notionRequest(token, 'GET', `/v1/blocks/${cleanPageId}/children?page_size=100`, null);
  const allBlocks = blocksResult?.results || [];
  const taskBranch = resolveTaskBranch(allBlocks, name);

  const disclaimer = guardAgainstConflicts(taskBranch, cleanPageId, force);
  const gitResult = noSwitch
    ? gitCreateBranchOnly(taskBranch, DEVELOP_BRANCH)
    : gitSetupBranch(taskBranch, DEVELOP_BRANCH);

  writeTaskContext({
    branch: taskBranch,
    name,
    content: extractBlocks(visibleBlocks(allBlocks)),
    task: {
      id: page.id, title: name, status: 'In progress', branch: taskBranch,
      priority: page.properties?.Priority?.select?.name ?? null,
      content: extractBlocks(allBlocks),
    },
  });

  const statusPatch = await notionRequest(token, 'PATCH', `/v1/pages/${page.id}`, {
    properties: { Status: { status: { name: 'In progress' } } },
  });
  if (statusPatch?.object === 'error') {
    // Not fatal (branch + context are already set up), but the user must know
    // the board does not reflect the local state.
    process.stderr.write(`[apply-pick] Warning: failed to set Status=In progress in Notion: ${statusPatch.message || statusPatch.code}\n`);
  }

  recordSelection({ cleanPageId, taskNumber: extractTaskNumber(name), name, taskBranch });

  if (disclaimer) process.stdout.write(disclaimer + '\n');
  process.stdout.write(`OK: ${PROJECT_PREFIX}-${extractTaskNumber(name)} activated on ${taskBranch}\n`);
  if (!gitResult.ok) process.stderr.write(`[apply-pick] Git warning: ${gitResult.message}\n`);
}

module.exports = { applyPickMain, resolveTaskBranch };
