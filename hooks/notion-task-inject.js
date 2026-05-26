#!/usr/bin/env node
/**
 * Triple-mode hook:
 *
 * 1. UserPromptSubmit — injects active Notion task context into the prompt.
 *    On START_TASK_TRIGGERS: shows an interactive task picker directive for Claude
 *    to present via AskUserQuestion.
 *    Other triggers: cache-first context injection.
 *
 * 2. PostToolUse (ExitPlanMode) — auto-saves the approved plan.
 *    Invoked as: node notion-task-inject.js --post-exit-plan
 *
 * 3. CLI apply-pick — applies a task selection (creates branch, writes context).
 *    Invoked as: node notion-task-inject.js --apply-pick <pageId> [flags]
 *    Flags: --from-not-started  move task from Not started → To do first
 *           --no-switch         create branch without git checkout (2nd+ parallel task)
 *           --force             bypass git conflict check
 *    Called by Claude after user picks task(s) via AskUserQuestion.
 *    Exits 1 on error so Claude can surface it; all other modes exit 0.
 *
 * Configuration. Env vars take precedence; otherwise resolved from the consumer's
 * spovishun-skills.config.yaml (so a plain `install` works without extra env setup):
 *   NOTION_TOKEN or NOTION_SKILLS_TOKEN  — Notion API token (required; from env/.env)
 *   NOTION_BOARD_COLLECTION_ID  ⟵ notion.database_id   — task board database ID (required)
 *   PROJECT_PREFIX              ⟵ slug(project.name)    — branch prefix → feature/<prefix>-N
 *   GIT_DEVELOP_BRANCH          ⟵ git.dev_branch        — base branch name, default "develop"
 *
 * State files (in consumer project, under .dev-context/):
 *   .dev-context/{branch}_prd/branch.txt      — exact branch name
 *   .dev-context/{branch}_prd/context.md      — cached task text from Notion
 *   .dev-context/{branch}_prd/plan.md         — approved plan (auto-saved on ExitPlanMode)
 *   .dev-context/{branch}_prd/session.lock    — "{ppid}:{timestamp}" dedup guard
 *   .dev-context/selected-tasks.json          — active tasks shared across Claude instances
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

// ─── Configuration ─────────────────────────────────────────────────────────────

function loadEnv() {
  const envFile = path.join(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

loadEnv();

// Minimal one-level-nested scalar reader for spovishun-skills.config.yaml — avoids a
// js-yaml dependency in the standalone hook. Returns '' when the section/key is absent.
function readConfigValue(section, key) {
  const configFile = path.join(process.cwd(), 'spovishun-skills.config.yaml');
  if (!fs.existsSync(configFile)) return '';
  const lines = fs.readFileSync(configFile, 'utf8').split('\n');
  let inSection = false;
  for (const line of lines) {
    if (/^[A-Za-z0-9_]+:/.test(line)) inSection = line.startsWith(`${section}:`);
    else if (inSection) {
      const m = line.match(/^\s+([A-Za-z0-9_]+):\s*(.+?)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const NOTION_TOKEN = process.env.NOTION_SKILLS_TOKEN || process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_BOARD_COLLECTION_ID || readConfigValue('notion', 'database_id');
const PROJECT_PREFIX = process.env.PROJECT_PREFIX || slug(readConfigValue('project', 'name')) || 'project';
const DEVELOP_BRANCH = process.env.GIT_DEVELOP_BRANCH || readConfigValue('git', 'dev_branch') || 'develop';

const DEV_CONTEXT_DIR = '.dev-context';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SELECTED_TASKS_FILE = '.dev-context/selected-tasks.json';
const SELECTED_TASKS_VERSION = 1;
const PICKER_TIER_LIMIT = 5;

const TRIGGER_WORDS = ['implement', 'refactor', 'реалізуй', 'розроби', 'задача', 'таск', 'фіча'];
const START_TASK_TRIGGERS = ['start new task', 'почати нову задачу', 'беру нову задачу'];
const REFRESH_TRIGGERS = ['reread task', 'update task context', 'оновити контекст задачі', 'перечитати задачу'];

// ─── Notion HTTP ───────────────────────────────────────────────────────────────

function notionRequest(token, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Rich text helpers ─────────────────────────────────────────────────────────

function richText(blocks) {
  return (blocks || []).map(b => b.plain_text || '').join('');
}

function blockToMd(block) {
  const t = block.type;
  if (!block[t]) return '';
  const rt = block[t].rich_text || [];
  const text = richText(rt);
  if (t === 'heading_1') return `# ${text}`;
  if (t === 'heading_2') return `## ${text}`;
  if (t === 'heading_3') return `### ${text}`;
  if (t === 'bulleted_list_item') return `- ${text}`;
  if (t === 'numbered_list_item') return `1. ${text}`;
  if (t === 'to_do') return `- [${block[t].checked ? 'x' : ' '}] ${text}`;
  if (t === 'code') return `\`\`\`\n${text}\n\`\`\``;
  if (t === 'divider') return '---';
  if (t === 'paragraph') return text;
  return text;
}

function extractBlocks(blocks) {
  return blocks.map(blockToMd).filter(Boolean).join('\n');
}

// ─── Branch helpers ────────────────────────────────────────────────────────────

function extractTaskNumber(name) {
  const m = name.match(/[/-](\d+)[:-]/);
  return m ? m[1] : null;
}

function extractBranchFromBlocks(blocks) {
  for (const b of blocks) {
    if (b.type !== 'paragraph') continue;
    const text = richText(b.paragraph?.rich_text || []);
    const m = text.match(/feature\/[\w-]+-\d+[\w-]*/);
    if (m) return m[0];
  }
  return null;
}

function deriveBranchFromName(name) {
  const num = extractTaskNumber(name);
  if (!num) return null;
  const slug = name
    .replace(/^feature\/[\w-]+-\d+[:\s-]*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `feature/${PROJECT_PREFIX}-${num}-${slug}`;
}

function toDashed(id) {
  if (id.includes('-')) return id;
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

// ─── Git helpers ───────────────────────────────────────────────────────────────

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { stdio: 'pipe' }).toString().trim();
  } catch { return null; }
}

function gitSetupBranch(branch) {
  try {
    execSync(`git rev-parse --verify "${branch}"`, { stdio: 'pipe' });
    execSync(`git checkout "${branch}"`, { stdio: 'pipe' });
    return { ok: true, message: `Switched to existing branch: ${branch}` };
  } catch {
    try {
      execSync(`git checkout ${DEVELOP_BRANCH}`, { stdio: 'pipe' });
      execSync(`git pull origin ${DEVELOP_BRANCH}`, { stdio: 'pipe' });
      execSync(`git checkout -b "${branch}"`, { stdio: 'pipe' });
      return { ok: true, message: `Created and switched to: ${branch}` };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
}

function gitCreateBranchOnly(branch) {
  try {
    execSync(`git rev-parse --verify "${branch}"`, { stdio: 'pipe' });
    return { ok: true, message: `Branch already exists: ${branch}` };
  } catch {
    try {
      execSync(`git fetch origin ${DEVELOP_BRANCH} --quiet`, { stdio: 'pipe' });
    } catch { /* no remote */ }
    try {
      execSync(`git branch "${branch}" ${DEVELOP_BRANCH}`, { stdio: 'pipe' });
      return { ok: true, message: `Created branch (no checkout): ${branch}` };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
}

function conflictCheck(newBranch, existingTasks, force) {
  const getDiff = branch => {
    try {
      const count = parseInt(
        execSync(`git rev-list ${DEVELOP_BRANCH}..${branch} --count`, { stdio: 'pipe' }).toString().trim(), 10
      );
      if (isNaN(count) || count === 0) return null;
      const out = execSync(`git diff --name-only ${DEVELOP_BRANCH}...${branch}`, { stdio: 'pipe' }).toString();
      return new Set(out.split('\n').filter(Boolean));
    } catch { return null; }
  };

  const newFiles = getDiff(newBranch);
  const disclaimer = existingTasks.length > 0
    ? 'DISCLAIMER: Parallel tasks active; run each in a separate Claude Code instance.'
    : '';

  if (!newFiles) return { conflict: false, disclaimer };

  for (const task of existingTasks) {
    if (task.branch === newBranch) continue;
    const otherFiles = getDiff(task.branch);
    if (!otherFiles) continue;
    const intersection = [...newFiles].filter(f => otherFiles.has(f));
    if (intersection.length > 0 && !force) {
      return {
        conflict: true,
        msg: `CONFLICT: overlapping files between ${newBranch} and ${task.branch}: [${intersection.join(', ')}]. Retry with --force to bypass.`,
        disclaimer
      };
    }
  }
  return { conflict: false, disclaimer };
}

// ─── Dev context folder ────────────────────────────────────────────────────────

function branchToFolderName(branch) {
  return branch.replace(/\//g, '-') + '_prd';
}

function getContextDir(branch) {
  return path.join(process.cwd(), DEV_CONTEXT_DIR, branchToFolderName(branch));
}

function isCurrentSession(lockFile) {
  try {
    const content = fs.readFileSync(lockFile, 'utf8').trim();
    const [pidStr, tsStr] = content.split(':');
    const pid = parseInt(pidStr, 10);
    const ts = parseInt(tsStr, 10);
    if (Date.now() - ts > SESSION_TTL_MS) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function writeSessionLock(lockFile) {
  const pid = process.ppid || process.pid;
  fs.writeFileSync(lockFile, `${pid}:${Date.now()}`, 'utf8');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Selected tasks state ──────────────────────────────────────────────────────

function loadSelectedTasks() {
  const filePath = path.join(process.cwd(), SELECTED_TASKS_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch { return []; }
}

function saveSelectedTasks(tasks) {
  const filePath = path.join(process.cwd(), SELECTED_TASKS_FILE);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify({ version: SELECTED_TASKS_VERSION, tasks }, null, 2), 'utf8');
}

// ─── Task Picker ───────────────────────────────────────────────────────────────

async function queryByPriorityTier(token, status) {
  const priorities = ['High', 'Medium', 'Low', 'Normal'];
  for (const priority of priorities) {
    const result = await notionRequest(token, 'POST', `/v1/databases/${DATABASE_ID}/query`, {
      filter: {
        and: [
          { property: 'Status', status: { equals: status } },
          { property: 'Priority', select: { equals: priority } },
        ]
      },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: PICKER_TIER_LIMIT,
    });
    const candidates = result?.results || [];
    if (candidates.length > 0) return { candidates, tier: priority };
  }
  // Fallback: any priority
  const result = await notionRequest(token, 'POST', `/v1/databases/${DATABASE_ID}/query`, {
    filter: { property: 'Status', status: { equals: status } },
    sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    page_size: PICKER_TIER_LIMIT,
  });
  return { candidates: result?.results || [], tier: null };
}

async function runPicker(token, currentBranch, isForce) {
  let selectedTasks = loadSelectedTasks();

  // Validate active tasks
  if (selectedTasks.length > 0) {
    for (const task of selectedTasks) {
      const page = await notionRequest(token, 'GET', `/v1/pages/${task.pageId}`, null);
      const status = page?.properties?.Status?.status?.name;
      if (!['To do', 'In progress'].includes(status)) {
        saveSelectedTasks([]);
        selectedTasks = [];
        break;
      }
    }
  }

  // Resume from cache if on active task branch
  if (currentBranch && currentBranch !== DEVELOP_BRANCH && currentBranch !== 'main') {
    const activeEntry = selectedTasks.find(t => t.branch === currentBranch);
    if (activeEntry) {
      const ctxDir = getContextDir(currentBranch);
      const contextFile = path.join(ctxDir, 'context.md');
      if (fs.existsSync(contextFile)) {
        await notionRequest(token, 'PATCH', `/v1/pages/${activeEntry.pageId}`, {
          properties: { Status: { status: { name: 'In progress' } } }
        }).catch(() => {});
        const context = fs.readFileSync(contextFile, 'utf8');
        const planFile = path.join(ctxDir, 'plan.md');
        const plan = fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf8') : null;
        writeSessionLock(path.join(ctxDir, 'session.lock'));
        outputPrompt(buildSystemPrompt(context, plan, '\n**Git:** Already on active task branch — skipping checkout', true));
        return;
      }
    }
  }

  const selectedPageIds = new Set(selectedTasks.map(t => t.pageId));
  let source = 'toDo';
  let { candidates, tier } = await queryByPriorityTier(token, 'To do');
  candidates = candidates.filter(p => !selectedPageIds.has(p.id.replace(/-/g, '')));

  if (candidates.length === 0) {
    source = 'notStarted';
    ({ candidates, tier } = await queryByPriorityTier(token, 'Not started'));
    candidates = candidates.filter(p => !selectedPageIds.has(p.id.replace(/-/g, '')));
  }

  const inProgressResult = await notionRequest(token, 'POST', `/v1/databases/${DATABASE_ID}/query`, {
    filter: { property: 'Status', status: { equals: 'In progress' } },
    page_size: PICKER_TIER_LIMIT,
  });
  const orphanedInProgress = (inProgressResult?.results || []).filter(
    p => !selectedPageIds.has(p.id.replace(/-/g, ''))
  );

  if (candidates.length === 0 && orphanedInProgress.length === 0) {
    outputPrompt(buildSystemPrompt(
      '## No Tasks Available\n\nNo "To do", "Not started", or untracked "In progress" tasks found.',
      null, null, false
    ));
    return;
  }

  const toOption = page => {
    const name = (page.properties?.Name?.title || []).map(t => t.plain_text).join('') || 'Unknown';
    const taskNum = extractTaskNumber(name) || '?';
    const priority = page.properties?.Priority?.select?.name || 'Normal';
    const pageId = page.id.replace(/-/g, '');
    const displayName = name.replace(new RegExp(`^feature\\/${PROJECT_PREFIX}-\\d+[:\\s-]*`, 'i'), '').trim();
    return { taskNum, name, displayName, priority, pageId };
  };

  const orphanedOptions = orphanedInProgress.map(p => ({ ...toOption(p), orphaned: true }));
  const todoOptions = candidates.map(p => ({ ...toOption(p), tier, orphaned: false }));
  const options = [...orphanedOptions, ...todoOptions];

  const parallelNote = selectedTasks.length > 0
    ? `\n${selectedTasks.length} task(s) currently active. Adding more = parallel execution across Claude Code instances.`
    : '';
  const sourceNote = source === 'notStarted'
    ? '\n> No "To do" tasks found — showing "Not started". Selected tasks will be moved to "To do" automatically.'
    : '';
  const orphanedNote = orphanedOptions.length > 0
    ? '\n> Untracked "In progress" tasks found — listed first for recovery.'
    : '';

  const applyFlags = [
    source === 'notStarted' ? '--from-not-started' : '',
    isForce ? '--force' : '',
  ].filter(Boolean).join(' ');
  const applyFlagsSuffix = applyFlags ? ` ${applyFlags}` : '';

  const optionLines = options.map((o, i) => {
    const tag = o.orphaned ? ' *(In progress — untracked)*' : ` *(Priority: ${o.priority})*`;
    return `${i + 1}. **${PROJECT_PREFIX}-${o.taskNum}** — ${o.displayName}${tag}\n   pageId: \`${o.pageId}\``;
  }).join('\n');

  if (options.length === 1) {
    const o = options[0];
    outputPrompt(`## Task Picker\n${parallelNote}${sourceNote}${orphanedNote}\n\n**Available tasks**:\n${optionLines}\n\n---\n### REQUIRED NEXT ACTIONS (execute in order):\n1. Only one task available — apply automatically without asking the user.\n2. Run Bash: \`node .claude/hooks/notion-task-inject.js --apply-pick ${o.pageId}${applyFlagsSuffix}\`\n   If stderr starts with \`CONFLICT:\` → show user the conflicting files, ask: retry with \`--force\` or skip?\n3. Briefly confirm: task name and branch.\n4. Immediately invoke the \`notion-task-to-code\` skill with pageId \`${o.pageId}\` to load task context and enter Plan Mode.`);
    return;
  }

  const aqOptions = options.map(o => {
    const label = o.orphaned
      ? `${PROJECT_PREFIX}-${o.taskNum} — ${o.displayName} (resume)`
      : `${PROJECT_PREFIX}-${o.taskNum} — ${o.displayName}`;
    return `     {label: "${label}", value: "${o.pageId}"}`;
  }).join(',\n');

  outputPrompt(`## Task Picker\n${parallelNote}${sourceNote}${orphanedNote}\n\n**Available tasks**:\n${optionLines}\n\n---\n### REQUIRED NEXT ACTIONS (execute in order):\n1. Call \`AskUserQuestion\`:\n   \`\`\`\n   question: "Select tasks to start working on (multiple selection allowed):"\n   multiSelect: true\n   options: [\n${aqOptions},\n     {label: "Cancel", value: "cancel"}\n   ]\n   \`\`\`\n2. If user picked **"Cancel"** → inform user, stop.\n3. For **each** selected pageId — run Bash sequentially:\n   - 1st task:  \`node .claude/hooks/notion-task-inject.js --apply-pick <pageId>${applyFlagsSuffix}\`\n   - 2nd+ task: \`node .claude/hooks/notion-task-inject.js --apply-pick <pageId>${applyFlagsSuffix} --no-switch\`\n   If stderr starts with \`CONFLICT:\` → show user the conflicting files, ask: retry with \`--force\` or skip?\n4. After all applies — if ≥2 tasks selected → show the DISCLAIMER line from stdout.\n5. Briefly confirm: task name(s), branch(es), total active parallel tasks count.\n6. Immediately invoke the \`notion-task-to-code\` skill with the first selected pageId to load task context and enter Plan Mode.`);
}

// ─── Apply Pick ────────────────────────────────────────────────────────────────

async function applyPickMain(token, pageId, { force, fromNotStarted, noSwitch }) {
  const notionPageId = toDashed(pageId);
  const page = await notionRequest(token, 'GET', `/v1/pages/${notionPageId}`, null);
  if (!page || page.object === 'error') {
    process.stderr.write(`[apply-pick] Failed to fetch page ${pageId}: ${JSON.stringify(page)}\n`);
    process.exit(1);
  }

  const name = (page.properties?.Name?.title || []).map(t => t.plain_text).join('') || 'Unknown';
  const status = page.properties?.Status?.status?.name;
  const cleanPageId = page.id.replace(/-/g, '');

  if (fromNotStarted) {
    const patch = await notionRequest(token, 'PATCH', `/v1/pages/${page.id}`, {
      properties: { Status: { status: { name: 'To do' } } }
    });
    if (patch?.object === 'error') {
      process.stderr.write(`[apply-pick] Failed to update status: ${JSON.stringify(patch)}\n`);
      process.exit(1);
    }
  } else if (!['To do', 'In progress'].includes(status)) {
    process.stderr.write(`[apply-pick] Task status is "${status}", expected "To do" or "In progress"\n`);
    process.exit(1);
  }

  const blocksResult = await notionRequest(token, 'GET', `/v1/blocks/${cleanPageId}/children?page_size=100`, null);
  const allBlocks = blocksResult?.results || [];

  let taskBranch = extractBranchFromBlocks(allBlocks);
  if (!taskBranch) taskBranch = deriveBranchFromName(name);
  if (!taskBranch) {
    process.stderr.write(`[apply-pick] Cannot derive branch name from task: "${name}"\n`);
    process.exit(1);
  }

  const taskNumber = extractTaskNumber(name);
  const selectedTasks = loadSelectedTasks();
  const otherTasks = selectedTasks.filter(t => t.pageId !== cleanPageId);
  const check = conflictCheck(taskBranch, otherTasks, force);
  if (check.conflict) {
    process.stderr.write(check.msg + '\n');
    process.exit(1);
  }

  const gitResult = noSwitch ? gitCreateBranchOnly(taskBranch) : gitSetupBranch(taskBranch);

  const content = extractBlocks(allBlocks.filter(b => b.type !== 'toggle'));
  const ctxDir = getContextDir(taskBranch);
  ensureDir(ctxDir);
  fs.writeFileSync(path.join(ctxDir, 'context.md'), `## Active Task (Notion)\n**${name}**\n\n${content}`, 'utf8');
  fs.writeFileSync(path.join(ctxDir, 'branch.txt'), taskBranch, 'utf8');
  fs.writeFileSync(path.join(ctxDir, 'task.json'), JSON.stringify({
    id: page.id, title: name, status: 'In progress', branch: taskBranch,
    priority: page.properties?.Priority?.select?.name ?? null,
    content: extractBlocks(allBlocks),
  }), 'utf8');
  writeSessionLock(path.join(ctxDir, 'session.lock'));

  await notionRequest(token, 'PATCH', `/v1/pages/${page.id}`, {
    properties: { Status: { status: { name: 'In progress' } } }
  });

  const updated = selectedTasks.filter(t => t.pageId !== cleanPageId);
  updated.push({ pageId: cleanPageId, taskNumber, name, branch: taskBranch, addedAt: Date.now(), status: 'In progress' });
  saveSelectedTasks(updated);

  if (check.disclaimer) process.stdout.write(check.disclaimer + '\n');
  process.stdout.write(`OK: ${PROJECT_PREFIX}-${taskNumber} activated on ${taskBranch}\n`);
  if (!gitResult.ok) process.stderr.write(`[apply-pick] Git warning: ${gitResult.message}\n`);
}

// ─── PostToolUse: ExitPlanMode ─────────────────────────────────────────────────

async function runPostExitPlan() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;

  let data;
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const planContent = data?.tool_input?.plan;
  if (!planContent) process.exit(0);

  const branch = getCurrentBranch();
  if (!branch || branch === DEVELOP_BRANCH || branch === 'main') process.exit(0);

  const ctxDir = getContextDir(branch);
  ensureDir(ctxDir);
  fs.writeFileSync(path.join(ctxDir, 'plan.md'), planContent, 'utf8');
  const lockFile = path.join(ctxDir, 'session.lock');
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  process.stderr.write(`[notion-task-inject] plan saved → .dev-context/${branchToFolderName(branch)}/plan.md\n`);
  process.exit(0);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;

  let data;
  try { data = JSON.parse(raw); } catch { process.exit(0); }

  const prompt = (data.prompt || '').toLowerCase();
  const isStartTask = START_TASK_TRIGGERS.some(t => prompt.includes(t));
  const isRefresh = REFRESH_TRIGGERS.some(t => prompt.includes(t));
  const isForce = prompt.includes('--force');
  const hasTrigger = isStartTask || isRefresh || TRIGGER_WORDS.some(w => prompt.includes(w));

  if (!hasTrigger) process.exit(0);

  if (!DATABASE_ID) {
    process.stderr.write('[notion-task-inject] NOTION_BOARD_COLLECTION_ID not set, skipping\n');
    process.exit(0);
  }

  const currentBranch = getCurrentBranch();

  if (isStartTask) {
    if (!NOTION_TOKEN) {
      process.stderr.write('[notion-task-inject] NOTION_TOKEN not set, skipping picker\n');
      process.exit(0);
    }
    try {
      await runPicker(NOTION_TOKEN, currentBranch, isForce);
    } catch (err) {
      process.stderr.write(`[notion-task-inject] Picker error: ${err.message}\n`);
    }
    process.exit(0);
  }

  // Cache-first injection
  if (!isRefresh && currentBranch && currentBranch !== DEVELOP_BRANCH && currentBranch !== 'main') {
    const ctxDir = getContextDir(currentBranch);
    const contextFile = path.join(ctxDir, 'context.md');
    const lockFile = path.join(ctxDir, 'session.lock');

    if (fs.existsSync(contextFile)) {
      if (isCurrentSession(lockFile)) process.exit(0);
      const context = fs.readFileSync(contextFile, 'utf8');
      const planFile = path.join(ctxDir, 'plan.md');
      const plan = fs.existsSync(planFile) ? fs.readFileSync(planFile, 'utf8') : null;
      writeSessionLock(lockFile);
      outputPrompt(buildSystemPrompt(context, plan, null, false));
      process.exit(0);
    }
  }

  // Fetch from Notion
  if (!NOTION_TOKEN) {
    process.stderr.write('[notion-task-inject] NOTION_TOKEN not set, skipping\n');
    process.exit(0);
  }

  try {
    const queryResult = await notionRequest(NOTION_TOKEN, 'POST', `/v1/databases/${DATABASE_ID}/query`, {
      filter: {
        or: [
          { property: 'Status', status: { equals: 'To do' } },
          { property: 'Status', status: { equals: 'In progress' } },
        ]
      },
      page_size: 1,
    });

    const page = queryResult?.results?.[0];
    if (!page) process.exit(0);

    const name = (page.properties?.Name?.title || []).map(t => t.plain_text).join('') || 'Unknown';
    const pageId = page.id.replace(/-/g, '');

    const blocksResult = await notionRequest(NOTION_TOKEN, 'GET', `/v1/blocks/${pageId}/children?page_size=100`, null);
    const allBlocks = blocksResult?.results || [];
    const content = extractBlocks(allBlocks.filter(b => b.type !== 'toggle'));

    let taskBranch = extractBranchFromBlocks(allBlocks);
    if (!taskBranch) taskBranch = deriveBranchFromName(name);

    const cacheBranch = currentBranch && currentBranch !== DEVELOP_BRANCH && currentBranch !== 'main'
      ? currentBranch
      : taskBranch;

    if (cacheBranch) {
      const ctxDir = getContextDir(cacheBranch);
      ensureDir(ctxDir);
      const contextMd = `## Active Task (Notion)\n**${name}**\n\n${content}`;
      fs.writeFileSync(path.join(ctxDir, 'context.md'), contextMd, 'utf8');
      fs.writeFileSync(path.join(ctxDir, 'branch.txt'), cacheBranch, 'utf8');
      fs.writeFileSync(path.join(ctxDir, 'task.json'), JSON.stringify({
        id: page.id, title: name,
        status: page.properties?.Status?.status?.name ?? null,
        branch: taskBranch,
        priority: page.properties?.Priority?.select?.name ?? null,
        content: extractBlocks(allBlocks),
      }), 'utf8');
      writeSessionLock(path.join(ctxDir, 'session.lock'));
    }

    let branchNote = '';
    if (isRefresh) {
      branchNote = '\n> Context refreshed from Notion.';
    } else if (currentBranch && taskBranch && currentBranch !== taskBranch) {
      branchNote = `\n> Current branch: \`${currentBranch}\`. Task branch: \`${taskBranch}\`. Use "start new task" to switch.`;
    }

    let plan = null;
    if (isRefresh && cacheBranch) {
      const planFile = path.join(getContextDir(cacheBranch), 'plan.md');
      if (fs.existsSync(planFile)) plan = fs.readFileSync(planFile, 'utf8');
    }

    const contextText = `## Active Task (Notion)\n**${name}**\n\n${content}`;
    outputPrompt(buildSystemPrompt(contextText, plan, branchNote, false));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[notion-task-inject] Error: ${err.message}\n`);
    process.exit(0);
  }
}

function buildSystemPrompt(context, plan, branchNote, isStartTask) {
  const parts = [context];
  if (plan) parts.push(`\n---\n## Approved Plan\n${plan}`);
  if (branchNote) parts.push(branchNote);
  parts.push('\n---');

  let instruction;
  if (isStartTask && plan) {
    instruction = 'Plan already approved. Proceed directly with implementation — do NOT enter plan mode again.';
  } else if (isStartTask) {
    instruction = 'IMPORTANT: You MUST call the EnterPlanMode tool immediately before doing anything else.';
  } else {
    instruction = '*Work within the scope of this task. Do not go beyond what is described.*';
  }

  parts.push(instruction);
  return parts.join('\n');
}

function outputPrompt(systemPrompt) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: systemPrompt,
    }
  }));
}

// ─── Entry point ───────────────────────────────────────────────────────────────

if (process.argv[2] === '--post-exit-plan') {
  runPostExitPlan();
} else if (process.argv[2] === '--apply-pick') {
  const pageId = process.argv[3];
  if (!pageId) {
    process.stderr.write('[apply-pick] Usage: --apply-pick <pageId> [--from-not-started] [--no-switch] [--force]\n');
    process.exit(1);
  }
  if (!NOTION_TOKEN) {
    process.stderr.write('[apply-pick] NOTION_TOKEN not set\n');
    process.exit(1);
  }
  applyPickMain(NOTION_TOKEN, pageId, {
    force: process.argv.includes('--force'),
    fromNotStarted: process.argv.includes('--from-not-started'),
    noSwitch: process.argv.includes('--no-switch'),
  }).catch(err => {
    process.stderr.write(`[apply-pick] Error: ${err.message}\n`);
    process.exit(1);
  });
} else {
  main();
}
