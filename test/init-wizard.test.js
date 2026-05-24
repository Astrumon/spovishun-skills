import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { runInit } from '../bin/init.js';

// Answers that include a root_page_id to trigger bootstrap attempt
const notionWithPageAnswers = {
  project_name: 'BootstrapProject',
  project_language: 'en',
  stack_kotlin: false,
  stack_postgres: false,
  stack_telegram: false,
  stack_notion: true,
  notion_token_env: 'NOTION_TOKEN',
  notion_database_id: 'aabbccdd1122334455667788aabbccdd',
  notion_epics_database_id: 'eeff00112233445566778899eeff0011',
  git_branch_prefix: 'feature/bp',
  git_main_branch: 'main',
  git_dev_branch: 'develop',
};

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'spovishun-init-'));
}

function silentOut() {
  return { write: () => {} };
}

const happyAnswers = {
  project_name: 'TestProject',
  project_language: 'uk',
  stack_kotlin: false,
  stack_postgres: false,
  stack_telegram: false,
  stack_notion: false,
  git_branch_prefix: 'feature/test',
  git_main_branch: 'main',
  git_dev_branch: 'develop',
};

const notionAnswers = {
  ...happyAnswers,
  stack_notion: true,
  notion_token_env: 'NOTION_TOKEN',
  notion_database_id: 'aabbccdd1122334455667788aabbccdd',
  notion_epics_database_id: 'eeff00112233445566778899eeff0011',
};

function makePrompter(answers) {
  return async (questions) => {
    const filtered = {};
    for (const q of questions) {
      const shouldInclude = typeof q.when === 'function' ? q.when(answers) : true;
      if (shouldInclude && q.name in answers) {
        filtered[q.name] = answers[q.name];
      }
    }
    return filtered;
  };
}

test('happy path: writes valid config.yaml to cwd', async () => {
  const cwd = makeTmpDir();
  const dest = await runInit({ cwd, prompter: makePrompter(happyAnswers), out: silentOut() });

  assert.ok(dest, 'Should return the file path');
  assert.ok(existsSync(dest), 'Config file should exist');

  const content = readFileSync(dest, 'utf8');
  const parsed = parseYaml(content);
  assert.equal(parsed.project.name, 'TestProject');
  assert.equal(parsed.project.language, 'uk');
  assert.equal(parsed.stack.notion, false);
  assert.equal(parsed.notion, undefined);
  assert.equal(parsed.git.branch_prefix, 'feature/test');
});

test('notion enabled: config includes notion section', async () => {
  const cwd = makeTmpDir();
  await runInit({ cwd, prompter: makePrompter(notionAnswers), out: silentOut() });

  const content = readFileSync(join(cwd, 'spovishun-skills.config.yaml'), 'utf8');
  const parsed = parseYaml(content);
  assert.equal(parsed.stack.notion, true);
  assert.equal(parsed.notion.token_env, 'NOTION_TOKEN');
  assert.equal(parsed.notion.database_id, 'aabbccdd1122334455667788aabbccdd');
});

test('overwrite=false: skips write, existing file untouched', async () => {
  const cwd = makeTmpDir();
  const dest = join(cwd, 'spovishun-skills.config.yaml');
  writeFileSync(dest, 'existing: true\n', 'utf8');

  let overwritePrompted = false;
  const prompter = async (questions) => {
    const hasOverwrite = questions.some((q) => q.name === 'overwrite');
    if (hasOverwrite) {
      overwritePrompted = true;
      return { overwrite: false };
    }
    return makePrompter(happyAnswers)(questions);
  };

  const result = await runInit({ cwd, prompter, out: silentOut() });

  assert.equal(result, null, 'Should return null when skipped');
  assert.ok(overwritePrompted, 'Should have asked about overwrite');
  const content = readFileSync(dest, 'utf8');
  assert.ok(content.includes('existing: true'), 'File should remain unchanged');
});

test('overwrite=true: overwrites existing file', async () => {
  const cwd = makeTmpDir();
  const dest = join(cwd, 'spovishun-skills.config.yaml');
  writeFileSync(dest, 'old: content\n', 'utf8');

  const prompter = async (questions) => {
    const hasOverwrite = questions.some((q) => q.name === 'overwrite');
    if (hasOverwrite) return { overwrite: true };
    return makePrompter(happyAnswers)(questions);
  };

  const result = await runInit({ cwd, prompter, out: silentOut() });

  assert.ok(result, 'Should return the file path');
  const content = readFileSync(dest, 'utf8');
  assert.ok(!content.includes('old: content'), 'Old content should be gone');
  assert.ok(content.includes('TestProject'), 'New content should be present');
});

test('generated file has header comment', async () => {
  const cwd = makeTmpDir();
  const dest = await runInit({ cwd, prompter: makePrompter(happyAnswers), out: silentOut() });
  const content = readFileSync(dest, 'utf8');
  assert.ok(content.startsWith('#'), 'File should start with a comment header');
  assert.ok(content.includes('npx spovishun-skills init'), 'Header should mention the init command');
});

test('notion: NOTION_SETUP.md written when token env var is not set', async () => {
  const cwd = makeTmpDir();
  // Ensure env var is absent
  const saved = process.env.NOTION_TOKEN;
  delete process.env.NOTION_TOKEN;

  try {
    await runInit({ cwd, prompter: makePrompter(notionWithPageAnswers), out: silentOut() });
    const setupPath = join(cwd, 'NOTION_SETUP.md');
    assert.ok(existsSync(setupPath), 'NOTION_SETUP.md should be written when token is missing');
    const content = readFileSync(setupPath, 'utf8');
    assert.ok(content.includes('Notion Setup'), 'File should contain setup instructions');
    assert.ok(content.includes('Claude Code prompt'), 'File should include MCP fallback prompt');
  } finally {
    if (saved !== undefined) process.env.NOTION_TOKEN = saved;
  }
});
