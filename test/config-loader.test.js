import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config-loader.js';
import { ConfigError } from '../lib/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const fix = (name) => join(here, 'fixtures', name);

test('happy: valid full config loads and returns all sections', () => {
  const cfg = loadConfig(fix('valid-full.yaml'));
  assert.equal(cfg.project.name, 'TestProject');
  assert.equal(cfg.project.language, 'uk');
  assert.equal(cfg.stack.notion, true);
  assert.equal(cfg.notion.token_env, 'NOTION_TOKEN');
  assert.equal(cfg.git.branch_prefix, 'feature/test');
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
