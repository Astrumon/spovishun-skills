import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dump as dumpYaml } from 'js-yaml';
import { validateConfig } from '../lib/config-validator.js';
import { bootstrapNotion } from '../lib/notion-bootstrap.js';
import { generateFallbackPrompt } from '../lib/notion-fallback-prompt.js';

const CONFIG_FILENAME = 'spovishun-skills.config.yaml';

// Notion documentation categories consumed by notion-navigator / doc-updater.
const DOC_CATEGORIES = ['architecture', 'database', 'testing', 'cicd', 'features', 'aitools', 'epics'];

const CATEGORY_QUESTIONS = DOC_CATEGORIES.map((c) => ({
  type: 'input',
  name: `notion_category_${c}`,
  message: `Category page ID — ${c} (blank to skip):`,
  when: (a) => a.stack_notion && a.notion_configure_categories,
  validate: notionIdOptional,
}));

const QUESTIONS = [
  { type: 'input', name: 'project_name', message: 'Project name:', validate: (v) => v.trim() ? true : 'Required' },
  { type: 'list',  name: 'project_language', message: 'Default language:', choices: ['uk', 'en'], default: 'uk' },
  { type: 'confirm', name: 'stack_kotlin',   message: 'Stack: Kotlin?',   default: false },
  // Only offered for a Kotlin project — the schema rejects kmp without kotlin.
  { type: 'confirm', name: 'stack_kmp',      message: 'Stack: Kotlin Multiplatform / Compose Multiplatform?', default: false, when: (a) => a.stack_kotlin },
  { type: 'confirm', name: 'stack_postgres', message: 'Stack: PostgreSQL?', default: false },
  { type: 'confirm', name: 'stack_telegram', message: 'Stack: Telegram bot?', default: false },
  { type: 'confirm', name: 'stack_notion',   message: 'Stack: Notion integration?', default: false },
  { type: 'input', name: 'notion_token_env', message: 'Env var name for Notion token:', default: 'NOTION_TOKEN', when: (a) => a.stack_notion },
  { type: 'input', name: 'notion_database_id', message: 'Notion main database ID:', when: (a) => a.stack_notion, validate: notionIdOrEmpty },
  { type: 'input', name: 'notion_epics_database_id', message: 'Notion epics database ID:', when: (a) => a.stack_notion, validate: notionIdOrEmpty },
  { type: 'confirm', name: 'notion_configure_categories', message: 'Configure documentation category page IDs? (notion-navigator / doc-updater)', default: false, when: (a) => a.stack_notion },
  ...CATEGORY_QUESTIONS,
  { type: 'input', name: 'git_branch_prefix', message: 'Git branch prefix:', default: 'feature/' },
  { type: 'input', name: 'git_main_branch',   message: 'Main branch name:', default: 'main' },
  { type: 'input', name: 'git_dev_branch',    message: 'Dev branch name:', default: 'develop' },
];

function notionIdOrEmpty(v) {
  if (!v.trim()) return 'Required';
  return isNotionId(v.trim()) ? true : 'Must be a 32-char hex ID or UUID format';
}

function notionIdOptional(v) {
  if (!v.trim()) return true;
  return isNotionId(v.trim()) ? true : 'Must be a 32-char hex ID or UUID format';
}

function isNotionId(v) {
  return /^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function answersToConfig(a) {
  const config = {
    project: { name: a.project_name.trim(), language: a.project_language },
    stack: {
      kotlin: a.stack_kotlin,
      postgres: a.stack_postgres,
      telegram: a.stack_telegram,
      notion: a.stack_notion,
      kmp: a.stack_kmp === true,
    },
    git: {
      branch_prefix: a.git_branch_prefix.trim(),
      main_branch: a.git_main_branch.trim(),
      dev_branch: a.git_dev_branch.trim(),
    },
  };
  if (a.stack_notion) {
    config.notion = {
      token_env: a.notion_token_env.trim(),
      database_id: a.notion_database_id.trim(),
      epics_database_id: a.notion_epics_database_id.trim(),
    };
    const categories = {};
    for (const c of DOC_CATEGORIES) {
      const v = (a[`notion_category_${c}`] ?? '').trim();
      if (v) categories[c] = v;
    }
    if (Object.keys(categories).length > 0) config.notion.categories = categories;
  }
  return config;
}

/**
 * @param {object} opts
 * @param {string}   opts.cwd       — directory to write config into
 * @param {Function} opts.prompter  — async (questions) => answers  (inquirer-compatible)
 * @param {object}   [opts.out]     — writable stream for user-facing messages (default: process.stdout)
 */
export async function runInit({ cwd, prompter, out = process.stdout }) {
  const destPath = join(cwd, CONFIG_FILENAME);
  const write = (msg) => out.write(msg);

  if (existsSync(destPath)) {
    const { overwrite } = await prompter([
      { type: 'confirm', name: 'overwrite', message: `${CONFIG_FILENAME} already exists. Overwrite?`, default: false },
    ]);
    if (!overwrite) {
      write('Skipped — existing config left untouched.\n');
      return null;
    }
  }

  const answers = await prompter(QUESTIONS);
  const config = answersToConfig(answers);

  // Validate before writing — throws ConfigError if the wizard produced invalid data
  validateConfig(config);

  const header =
    '# spovishun-skills.config.yaml\n' +
    '# Generated by `npx spovishun-skills init`\n' +
    '# Edit this file to customize skill installation.\n\n';
  const yamlContent = header + dumpYaml(config, { lineWidth: 100 });

  writeFileSync(destPath, yamlContent, 'utf8');
  write(`Created ${destPath}\n`);

  if (config.stack?.notion) {
    await runNotionBootstrap({ cwd, config, write });
  }

  return destPath;
}

/**
 * Variant A: attempt Notion REST API bootstrap.
 * Variant C (fallback): write NOTION_SETUP.md with manual instructions + MCP prompt.
 */
async function runNotionBootstrap({ cwd, config, write }) {
  const tokenEnv = config.notion?.token_env ?? 'NOTION_TOKEN';
  const token = process.env[tokenEnv];
  const taskBoardId = config.notion?.database_id;
  const parentPageId = config.notion?.root_page_id;

  if (!token || !taskBoardId || !parentPageId) {
    write(`Notion bootstrap skipped — ${tokenEnv}, database_id, or root_page_id not available.\n`);
    writeFallbackDoc(cwd, { taskBoardId, parentPageId, tokenEnv, epicsDbId: null, write });
    return;
  }

  write('Bootstrapping Notion workspace...\n');
  let epicsDbId = null;
  try {
    const result = await bootstrapNotion({ token, parentPageId, taskBoardId });
    epicsDbId = result.epicsDbId;
    write(`Notion workspace ready — Epics DB: ${epicsDbId}\n`);
    write(`Add this to your config:\n  notion:\n    epics_database_id: "${epicsDbId}"\n`);
  } catch (err) {
    write(`Notion bootstrap failed: ${err.message}\n`);
    write('Writing NOTION_SETUP.md with manual instructions...\n');
    writeFallbackDoc(cwd, { taskBoardId, parentPageId, tokenEnv, epicsDbId, write });
  }
}

function writeFallbackDoc(cwd, { taskBoardId, parentPageId, tokenEnv, epicsDbId, write }) {
  const content = generateFallbackPrompt({ taskBoardId, parentPageId, tokenEnv, epicsDbId });
  const setupPath = join(cwd, 'NOTION_SETUP.md');
  writeFileSync(setupPath, content, 'utf8');
  write(`NOTION_SETUP.md written — follow instructions inside to complete Notion setup.\n`);
}
