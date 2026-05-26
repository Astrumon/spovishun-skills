import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { installClaude } from '../adapters/claude/index.js';
import { writeLockfile, readLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_SOURCE = join(here, 'fixtures', 'source');
const PKG_ROOT = join(here, '..');
const FIXED_NOW = () => new Date('2025-06-01T12:00:00.000Z');

function makeConsumerDir() {
  return mkdtempSync(join(tmpdir(), 'install-claude-'));
}

function copyConfig(consumerDir, configName) {
  const src = join(here, 'fixtures', configName);
  const dest = join(consumerDir, 'spovishun-skills.config.yaml');
  cpSync(src, dest);
  return dest;
}

test('installs universal skill for no-notion config', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const ids = lockEntries.map((e) => e.id);
  assert.ok(ids.includes('universal-skill'), 'universal-skill should be installed');
  assert.ok(!ids.includes('notion-skill'), 'notion-skill should be excluded');
});

test('installs both skills when notion is enabled', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const ids = lockEntries.map((e) => e.id);
  assert.ok(ids.includes('universal-skill'));
  assert.ok(ids.includes('notion-skill'));
});

test('generated skill file contains rendered placeholder', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const skillPath = join(consumer, '.claude', 'skills', 'universal-skill.md');
  assert.ok(existsSync(skillPath), '.claude/skills/universal-skill.md should exist');
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('FixtureProject'), 'PROJECT_NAME placeholder should be substituted');
  assert.ok(!content.includes('{{PROJECT_NAME}}'), 'raw placeholder should not remain');
});

test('notion skill has database ID rendered', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const skillPath = join(consumer, '.claude', 'skills', 'notion-skill.md');
  assert.ok(existsSync(skillPath));
  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('3193462f68a980d69ec9c7ccc6329b88'));
  assert.ok(!content.includes('{{NOTION_DATABASE_ID}}'));
});

test('settings.json is written with valid JSON', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const settingsPath = join(consumer, '.claude', 'settings.json');
  assert.ok(existsSync(settingsPath));
  const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.ok(typeof parsed === 'object');
});

test('settings.json preserves existing user permissions on re-install', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  const settingsDir = join(consumer, '.claude');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    join(settingsDir, 'settings.json'),
    JSON.stringify({ permissions: { allow: ['Bash', 'Read'] } }),
    'utf8'
  );

  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const parsed = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8'));
  assert.deepEqual(parsed.permissions, { allow: ['Bash', 'Read'] });
});

test('lockfile is written with correct plugin version and target', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const pkgVersion = JSON.parse(
    readFileSync(join(here, '..', 'package.json'), 'utf8')
  ).version;
  const lockPath = join(consumer, LOCKFILE_NAME);
  writeLockfile(lockPath, { pluginVersion: pkgVersion, target: 'claude', artifacts: lockEntries, now: FIXED_NOW });

  const data = readLockfile(lockPath);
  assert.equal(data.target, 'claude');
  assert.equal(data.pluginVersion, pkgVersion);
  assert.ok(Array.isArray(data.artifacts));
  assert.ok(data.artifacts.length > 0);
});

test('each lockfile entry has checksum with sha256: prefix', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  for (const entry of lockEntries) {
    assert.match(entry.checksum, /^sha256:[0-9a-f]{64}$/);
  }
});

test('hook scripts are copied to .claude/hooks/', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const hooksDir = join(consumer, '.claude', 'hooks');
  assert.ok(existsSync(hooksDir), '.claude/hooks/ should exist');
  assert.ok(existsSync(join(hooksDir, 'session-start.js')), 'session-start.js should be installed');
  assert.ok(existsSync(join(hooksDir, 'session-end.js')), 'session-end.js should be installed');
  assert.ok(existsSync(join(hooksDir, 'capture-learning.js')), 'capture-learning.js should be installed');
  assert.ok(existsSync(join(hooksDir, 'precompact-backup.js')), 'precompact-backup.js should be installed');
  assert.ok(existsSync(join(hooksDir, 'notion-task-inject.js')), 'notion-task-inject.js should be installed');
});

test('hooks.json events are merged into settings.json', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const settingsPath = join(consumer, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.ok(settings.hooks, 'settings.json should have a hooks section');
  assert.ok(Array.isArray(settings.hooks.Stop), 'Stop hook should be registered');
  assert.ok(Array.isArray(settings.hooks.SessionStart), 'SessionStart hook should be registered');
  assert.ok(Array.isArray(settings.hooks.UserPromptSubmit), 'UserPromptSubmit hook should be registered');
  assert.ok(Array.isArray(settings.hooks.PreCompact), 'PreCompact hook should be registered');
  assert.ok(Array.isArray(settings.hooks.PostToolUse), 'PostToolUse hook should be registered');
});

test('hooks settings entries are tagged with _spovishun for idempotent re-install', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const settingsPath = join(consumer, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  assert.equal(settings.hooks.Stop.length, 1, 'Stop hook should appear exactly once after re-install');
  assert.equal(settings.hooks.SessionStart.length, 1, 'SessionStart hook should appear exactly once after re-install');
});

test('rule files are rendered into .claude/rules/ preserving subdirectory structure', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const rulesDir = join(consumer, '.claude', 'rules');
  assert.ok(existsSync(rulesDir), '.claude/rules/ should exist');
  assert.ok(existsSync(join(rulesDir, 'common', 'design-principles.md')));
  assert.ok(existsSync(join(rulesDir, 'common', 'git-workflow.md')));
  assert.ok(existsSync(join(rulesDir, 'common', 'security.md')));
  assert.ok(existsSync(join(rulesDir, 'common', 'testing.md')));
  assert.ok(existsSync(join(rulesDir, 'common', 'feature-documentation.md')));
  assert.ok(existsSync(join(rulesDir, 'kotlin', 'kotlin-style.md')));
});

test('rule placeholders are rendered from config (not copied verbatim)', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml'); // branch_prefix "feature/", dev_branch "develop"
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const gitWorkflow = readFileSync(join(consumer, '.claude', 'rules', 'common', 'git-workflow.md'), 'utf8');
  assert.ok(!gitWorkflow.includes('{{'), 'no unrendered Mustache placeholders should remain in a rule');
  assert.ok(gitWorkflow.includes('feature/'), 'GIT_BRANCH_PREFIX should be substituted into the branch-naming rule');
  assert.ok(gitWorkflow.includes('always from `develop`'), 'GIT_DEV_BRANCH should be substituted');
});
