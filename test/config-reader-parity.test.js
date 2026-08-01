import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
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

const HOOKS_READER = join(PKG_ROOT, 'hooks', 'config-reader.js');
const SCRIPTS_READER = join(PKG_ROOT, 'scripts', 'notion', 'lib', 'config-reader.js');

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

test('the hook carries no scanner of its own', () => {
  const src = readFileSync(join(PKG_ROOT, 'hooks', 'notion-task-inject.js'), 'utf8');
  // `inSubsection` is the scanner's private state variable — its presence means
  // a second copy of the parser has come back.
  assert.equal(
    src.includes('inSubsection'),
    false,
    'hooks/notion-task-inject.js must require hooks/config-reader.js, not re-implement the scanner'
  );
  assert.match(src, /require\('\.\/config-reader\.js'\)/);
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
