#!/usr/bin/env node
/**
 * Triple-mode hook. This file is dispatch only — every mode lives in a sibling
 * module under hooks/ (see "Hook module layout" in CLAUDE.md for why they are
 * flat here and never under scripts/).
 *
 * 1. UserPromptSubmit — injects active Notion task context into the prompt.
 *    On START_TASK_TRIGGERS: shows an interactive task picker directive for Claude
 *    to present via AskUserQuestion. If the prompt also matches GRILL_MODIFIER_TRIGGERS
 *    (e.g. "start new task with grill" / "з грилем"), the picker's directive tells Claude
 *    to run the `grill-me` skill on the loaded task BEFORE entering Plan Mode.
 *    Other triggers: cache-first context injection.        → context-inject.js, task-picker.js
 *
 * 2. PostToolUse (ExitPlanMode) — auto-saves the approved plan.
 *    Invoked as: node notion-task-inject.js --post-exit-plan   → context-inject.js
 *
 * 3. CLI apply-pick — applies a task selection (creates branch, writes context).
 *    Invoked as: node notion-task-inject.js --apply-pick <pageId> [flags]
 *    Flags: --from-not-started  move task from Not started → To do first
 *           --no-switch         create branch without git checkout (2nd+ parallel task)
 *           --force             bypass git conflict check
 *    Called by Claude after user picks task(s) via AskUserQuestion.
 *    Exits 1 on error so Claude can surface it; all other modes exit 0. → apply-pick.js
 *
 * Configuration (hook-config.js). Env vars take precedence; otherwise resolved from
 * the consumer's spovishun-skills.config.yaml, so a plain `install` works with no
 * extra env setup:
 *   NOTION_TOKEN or NOTION_SKILLS_TOKEN  — Notion API token (required; from env/.env)
 *   NOTION_DATABASE_ID          ⟵ notion.database_id   — task board database ID (required)
 *   PROJECT_PREFIX              ⟵ slug(project.name)    — branch prefix → feature/<prefix>-N
 *   GIT_DEVELOP_BRANCH          ⟵ git.dev_branch        — base branch name, default "develop"
 *
 * State files live under .dev-context/ in the consumer project — see dev-context.js.
 */

const { NOTION_TOKEN, DATABASE_ID, HOOK_LABEL } = require('./hook-config.js');
const { getCurrentBranch } = require('./git-ops.js');
const { runPicker } = require('./task-picker.js');
const { applyPickMain } = require('./apply-pick.js');
const {
  runFinishTask, injectFromCache, fetchAndInject, runPostExitPlan,
} = require('./context-inject.js');

const TRIGGER_WORDS = ['implement', 'refactor', 'реалізуй', 'розроби', 'задача', 'таск', 'фіча'];
const START_TASK_TRIGGERS = ['start new task', 'почати нову задачу', 'беру нову задачу', 'почни нову задачу'];
const FINISH_TASK_TRIGGERS = ['finish task', 'complete task', 'завершити задачу', 'закінчити задачу'];
const REFRESH_TRIGGERS = ['reread task', 'update task context', 'оновити контекст задачі', 'перечитати задачу'];
// Modifier on top of START_TASK_TRIGGERS — runs grill-me on the loaded task before
// Plan Mode instead of entering it directly. Only meaningful when isStartTask.
const GRILL_MODIFIER_TRIGGERS = ['with grill', 'з грилем', 'з допитом', 'з прожаркою'];

async function readStdinJson() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function classifyPrompt(text) {
  const prompt = (text || '').toLowerCase();
  const has = list => list.some(t => prompt.includes(t));
  const isStartTask = has(START_TASK_TRIGGERS);
  return {
    isStartTask,
    isFinishTask: has(FINISH_TASK_TRIGGERS),
    isRefresh: has(REFRESH_TRIGGERS),
    isForce: prompt.includes('--force'),
    hasGrillModifier: isStartTask && has(GRILL_MODIFIER_TRIGGERS),
    hasTrigger: isStartTask || has(FINISH_TASK_TRIGGERS) || has(REFRESH_TRIGGERS) || has(TRIGGER_WORDS),
  };
}

function skip(reason) {
  process.stderr.write(`[${HOOK_LABEL}] ${reason}\n`);
}

async function startTask(currentBranch, intent) {
  if (!NOTION_TOKEN) return skip('NOTION_TOKEN not set, skipping picker');
  try {
    await runPicker(NOTION_TOKEN, currentBranch, intent.isForce, intent.hasGrillModifier);
  } catch (err) {
    // A picker that cannot reach Notion must still let the prompt through.
    skip(`Picker error: ${err.message}`);
  }
}

async function injectContext(currentBranch, intent) {
  // A refresh deliberately bypasses the cache — that is what it is for.
  if (!intent.isRefresh && injectFromCache(currentBranch)) return;
  if (!NOTION_TOKEN) return skip('NOTION_TOKEN not set, skipping');
  try {
    await fetchAndInject(NOTION_TOKEN, { currentBranch, isRefresh: intent.isRefresh });
  } catch (err) {
    skip(`Error: ${err.message}`);
  }
}

async function main() {
  const data = await readStdinJson();
  if (!data) process.exit(0);

  const intent = classifyPrompt(data.prompt);
  if (!intent.hasTrigger) process.exit(0);

  // Finish-task is local + Notion-independent: it gates on the cached
  // .dev-context for the active branch, so handle it before the DATABASE_ID guard.
  if (intent.isFinishTask) {
    runFinishTask(getCurrentBranch());
    process.exit(0);
  }

  if (DATABASE_ID) {
    const currentBranch = getCurrentBranch();
    if (intent.isStartTask) await startTask(currentBranch, intent);
    else await injectContext(currentBranch, intent);
  } else {
    skip('NOTION_DATABASE_ID not set, skipping');
  }
  process.exit(0);
}

async function postExitPlanMode() {
  const data = await readStdinJson();
  if (data) runPostExitPlan(data, getCurrentBranch());
  process.exit(0);
}

function applyPickMode(argv) {
  const pageId = argv[3];
  if (!pageId) {
    process.stderr.write('[apply-pick] Usage: --apply-pick <pageId> [--from-not-started] [--no-switch] [--force]\n');
    process.exit(1);
  }
  if (!NOTION_TOKEN) {
    process.stderr.write('[apply-pick] NOTION_TOKEN not set\n');
    process.exit(1);
  }
  applyPickMain(NOTION_TOKEN, pageId, {
    force: argv.includes('--force'),
    fromNotStarted: argv.includes('--from-not-started'),
    noSwitch: argv.includes('--no-switch'),
  }).catch(err => {
    process.stderr.write(`[apply-pick] Error: ${err.message}\n`);
    process.exit(1);
  });
}

// The trigger lists are the hook's own vocabulary and are asserted by
// test/hooks-notion-task-inject.test.js; everything else a test needs is
// exported by the module that owns it.
module.exports = {
  TRIGGER_WORDS,
  START_TASK_TRIGGERS,
  FINISH_TASK_TRIGGERS,
  REFRESH_TRIGGERS,
  GRILL_MODIFIER_TRIGGERS,
  classifyPrompt,
};

if (require.main === module) {
  if (process.argv[2] === '--post-exit-plan') postExitPlanMode();
  else if (process.argv[2] === '--apply-pick') applyPickMode(process.argv);
  else main();
}
