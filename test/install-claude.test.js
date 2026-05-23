import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, cpSync } from 'node:fs';
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
  const lockEntries = await installClaude({ consumerCwd: consumer, config, artifacts });

  const ids = lockEntries.map((e) => e.id);
  assert.ok(ids.includes('universal-skill'), 'universal-skill should be installed');
  assert.ok(!ids.includes('notion-skill'), 'notion-skill should be excluded');
});

test('installs both skills when notion is enabled', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const lockEntries = await installClaude({ consumerCwd: consumer, config, artifacts });

  const ids = lockEntries.map((e) => e.id);
  assert.ok(ids.includes('universal-skill'));
  assert.ok(ids.includes('notion-skill'));
});

test('generated skill file contains rendered placeholder', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, config, artifacts });

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
  await installClaude({ consumerCwd: consumer, config, artifacts });

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
  await installClaude({ consumerCwd: consumer, config, artifacts });

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
  await installClaude({ consumerCwd: consumer, config, artifacts });

  const parsed = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8'));
  assert.deepEqual(parsed.permissions, { allow: ['Bash', 'Read'] });
});

test('lockfile is written with correct plugin version and target', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const lockEntries = await installClaude({ consumerCwd: consumer, config, artifacts });

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
  const lockEntries = await installClaude({ consumerCwd: consumer, config, artifacts });

  for (const entry of lockEntries) {
    assert.match(entry.checksum, /^sha256:[0-9a-f]{64}$/);
  }
});
