import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config-loader.js';
import { validateConfig } from '../lib/config-validator.js';
import { ConfigError } from '../lib/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const fix = (name) => join(here, 'fixtures', name);

const baseNotionConfig = () => ({
  project: { name: 'P', language: 'uk' },
  stack: { kotlin: false, postgres: false, telegram: false, notion: true },
  git: { branch_prefix: 'feature/', main_branch: 'main', dev_branch: 'develop' },
  notion: {
    token_env: 'NOTION_TOKEN',
    database_id: '3193462f68a980d69ec9c7ccc6329b88',
    epics_database_id: 'd0c00200abc1234567890abcdef12345',
  },
});

test('happy: valid full config loads and returns all sections', () => {
  const cfg = loadConfig(fix('valid-full.yaml'));
  assert.equal(cfg.project.name, 'TestProject');
  assert.equal(cfg.project.language, 'uk');
  assert.equal(cfg.stack.notion, true);
  assert.equal(cfg.notion.token_env, 'NOTION_TOKEN');
  assert.equal(cfg.git.branch_prefix, 'feature/test');
  assert.equal(cfg.notion.categories.architecture, '33c3462f68a9819894a4df73c3b7d9fe');
});

test('happy: notion.categories with valid keys and IDs passes validation', () => {
  const cfg = baseNotionConfig();
  cfg.notion.categories = { features: '35f3462f68a981419511fb0ea80d1bb4' };
  assert.doesNotThrow(() => validateConfig(cfg));
});

test('fail: unknown notion.categories key is rejected', () => {
  const cfg = baseNotionConfig();
  cfg.notion.categories = { bogus: '35f3462f68a981419511fb0ea80d1bb4' };
  assert.throws(() => validateConfig(cfg), (err) => err instanceof ConfigError);
});

test('fail: malformed notion.categories ID is rejected', () => {
  const cfg = baseNotionConfig();
  cfg.notion.categories = { features: 'not-a-valid-id' };
  assert.throws(() => validateConfig(cfg), (err) => err instanceof ConfigError);
});

test('happy: stack.kmp with kotlin passes validation', () => {
  const cfg = baseNotionConfig();
  cfg.stack.kotlin = true;
  cfg.stack.kmp = true;
  assert.doesNotThrow(() => validateConfig(cfg));
});

test('fail: stack.kmp without stack.kotlin is rejected', () => {
  const cfg = baseNotionConfig();
  cfg.stack.kotlin = false;
  cfg.stack.kmp = true;
  assert.throws(() => validateConfig(cfg), (err) => err instanceof ConfigError);
});

test('happy: minimal config (all stack=false, no notion section) loads ok', () => {
  const cfg = loadConfig(fix('valid-minimal-no-notion.yaml'));
  assert.equal(cfg.project.name, 'MinimalProject');
  assert.equal(cfg.stack.notion, false);
  assert.equal(cfg.notion, undefined);
});

test('fail: missing project.name → MISSING_REQUIRED with actionable hint', () => {
  assert.throws(
    () => loadConfig(fix('invalid-missing-project-name.yaml')),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 'MISSING_REQUIRED');
      assert.ok(err.message.includes('project.name') || err.actionable.includes('project.name'), `Expected 'project.name' in error. Got: ${err.message} | ${err.actionable}`);
      return true;
    }
  );
});

test('fail: stack.notion=true but notion section missing → SCHEMA_VIOLATION or MISSING_REQUIRED', () => {
  assert.throws(
    () => loadConfig(fix('invalid-notion-required.yaml')),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.ok(
        err.code === 'SCHEMA_VIOLATION' || err.code === 'MISSING_REQUIRED',
        `Expected SCHEMA_VIOLATION or MISSING_REQUIRED, got ${err.code}`
      );
      assert.ok(
        err.actionable.includes('notion') || err.message.includes('notion'),
        `Expected 'notion' in error. Got: ${err.message} | ${err.actionable}`
      );
      return true;
    }
  );
});

test('fail: broken YAML syntax → INVALID_YAML with parser message', () => {
  assert.throws(
    () => loadConfig(fix('invalid-yaml-syntax.yaml')),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 'INVALID_YAML');
      assert.ok(err.message.length > 0);
      return true;
    }
  );
});

test('fail: non-existent file → MISSING_REQUIRED with init hint', () => {
  assert.throws(
    () => loadConfig(fix('does-not-exist.yaml')),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 'MISSING_REQUIRED');
      assert.ok(err.actionable.includes('init'));
      return true;
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Every missing key in one throw.
//
// validateConfig used to throw on the first Ajv `required` error even though
// Ajv had already collected them all, so a config with three absent git.* keys
// cost three sequential `install` runs to diagnose.
// ─────────────────────────────────────────────────────────────────────────────

const baseStack = { kotlin: true, postgres: false, telegram: false, notion: false };

test('all missing keys in one section are reported together', () => {
  assert.throws(
    () => validateConfig({ project: { name: 'X', language: 'uk' }, stack: baseStack, git: {} }),
    (err) => {
      assert.equal(err.code, 'MISSING_REQUIRED');
      for (const key of ['git.branch_prefix', 'git.main_branch', 'git.dev_branch']) {
        assert.ok(err.message.includes(key), `expected ${key} in: ${err.message}`);
      }
      return true;
    }
  );
});

test('missing keys across sections are grouped into one YAML block per section', () => {
  assert.throws(
    () => validateConfig({ project: {}, stack: baseStack, git: {} }),
    (err) => {
      assert.ok(err.message.includes('project.name'), err.message);
      assert.ok(err.message.includes('git.dev_branch'), err.message);
      // One header and one init line per report, not one per key.
      assert.equal((err.actionable.match(/Add under/g) ?? []).length, 2);
      assert.equal((err.actionable.match(/spovishun-skills init/g) ?? []).length, 1);
      return true;
    }
  );
});

test('a single missing key keeps the original one-line wording', () => {
  assert.throws(
    () => validateConfig({
      project: { name: 'X', language: 'uk' },
      stack: baseStack,
      git: { branch_prefix: 'f', main_branch: 'main' },
    }),
    (err) => {
      assert.equal(
        err.message,
        'Missing required key `git.dev_branch` in spovishun-skills.config.yaml.'
      );
      return true;
    }
  );
});

test('the reported path reads like the config file, without a leading slash', () => {
  // Ajv reports instancePath "/git" + missingProperty "main_branch"; naively
  // joining them produced `/git.main_branch`, which matches nothing a user can
  // search their config for.
  assert.throws(
    () => validateConfig({ project: { name: 'X', language: 'uk' }, stack: baseStack, git: { branch_prefix: 'f', dev_branch: 'd' } }),
    (err) => {
      assert.ok(err.message.includes('`git.main_branch`'), err.message);
      assert.ok(!err.message.includes('/git'), `path should not carry a slash: ${err.message}`);
      return true;
    }
  );
});
