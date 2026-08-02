'use strict';

// Everything hooks/notion-task-inject.js needs to know about its environment:
// the .env file, the Notion token, and the four config-derived scalars that
// drive the board query and the branch names.
//
// Lives under hooks/ for the same reason config-reader.js does — installHooks()
// ships hooks/ unconditionally while scripts/notion/ is gated on stack.notion,
// so a hook may never require out of scripts/. Dependency-free for the same
// reason: consumers get .claude/ without a node_modules.
//
// Every constant here resolves at REQUIRE time, exactly as the single-file hook
// did. loadEnv() therefore runs at the top of this module rather than in the
// entry point: whichever module is required first, the .env values are in
// process.env before the first readConfigValueOrWarn call. Tests that vary the
// env or cwd must clear this module from the require cache, not just the entry
// hook — see purgeHookModules() in test/helpers/hook-harness.js.

const fs = require('fs');
const path = require('path');
const { readConfigValue, readConfigValueOrWarn, slugify } = require('./config-reader.js');

const HOOK_LABEL = 'notion-task-inject';

function loadEnv() {
  const envFile = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) return;
  // split on /\r?\n/ so CRLF .env files (Windows) parse — a trailing \r would
  // otherwise break the `$` anchor below (JS `.` does not match \r).
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

loadEnv();

// Token precedence is NOTION_TOKEN first, then NOTION_SKILLS_TOKEN — matching the
// hook's header doc, scripts/notion/* error messages, and
// scripts/notion/lib/load-token.js. `source` names the env var that supplied the
// token so auth errors can point at a stale value (a bogus NOTION_SKILLS_TOKEN no
// longer silently shadows a working .env NOTION_TOKEN).
function resolveToken() {
  if (process.env.NOTION_TOKEN) return { token: process.env.NOTION_TOKEN, source: 'NOTION_TOKEN' };
  if (process.env.NOTION_SKILLS_TOKEN) return { token: process.env.NOTION_SKILLS_TOKEN, source: 'NOTION_SKILLS_TOKEN' };
  return { token: null, source: null };
}

const { token: NOTION_TOKEN, source: TOKEN_SOURCE } = resolveToken();

// `notion:` is absent by design when stack.notion=false, so a missing
// database_id is correct there — only demand one when the stack claims Notion.
function notionStackEnabled() {
  return readConfigValue('stack', 'notion') === 'true';
}

// Every config-sourced constant below resolves through readConfigValueOrWarn:
// a value that cannot be read out of a config file that is sitting right there
// is a broken config, and the placeholder it degrades to is silently wrong (a
// bad PROJECT_PREFIX makes the hook query the board for tasks that do not exist
// and report "no tasks" instead of an error). The warning goes to stderr and the
// hook still exits 0 — it must never brick a session.
//
// NOTION_BOARD_COLLECTION_ID is the deprecated 1.2.0/1.2.1 alias — it was always
// a misnomer (the hook queries /v1/databases/{id}/query, not a data source).
// Keep accepting it so existing consumer .env files keep working.
const DATABASE_ID = process.env.NOTION_DATABASE_ID
  || process.env.NOTION_BOARD_COLLECTION_ID
  || (notionStackEnabled()
    ? readConfigValueOrWarn('notion', 'database_id', { fallback: '', label: HOOK_LABEL })
    : readConfigValue('notion', 'database_id'));

// slugify('project') === 'project', so the fallback survives slugification
// intact; the trailing || guards a name that slugifies to nothing ("!!!").
const PROJECT_PREFIX = process.env.PROJECT_PREFIX
  || slugify(readConfigValueOrWarn('project', 'name', { fallback: 'project', label: HOOK_LABEL }))
  || 'project';

const DEVELOP_BRANCH = process.env.GIT_DEVELOP_BRANCH
  || readConfigValueOrWarn('git', 'dev_branch', { fallback: 'develop', label: HOOK_LABEL });

// Board v2 (Scrum) optional Stage select filter. Empty string = unset = no filter
// (Board v1) — a legitimate value, so this one resolves without warning.
const STAGE_FILTER = process.env.NOTION_PICKER_STAGE_FILTER || readConfigValue('notion', 'picker.stage_filter');

// $CLAUDE_PROJECT_DIR is injected by the harness ONLY into hook subprocesses (like
// this one) — never into the agent's Bash tool shell, where it expands empty. Command
// templates we print for the AGENT to run must therefore carry a concrete fallback.
// Read the resolved root from our own env (set here) and emit it via bash ${VAR:-default}
// so the line honors the var if ever set and falls back to the absolute path otherwise.
// Forward slashes keep Git Bash on Windows from mapping a bare leading "/" to the Git
// install root.
const HOOK_DIR =
  '${CLAUDE_PROJECT_DIR:-' +
  (process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/\\/g, '/') +
  '}/.claude/hooks';

function stageFilterClause() {
  if (!STAGE_FILTER) return null;
  return { property: 'Stage', select: { equals: STAGE_FILTER } };
}

/** AND-combines the configured Stage clause into any board filter. */
function withStageFilter(baseFilter) {
  const stage = stageFilterClause();
  if (!stage) return baseFilter;
  if (baseFilter && Array.isArray(baseFilter.and)) {
    return { and: [...baseFilter.and, stage] };
  }
  return { and: [baseFilter, stage] };
}

/** True for the branches that never carry a task context. */
function isBaseBranch(branch) {
  return !branch || branch === DEVELOP_BRANCH || branch === 'main';
}

module.exports = {
  HOOK_LABEL,
  loadEnv,
  resolveToken,
  NOTION_TOKEN,
  TOKEN_SOURCE,
  notionStackEnabled,
  DATABASE_ID,
  PROJECT_PREFIX,
  DEVELOP_BRANCH,
  STAGE_FILTER,
  HOOK_DIR,
  stageFilterClause,
  withStageFilter,
  isBaseBranch,
};
