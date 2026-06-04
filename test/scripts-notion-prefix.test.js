import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const require = createRequire(import.meta.url);

// scripts/notion/lib/project-prefix.js is CommonJS that calls process.cwd()
// to read the consumer's spovishun-skills.config.yaml. Each test runs in its
// own cwd + clean module cache so we can verify the env-var > config > default
// resolution chain without polluting state across cases.

function withSandbox(envOverrides, configBody, fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'prefix-test-'));
  if (configBody !== null) {
    writeFileSync(join(cwd, 'spovishun-skills.config.yaml'), configBody, 'utf8');
  }
  const oldCwd = process.cwd();
  const oldEnv = {};
  for (const k of Object.keys(envOverrides)) {
    oldEnv[k] = process.env[k];
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  process.chdir(cwd);

  // Force a fresh require so the module re-reads cwd/env on each test.
  const prefixPath = require.resolve(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'project-prefix.js'));
  const configPath = require.resolve(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'config-reader.js'));
  delete require.cache[prefixPath];
  delete require.cache[configPath];

  try {
    return fn(require(prefixPath));
  } finally {
    process.chdir(oldCwd);
    for (const [k, v] of Object.entries(oldEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('projectPrefix(): PROJECT_PREFIX env wins over config', () => {
  withSandbox(
    { PROJECT_PREFIX: 'envwinner' },
    'project:\n  name: "ConfigLoser"\n',
    ({ projectPrefix }) => assert.equal(projectPrefix(), 'envwinner')
  );
});

test('projectPrefix(): falls back to slugified project.name from config', () => {
  withSandbox(
    { PROJECT_PREFIX: undefined },
    'project:\n  name: "My Cool Project!"\n',
    ({ projectPrefix }) => assert.equal(projectPrefix(), 'my-cool-project')
  );
});

test('projectPrefix(): last-resort default is "project"', () => {
  withSandbox(
    { PROJECT_PREFIX: undefined },
    null, // no config file at all
    ({ projectPrefix }) => assert.equal(projectPrefix(), 'project')
  );
});

test('taskIdRegex(): matches "<prefix>-NNN" case-insensitively', () => {
  withSandbox(
    { PROJECT_PREFIX: 'myapp' },
    null,
    ({ taskIdRegex }) => {
      const re = taskIdRegex();
      assert.ok(re.test('myapp-42'));
      assert.ok(re.test('MYAPP-7'));
      assert.equal(re.test('other-1'), false);
      assert.equal(re.test('myapp42'), false, 'must require a dash');
    }
  );
});

test('deriveBranchFromName works with configured prefix (e2e via extract-branch.js)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'prefix-e2e-'));
  writeFileSync(join(cwd, 'spovishun-skills.config.yaml'), 'project:\n  name: "Acme Bot"\n', 'utf8');
  const oldCwd = process.cwd();
  const oldEnv = process.env.PROJECT_PREFIX;
  delete process.env.PROJECT_PREFIX;
  process.chdir(cwd);

  const root = join(PKG_ROOT, 'scripts', 'notion', 'lib');
  for (const m of ['project-prefix.js', 'config-reader.js', 'extract-branch.js', 'format-task.js']) {
    delete require.cache[require.resolve(join(root, m))];
  }
  try {
    const { deriveBranchFromName } = require(join(root, 'extract-branch.js'));
    assert.equal(
      deriveBranchFromName('feature/acme-bot-12: Wire ban command'),
      'feature/acme-bot-12-wire-ban-command'
    );
  } finally {
    process.chdir(oldCwd);
    if (oldEnv === undefined) delete process.env.PROJECT_PREFIX;
    else process.env.PROJECT_PREFIX = oldEnv;
  }
});
