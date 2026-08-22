'use strict';

// "start new task" mode. Produces a DIRECTIVE on stdout that Claude executes:
// an AskUserQuestion block plus the `--apply-pick` command lines to run for each
// choice. The picker itself changes nothing except the selected-tasks file — all
// the git and Notion mutation happens later, in apply-pick.js.

const { notionRequest } = require('./notion-api.js');
const { DATABASE_ID, PROJECT_PREFIX, HOOK_DIR, withStageFilter, isBaseBranch } = require('./hook-config.js');
const { extractTaskNumber, displayName } = require('./branch-name.js');
const { toCompact } = require('./page-id.js');
const {
  contextFilePath, readCachedContext, writeSessionLock, loadSelectedTasks, saveSelectedTasks,
} = require('./dev-context.js');
const { buildSystemPrompt, outputPrompt } = require('./hook-output.js');
const { PRIORITY_TIERS, PICKER_TIER_LIMIT, TODO_GROUP_STATUSES } = require('./notion-constants.js');

// get-board.js ORs the to_do group into one filter; the picker walks it in
// preference order instead, because only the fallback phase gets the
// --from-not-started promotion apply-pick.js performs. Same membership, one
// source — that is what stops the hook and the CLI from drifting apart again.
const [PRIMARY_STATUS, FALLBACK_STATUS] = TODO_GROUP_STATUSES;

const ACTIONABLE_STATUSES = [PRIMARY_STATUS, 'In progress'];

function boardQuery(token, filter, extra = {}) {
  return notionRequest(token, 'POST', `/v1/databases/${DATABASE_ID}/query`, {
    filter: withStageFilter(filter),
    page_size: PICKER_TIER_LIMIT,
    ...extra,
  });
}

/**
 * Walks High → Medium → Low and stops at the first tier with anything in it, so
 * an urgent task is never buried under older low-priority ones. Falls back to a
 * priority-agnostic query for boards that do not set the property.
 */
async function queryByPriorityTier(token, status) {
  const oldestFirst = { sorts: [{ timestamp: 'created_time', direction: 'ascending' }] };
  for (const priority of PRIORITY_TIERS) {
    const result = await boardQuery(token, {
      and: [
        { property: 'Status', status: { equals: status } },
        { property: 'Priority', select: { equals: priority } },
      ],
    }, oldestFirst);
    const candidates = result?.results || [];
    if (candidates.length > 0) return { candidates, tier: priority };
  }

  const result = await boardQuery(token, { property: 'Status', status: { equals: status } }, oldestFirst);
  return { candidates: result?.results || [], tier: null };
}

/**
 * Drops the whole selection when any task in it has left To do / In progress —
 * it was finished or archived from another instance (or from Notion directly),
 * and a stale entry would keep excluding a task that is available again.
 */
async function dropStaleSelections(token, selectedTasks) {
  for (const task of selectedTasks) {
    const page = await notionRequest(token, 'GET', `/v1/pages/${task.pageId}`, null);
    if (!ACTIONABLE_STATUSES.includes(page?.properties?.Status?.status?.name)) {
      saveSelectedTasks([]);
      return [];
    }
  }
  return selectedTasks;
}

/**
 * Already standing on an active task's branch with its context cached: re-assert
 * In progress on the board and replay the cache instead of showing a picker.
 * @returns {boolean} true when the directive was emitted and the picker is done
 */
async function resumeActiveBranch(token, currentBranch, selectedTasks, hasGrillModifier) {
  if (isBaseBranch(currentBranch)) return false;
  const activeEntry = selectedTasks.find(t => t.branch === currentBranch);
  if (!activeEntry) return false;
  const cached = readCachedContext(currentBranch);
  if (!cached) return false;

  await notionRequest(token, 'PATCH', `/v1/pages/${activeEntry.pageId}`, {
    properties: { Status: { status: { name: 'In progress' } } },
  }).catch(() => {});

  writeSessionLock(contextFilePath(currentBranch, 'session.lock'));
  outputPrompt(buildSystemPrompt(
    cached.context, cached.plan,
    '\n**Git:** Already on active task branch — skipping checkout',
    true, hasGrillModifier
  ));
  return true;
}

function toOption(page) {
  const name = (page.properties?.Name?.title || []).map(t => t.plain_text).join('') || 'Unknown';
  return {
    name,
    taskNum: extractTaskNumber(name) || '?',
    displayName: displayName(name, PROJECT_PREFIX),
    priority: page.properties?.Priority?.select?.name || '—',
    pageId: toCompact(page.id),
  };
}

/**
 * The offerable set: PRIMARY_STATUS first, FALLBACK_STATUS only if that is
 * empty, plus any "In progress" task nobody is tracking (an interrupted session's leftovers).
 */
async function collectCandidates(token, selectedPageIds) {
  const unselected = pages => pages.filter(p => !selectedPageIds.has(toCompact(p.id)));

  let source = 'toDo';
  let { candidates, tier } = await queryByPriorityTier(token, PRIMARY_STATUS);
  candidates = unselected(candidates);

  if (candidates.length === 0) {
    source = 'notStarted';
    ({ candidates, tier } = await queryByPriorityTier(token, FALLBACK_STATUS));
    candidates = unselected(candidates);
  }

  const inProgress = await boardQuery(token, { property: 'Status', status: { equals: 'In progress' } });
  const orphaned = unselected(inProgress?.results || []);

  return {
    source,
    options: [
      ...orphaned.map(p => ({ ...toOption(p), orphaned: true })),
      ...candidates.map(p => ({ ...toOption(p), tier, orphaned: false })),
    ],
  };
}

function buildNotes(options, source, activeCount) {
  return [
    activeCount > 0
      ? `\n${activeCount} task(s) currently active. Adding more = parallel execution across Claude Code instances.`
      : '',
    source === 'notStarted'
      ? `\n> No "${PRIMARY_STATUS}" tasks found — showing "${FALLBACK_STATUS}". Selected tasks will be moved to "${PRIMARY_STATUS}" automatically.`
      : '',
    options.some(o => o.orphaned)
      ? '\n> Untracked "In progress" tasks found — listed first for recovery.'
      : '',
  ].join('');
}

function optionLines(options) {
  return options.map((o, i) => {
    const tag = o.orphaned ? ' *(In progress — untracked)*' : ` *(Priority: ${o.priority})*`;
    return `${i + 1}. **${PROJECT_PREFIX}-${o.taskNum}** — ${o.displayName}${tag}\n   pageId: \`${o.pageId}\``;
  }).join('\n');
}

function applyCommand(pageId, flags, extra = '') {
  return `node "${HOOK_DIR}/notion-task-inject.js" --apply-pick ${pageId}${flags}${extra}`;
}

const CONFLICT_HINT =
  'If stderr starts with `CONFLICT:` → show user the conflicting files, ask: retry with `--force` or skip?';

function skillInvocation(hasGrillModifier) {
  return hasGrillModifier
    ? 'and `grillFirst=true` — it loads task context, runs `grill-me` to stress-test the plan, then enters Plan Mode'
    : 'to load task context and enter Plan Mode';
}

function soleTaskDirective(header, option, flags, invokeNote) {
  return `${header}\n\n---\n### REQUIRED NEXT ACTIONS (execute in order):\n1. Only one task available — apply automatically without asking the user.\n2. Run Bash: \`${applyCommand(option.pageId, flags)}\`\n   ${CONFLICT_HINT}\n3. Briefly confirm: task name and branch.\n4. Immediately invoke the \`notion-task-to-code\` skill with pageId \`${option.pageId}\` ${invokeNote}.`;
}

function multiTaskDirective(header, options, flags, invokeNote) {
  const aqOptions = options.map((o) => {
    const suffix = o.orphaned ? ' (resume)' : '';
    return `     {label: "${PROJECT_PREFIX}-${o.taskNum} — ${o.displayName}${suffix}", value: "${o.pageId}"}`;
  }).join(',\n');

  return `${header}\n\n---\n### REQUIRED NEXT ACTIONS (execute in order):\n1. Call \`AskUserQuestion\`:\n   \`\`\`\n   question: "Select tasks to start working on (multiple selection allowed):"\n   multiSelect: true\n   options: [\n${aqOptions},\n     {label: "Cancel", value: "cancel"}\n   ]\n   \`\`\`\n2. If user picked **"Cancel"** → inform user, stop.\n3. For **each** selected pageId — run Bash sequentially:\n   - 1st task:  \`${applyCommand('<pageId>', flags)}\`\n   - 2nd+ task: \`${applyCommand('<pageId>', flags, ' --no-switch')}\`\n   ${CONFLICT_HINT}\n4. After all applies — if ≥2 tasks selected → show the DISCLAIMER line from stdout.\n5. Briefly confirm: task name(s), branch(es), total active parallel tasks count.\n6. Immediately invoke the \`notion-task-to-code\` skill with the first selected pageId ${invokeNote}.`;
}

async function runPicker(token, currentBranch, isForce, hasGrillModifier) {
  let selectedTasks = loadSelectedTasks();
  if (selectedTasks.length > 0) selectedTasks = await dropStaleSelections(token, selectedTasks);
  if (await resumeActiveBranch(token, currentBranch, selectedTasks, hasGrillModifier)) return;

  const selectedPageIds = new Set(selectedTasks.map(t => t.pageId));
  const { options, source } = await collectCandidates(token, selectedPageIds);

  if (options.length === 0) {
    outputPrompt(buildSystemPrompt(
      `## No Tasks Available\n\nNo "${PRIMARY_STATUS}", "${FALLBACK_STATUS}", or untracked "In progress" tasks found.`,
      null, null, false
    ));
    return;
  }

  const header = `## Task Picker\n${buildNotes(options, source, selectedTasks.length)}\n\n**Available tasks**:\n${optionLines(options)}`;
  const flags = [source === 'notStarted' ? ' --from-not-started' : '', isForce ? ' --force' : ''].join('');
  const invokeNote = skillInvocation(hasGrillModifier);

  outputPrompt(options.length === 1
    ? soleTaskDirective(header, options[0], flags, invokeNote)
    : multiTaskDirective(header, options, flags, invokeNote));
}

module.exports = { runPicker, queryByPriorityTier, PRIORITY_TIERS, PICKER_TIER_LIMIT };
