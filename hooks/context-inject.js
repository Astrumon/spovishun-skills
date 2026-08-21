'use strict';

// The three passive modes — everything that reads state rather than picking a
// new task:
//
//   runFinishTask     "finish task" → hand off to the finish-task skill
//   injectFromCache   a trigger word on a branch that already has context
//   fetchAndInject    the same, but nothing is cached yet → ask Notion
//   runPostExitPlan   PostToolUse(ExitPlanMode) → save the approved plan
//
// All of them exit 0 no matter what: a UserPromptSubmit hook that fails hard
// would take the user's prompt down with it.

const { notionRequest } = require('./notion-api.js');
const { DATABASE_ID, PROJECT_PREFIX, withStageFilter, isBaseBranch } = require('./hook-config.js');
const { extractBranchFromBlocks, deriveBranchFromName } = require('./branch-name.js');
const { toCompact } = require('./page-id.js');
const { extractBlocks, visibleBlocks } = require('./notion-blocks.js');
const { fetchBlockTree } = require('./block-tree.js');
const { childrenPageFetcher } = require('./notion-api.js');
const {
  branchToFolderName, contextFilePath, formatContext, hasTaskContext, isCurrentSession,
  readCachedContext, readPlan, savePlan, writeSessionLock, writeTaskContext,
} = require('./dev-context.js');
const { buildSystemPrompt, outputPrompt } = require('./hook-output.js');

const LABEL = 'notion-task-inject';

function skip(reason) {
  process.stderr.write(`[${LABEL}] ${reason}\n`);
}

// ─── finish task ───────────────────────────────────────────────────────────────

/**
 * Local and Notion-independent: it gates on the cached .dev-context for the
 * active branch, which is why main() handles it before the DATABASE_ID guard.
 * @returns {boolean} true when a directive was emitted
 */
function runFinishTask(branch) {
  if (isBaseBranch(branch)) {
    skip('finish task: not on an active task branch, skipping');
    return false;
  }
  if (!hasTaskContext(branch)) {
    skip('finish task: no .dev-context for this branch, skipping');
    return false;
  }
  outputPrompt(`## Finish Task\nActive task branch: \`${branch}\`\n\n---\n### REQUIRED NEXT ACTIONS (execute in order):\n1. Immediately invoke the \`finish-task\` skill to run the completion gate (tests → build → lint, blocking) and the advisory \`code-reviewer\` pass on this branch's diff.\n2. Do NOT push, open a PR, or set Notion Status=Done automatically — only offer those after the gate is green and the user has acknowledged any Critical review findings.`);
  return true;
}

// ─── cache-first injection ─────────────────────────────────────────────────────

/**
 * Replays the cached task context, once per Claude session. The session lock is
 * what makes it once-per-session: every prompt matching a trigger word runs this
 * hook, and re-injecting the same context on each one would just burn tokens.
 * @returns {boolean} true when handled (emitted OR deliberately suppressed)
 */
function injectFromCache(branch) {
  if (isBaseBranch(branch)) return false;
  const cached = readCachedContext(branch);
  if (!cached) return false;

  const lockFile = contextFilePath(branch, 'session.lock');
  if (isCurrentSession(lockFile)) return true;

  writeSessionLock(lockFile);
  outputPrompt(buildSystemPrompt(cached.context, cached.plan, null, false));
  return true;
}

// ─── Notion fetch ──────────────────────────────────────────────────────────────

async function fetchActiveTask(token) {
  const queryResult = await notionRequest(token, 'POST', `/v1/databases/${DATABASE_ID}/query`, {
    filter: withStageFilter({
      or: [
        { property: 'Status', status: { equals: 'To do' } },
        { property: 'Status', status: { equals: 'In progress' } },
      ],
    }),
    page_size: 1,
  });

  const page = queryResult?.results?.[0];
  if (!page) return null;

  const name = (page.properties?.Name?.title || []).map(t => t.plain_text).join('') || 'Unknown';
  // Hydrated, not flat — see apply-pick.js for why the toggle body matters.
  const allBlocks = await fetchBlockTree(childrenPageFetcher(token), toCompact(page.id));

  return {
    page,
    name,
    allBlocks,
    taskBranch: extractBranchFromBlocks(allBlocks) || deriveBranchFromName(name, PROJECT_PREFIX),
  };
}

function branchNoteFor(isRefresh, currentBranch, taskBranch) {
  if (isRefresh) return '\n> Context refreshed from Notion.';
  if (currentBranch && taskBranch && currentBranch !== taskBranch) {
    return `\n> Current branch: \`${currentBranch}\`. Task branch: \`${taskBranch}\`. Use "start new task" to switch.`;
  }
  return '';
}

/** Fetches the board's active task, caches it, and injects it. */
async function fetchAndInject(token, { currentBranch, isRefresh }) {
  const task = await fetchActiveTask(token);
  if (!task) return;

  const { page, name, allBlocks, taskBranch } = task;
  const content = extractBlocks(visibleBlocks(allBlocks));

  // Cache under the branch the user is actually on when that is a task branch —
  // the context they need is the one for their working tree, not the board's.
  const cacheBranch = isBaseBranch(currentBranch) ? taskBranch : currentBranch;
  if (cacheBranch) {
    writeTaskContext({
      branch: cacheBranch,
      name,
      content,
      task: {
        id: page.id, title: name,
        status: page.properties?.Status?.status?.name ?? null,
        branch: taskBranch,
        priority: page.properties?.Priority?.select?.name ?? null,
        content: extractBlocks(allBlocks),
      },
    });
  }

  const plan = isRefresh && cacheBranch ? readPlan(cacheBranch) : null;
  outputPrompt(buildSystemPrompt(
    formatContext(name, content), plan,
    branchNoteFor(isRefresh, currentBranch, taskBranch), false
  ));
}

// ─── PostToolUse: ExitPlanMode ─────────────────────────────────────────────────

function runPostExitPlan(data, branch) {
  const planContent = data?.tool_input?.plan;
  if (!planContent) return;
  if (isBaseBranch(branch)) return;
  savePlan(branch, planContent);
  process.stderr.write(`[${LABEL}] plan saved → .dev-context/${branchToFolderName(branch)}/plan.md\n`);
}

module.exports = { runFinishTask, injectFromCache, fetchAndInject, runPostExitPlan };
