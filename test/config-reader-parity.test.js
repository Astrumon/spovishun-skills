import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadConfig } from '../lib/config-loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const require = createRequire(import.meta.url);

// spovishun-skills.config.yaml used to be read by three independent parsers.
// Two of them were hand-written line scanners that had already drifted apart —
// only one stripped the UTF-8 BOM, so the same file answered differently
// depending on who asked. These tests pin the collapse: exactly one scanner
// implementation, reachable under both module ids, agreeing with js-yaml.

const HOOKS_DIR = join(PKG_ROOT, 'hooks');
const HOOKS_READER = join(HOOKS_DIR, 'config-reader.js');
const SCRIPTS_READER = join(PKG_ROOT, 'scripts', 'notion', 'lib', 'config-reader.js');

const hookFiles = () => readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.js'));

const BOM = '﻿';
const CONFIG_BODY = `project:
  name: "Spovishun"
  language: "uk"
stack:
  kotlin: true
  postgres: true
  telegram: true
  notion: true
git:
  branch_prefix: "feature/spovishun"
  main_branch: "main"
  dev_branch: "develop"
notion:
  token_env: "NOTION_TOKEN"
  database_id: "36f3462f68a981328625d728cac86ea3"
  epics_database_id: "36f3462f68a9819e8f3ee3b8c2a5f0d1"
  picker:
    stage_filter: "Sprint"
`;

// Runs `fn` with cwd pointed at a throwaway dir holding the given config text.
// Both readers resolve the config from process.cwd() on every call, so the
// module cache does not have to be cleared between cases.
function withConfig(configText, fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'config-parity-'));
  const configPath = join(cwd, 'spovishun-skills.config.yaml');
  if (configText !== null) writeFileSync(configPath, configText, 'utf8');
  const oldCwd = process.cwd();
  process.chdir(cwd);
  try {
    return fn({ cwd, configPath });
  } finally {
    process.chdir(oldCwd);
  }
}

test('hooks/ and scripts/ readers are literally the same module', () => {
  assert.equal(
    require(HOOKS_READER),
    require(SCRIPTS_READER),
    'scripts/notion/lib/config-reader.js must re-export hooks/config-reader.js, not re-implement it'
  );
});

test('a BOM-prefixed config reads identically through every parser', () => {
  withConfig(BOM + CONFIG_BODY, ({ configPath }) => {
    const hooksReader = require(HOOKS_READER);
    const scriptsReader = require(SCRIPTS_READER);

    assert.equal(hooksReader.readConfigValue('project', 'name'), 'Spovishun');
    assert.equal(scriptsReader.readConfigValue('project', 'name'), 'Spovishun');
    assert.equal(loadConfig(configPath).project.name, 'Spovishun');

    // 2-level dotted lookups must survive the BOM too.
    assert.equal(hooksReader.readConfigValue('notion', 'picker.stage_filter'), 'Sprint');
    assert.equal(loadConfig(configPath).notion.picker.stage_filter, 'Sprint');
  });
});

test('a BOM-prefixed config yields the same PROJECT_PREFIX slug as a clean one', () => {
  const prefix = (text) => withConfig(text, () => {
    const { readConfigValue, slugify } = require(HOOKS_READER);
    return slugify(readConfigValue('project', 'name'));
  });
  assert.equal(prefix(BOM + CONFIG_BODY), 'spovishun');
  assert.equal(prefix(BOM + CONFIG_BODY), prefix(CONFIG_BODY));
});

test('no module under hooks/ carries a scanner of its own', () => {
  // `inSubsection` is the scanner's private state variable — its presence
  // anywhere but config-reader.js means a second copy of the parser has come
  // back. The whole directory is scanned, not just the entry hook: that hook was
  // decomposed into a dozen modules and a copy could reappear in any of them.
  for (const file of hookFiles()) {
    if (file === 'config-reader.js') continue;
    assert.equal(
      readFileSync(join(HOOKS_DIR, file), 'utf8').includes('inSubsection'),
      false,
      `hooks/${file} must require hooks/config-reader.js, not re-implement the scanner`
    );
  }
  assert.match(
    readFileSync(join(HOOKS_DIR, 'hook-config.js'), 'utf8'),
    /require\('\.\/config-reader\.js'\)/,
    "hook-config.js is the hook tree's only reader of the consumer config"
  );
});

// The invariant the spovishun-166 umbrella got wrong, now enforced.
// installHooks() copies hooks/ unconditionally while installScripts() skips
// scripts/notion/ when stack.notion=false — so a hook requiring out of scripts/
// is a guaranteed MODULE_NOT_FOUND for every consumer without Notion.
test('nothing under hooks/ requires out of scripts/', () => {
  for (const file of hookFiles()) {
    assert.equal(
      /require\(\s*['"][^'"]*\/scripts\//.test(readFileSync(join(HOOKS_DIR, file), 'utf8')),
      false,
      `hooks/${file} requires into scripts/ — scripts may depend on hooks, never the reverse`
    );
  }
});

// The reverse direction is the supported one, and these are the pairs that went
// through the collapse. Module identity is what proves a re-export, not a copy.
test('scripts/notion/lib re-exports resolve to the very modules under hooks/', () => {
  for (const name of ['config-reader.js', 'page-id.js', 'block-tree.js']) {
    assert.equal(
      require(join(PKG_ROOT, 'scripts', 'notion', 'lib', name)),
      require(join(HOOKS_DIR, name)),
      `scripts/notion/lib/${name} must re-export hooks/${name}, not re-implement it`
    );
  }
});

// notion-render.js could not follow that pattern: the two call sites bind the
// engine with different options, keep differently-shaped `richText` helpers, and
// only the hook side has `visibleBlocks` — so neither module can be a bare
// re-export. The shared factory is what has to be one object.
test('both block renderers are bound from the very same createRenderer', () => {
  assert.equal(
    require(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'format-task.js')).createRenderer,
    require(join(HOOKS_DIR, 'notion-blocks.js')).createRenderer,
    'format-task.js and notion-blocks.js must bind hooks/notion-render.js, not re-implement it'
  );
  assert.equal(
    require(join(HOOKS_DIR, 'notion-blocks.js')).createRenderer,
    require(join(HOOKS_DIR, 'notion-render.js')).createRenderer
  );
});

test('shared Notion constants have exactly one declaration', () => {
  const shared = require(join(HOOKS_DIR, 'notion-constants.js'));
  const queryTasks = require(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'query-tasks.js'));
  const constants = require(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'constants.js'));

  // Same array INSTANCE, not a deep-equal copy — that is the difference between
  // a re-export and the "MUST stay in sync" comment this replaced.
  assert.equal(queryTasks.PRIORITY_TIERS, shared.PRIORITY_TIERS);
  assert.equal(queryTasks.PICKER_TIER_LIMIT, shared.PICKER_TIER_LIMIT);
  assert.equal(constants.NOTION_VERSION, shared.NOTION_VERSION);
});

test('configExists() distinguishes "no config" from "unreadable key"', () => {
  withConfig(null, () => {
    assert.equal(require(HOOKS_READER).configExists(), false);
  });
  withConfig(CONFIG_BODY, () => {
    assert.equal(require(HOOKS_READER).configExists(), true);
  });
});

test('readConfigValueOrWarn stays silent when the config is simply absent', () => {
  withConfig(null, () => {
    const lines = [];
    const value = require(HOOKS_READER).readConfigValueOrWarn('project', 'name', {
      fallback: 'project',
      label: 'test',
      stream: { write: (s) => lines.push(s) },
    });
    assert.equal(value, 'project');
    assert.deepEqual(lines, [], 'a missing config is a legitimate state, not an error');
  });
});

test('readConfigValueOrWarn shouts when the config exists but the key does not', () => {
  withConfig('project:\n  language: "uk"\n', () => {
    const lines = [];
    const value = require(HOOKS_READER).readConfigValueOrWarn('project', 'name', {
      fallback: 'project',
      label: 'test',
      stream: { write: (s) => lines.push(s) },
    });
    assert.equal(value, 'project');
    assert.equal(lines.length, 1, 'a broken config must never degrade silently');
    assert.match(lines[0], /\[test\]/);
    assert.match(lines[0], /project\.name/);
    assert.match(lines[0], /spovishun-skills\.config\.yaml/);
  });
});

test('readConfigValueOrWarn returns the real value without warning', () => {
  withConfig(CONFIG_BODY, () => {
    const lines = [];
    const value = require(HOOKS_READER).readConfigValueOrWarn('git', 'dev_branch', {
      fallback: 'develop',
      label: 'test',
      stream: { write: (s) => lines.push(s) },
    });
    assert.equal(value, 'develop');
    assert.deepEqual(lines, []);
  });
});
