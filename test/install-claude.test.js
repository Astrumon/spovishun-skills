import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { installClaude } from '../adapters/claude/index.js';
import { writeLockfile, readLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';
import { sha256 } from '../lib/checksum.js';
import { stripMarker, hasMarker } from '../lib/marker.js';

const require = createRequire(import.meta.url);
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

  const skillPath = join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md');
  assert.ok(existsSync(skillPath), '.claude/skills/universal-skill/SKILL.md should exist');
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

  const skillPath = join(consumer, '.claude', 'skills', 'notion-skill', 'SKILL.md');
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
  // notion-task-inject.js is dispatch only — it require()s a dozen siblings, and
  // every one of them has to land next to it. This consumer has
  // stack.notion: false, so .claude/scripts/notion/ is absent: anything the hook
  // needs that did NOT ship here is a MODULE_NOT_FOUND on their first prompt.
  // (installHooks() copies hooks/*.js flat, which is exactly why the hook's
  // modules live flat in hooks/ rather than in a hooks/lib/ subdirectory.)
  for (const name of readdirSync(join(PKG_ROOT, 'hooks')).filter((f) => f.endsWith('.js'))) {
    assert.ok(existsSync(join(hooksDir, name)), `hooks/${name} should be installed`);
  }
  assert.equal(
    existsSync(join(consumer, '.claude', 'scripts', 'notion')),
    false,
    'stack.notion: false must not deliver the notion scripts'
  );
});

// The proof that the flat layout actually works: load the installed entry hook
// out of a tree that has no scripts/ and no node_modules at all.
test('the installed hook resolves every one of its requires with no scripts/ present', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const oldCwd = process.cwd();
  process.chdir(consumer);
  try {
    const installed = require(join(consumer, '.claude', 'hooks', 'notion-task-inject.js'));
    assert.ok(Array.isArray(installed.FINISH_TASK_TRIGGERS));
    assert.equal(installed.classifyPrompt('start new task').isStartTask, true);
  } finally {
    process.chdir(oldCwd);
  }
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

test('hook commands are anchored on $CLAUDE_PROJECT_DIR so they resolve regardless of cwd', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const settings = JSON.parse(readFileSync(join(consumer, '.claude', 'settings.json'), 'utf8'));

  // Walk every registered hook command from every event.
  const allCommands = [];
  for (const event of Object.keys(settings.hooks)) {
    for (const matcher of settings.hooks[event]) {
      for (const h of matcher.hooks ?? []) {
        if (h.type === 'command') allCommands.push(h.command);
      }
    }
  }

  assert.ok(allCommands.length >= 5, 'expected at least 5 plugin hook commands across all events');
  for (const cmd of allCommands) {
    assert.match(
      cmd,
      /\$CLAUDE_PROJECT_DIR[\\/]\.claude[\\/]hooks[\\/]/,
      `hook command must anchor on $CLAUDE_PROJECT_DIR — got: ${cmd}`
    );
    // The bare `node .claude/hooks/` form would break when the Claude Code
    // hook process runs with cwd != project root (e.g. user switched repos
    // in the same session). It must not survive into the rendered settings.
    assert.equal(
      /\bnode\s+\.claude[\\/]hooks[\\/]/.test(cmd),
      false,
      `hook command must not use the bare relative form — got: ${cmd}`
    );
  }
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
  // This fixture is kotlin: false — flag-named rule groups are gated, common/ is not.
  assert.ok(!existsSync(join(rulesDir, 'kotlin')), 'kotlin/ rules must not install without stack.kotlin');
  assert.ok(!existsSync(join(rulesDir, 'kmp')), 'kmp/ rules must not install without stack.kmp');
});

test('flag-named rule groups install when their stack flag is active', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-kmp.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const rulesDir = join(consumer, '.claude', 'rules');
  assert.ok(existsSync(join(rulesDir, 'common', 'design-principles.md')), 'common/ still ships');
  assert.ok(existsSync(join(rulesDir, 'kotlin', 'kotlin-style.md')), 'stack.kotlin enables kotlin/');

  // The whole kmp/ group must land, not just the file that happened to exist
  // when this test was written — a rule added without an install path is invisible.
  const kmpRules = [
    'architecture.md',
    'component-architecture.md',
    'feature-structure.md',
    'localization.md',
    'modularization.md',
    'navigation.md',
    'networking.md',
    'persistence.md',
    'testing.md',
    'uikit.md',
  ];
  for (const rule of kmpRules) {
    assert.ok(existsSync(join(rulesDir, 'kmp', rule)), `stack.kmp should install kmp/${rule}`);
  }
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

test('skill supporting files (references/, assets/) are installed under the skill folder', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { Buffer } = await import('node:buffer');
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  // Build a tmp fixture with a supporting-files skill.
  const tmpPkg = mkdtempSync(join(tmpdir(), 'multi-file-pkg-'));
  const skillDir = join(tmpPkg, 'skills', 'multi-file');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'manifest.yaml'),
    'id: multi-file\nversion: "1.0.0"\ncategory: universal\ndescription: Multi-file skill test fixture.\n',
    'utf8'
  );
  writeFileSync(join(skillDir, 'SKILL.md'), '# Multi-file\nProject: {{PROJECT_NAME}}\n', 'utf8');
  mkdirSync(join(skillDir, 'references'), { recursive: true });
  writeFileSync(join(skillDir, 'references', 'guide.md'), '# Guide\n{{PROJECT_NAME}} guide.\n', 'utf8');
  mkdirSync(join(skillDir, 'assets'), { recursive: true });
  writeFileSync(join(skillDir, 'assets', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(tmpPkg);
  await installClaude({ consumerCwd: consumer, pkgRoot: tmpPkg, config, artifacts, warn: { write: () => {} } });

  const base = join(consumer, '.claude', 'skills', 'multi-file');
  assert.ok(existsSync(join(base, 'SKILL.md')), 'SKILL.md should exist');
  assert.ok(existsSync(join(base, 'references', 'guide.md')), 'references/guide.md should exist');
  assert.ok(existsSync(join(base, 'assets', 'logo.png')), 'assets/logo.png should exist');

  const guide = readFileSync(join(base, 'references', 'guide.md'), 'utf8');
  assert.ok(guide.includes('FixtureProject'), 'text supporting files must be Mustache-rendered');

  const png = readFileSync(join(base, 'assets', 'logo.png'));
  assert.equal(png[0], 0x89, 'binary asset must be copied verbatim');
  assert.equal(png[1], 0x50, 'binary asset must be copied verbatim');
});

test('reinstall removes legacy flat .md files for plugin-known artifact ids', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  // Simulate a pre-v1.2.0 install: flat file whose id matches a current artifact.
  const skillsDir = join(consumer, '.claude', 'skills');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(join(skillsDir, 'universal-skill.md'), 'old flat content', 'utf8');

  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts, warn: { write: () => {} } });

  assert.ok(!existsSync(join(skillsDir, 'universal-skill.md')), 'legacy flat file should be removed');
  assert.ok(existsSync(join(skillsDir, 'universal-skill', 'SKILL.md')), 'new folder layout should be in place');
});

test('reinstall preserves user-authored flat .md files the plugin never installed', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  // A user's own file in .claude/skills/ — its id is in neither the artifact
  // set nor the lockfile, so the legacy-cleanup pass must leave it alone.
  const skillsDir = join(consumer, '.claude', 'skills');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(join(skillsDir, 'my-notes.md'), 'user content — not ours to delete', 'utf8');

  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts, warn: { write: () => {} } });

  assert.ok(existsSync(join(skillsDir, 'my-notes.md')), 'user flat file must survive install');
});

test('installs template kind into .claude/_templates/{id}/TEMPLATE.md', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  const tmpPkg = mkdtempSync(join(tmpdir(), 'template-pkg-'));
  const tDir = join(tmpPkg, 'templates', 'sample');
  mkdirSync(tDir, { recursive: true });
  writeFileSync(
    join(tDir, 'manifest.yaml'),
    'id: sample\nversion: "1.0.0"\ncategory: universal\ndescription: Sample template fixture.\n',
    'utf8'
  );
  writeFileSync(join(tDir, 'TEMPLATE.md'), '# {{PROJECT_NAME}} template\n', 'utf8');

  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(tmpPkg);
  await installClaude({ consumerCwd: consumer, pkgRoot: tmpPkg, config, artifacts, warn: { write: () => {} } });

  const tpath = join(consumer, '.claude', '_templates', 'sample', 'TEMPLATE.md');
  assert.ok(existsSync(tpath), 'TEMPLATE.md should exist under _templates/sample/');
  const body = readFileSync(tpath, 'utf8');
  assert.ok(body.includes('FixtureProject template'), 'template Mustache must render');
});

test('manifest-only skill gets synthesized YAML frontmatter with name + description', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const skillPath = join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md');
  const content = readFileSync(skillPath, 'utf8');

  assert.ok(content.startsWith('---\n'), 'file should start with a frontmatter fence');
  const fmEnd = content.indexOf('\n---', 4);
  assert.ok(fmEnd !== -1, 'frontmatter should be closed by a second fence');
  const fmBlock = content.slice(0, fmEnd + 4);

  assert.match(fmBlock, /\nname: universal-skill\b/, 'name should match the manifest id');
  const descMatch = fmBlock.match(/\ndescription: (.+)/);
  assert.ok(descMatch, 'description line should be present');
  assert.ok(descMatch[1].trim().length > 0, 'description must be non-empty');
  assert.match(fmBlock, /Triggers:/, 'composed description should append a Triggers: clause');
});

test('skill with inline frontmatter is not double-wrapped', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const skillPath = join(consumer, '.claude', 'skills', 'inline-frontmatter-skill', 'SKILL.md');
  const content = readFileSync(skillPath, 'utf8');

  // Exactly one opening fence + exactly one closing fence == one block.
  const fenceCount = (content.match(/^---$/gm) ?? []).length;
  assert.equal(fenceCount, 2, 'inline-frontmatter skill must keep exactly one fenced block');
  assert.ok(
    content.includes('Hand-authored description'),
    'original inline description must be preserved verbatim'
  );
});

test('agent body is written verbatim — no skill-style frontmatter added', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const agentPath = join(consumer, '.claude', 'agents', 'fixture-agent', 'AGENT.md');
  const installed = readFileSync(agentPath, 'utf8');
  // The fixture agent already ships with its own frontmatter that includes
  // `tools:` and `model:` — Claude-specific keys the synthesizer never emits.
  assert.match(installed, /^---\n/, 'agent file should still start with its own frontmatter');
  assert.match(installed, /\ntools: /, 'agent tools: line must be preserved');
  assert.match(installed, /\nmodel: /, 'agent model: line must be preserved');
  const fenceCount = (installed.match(/^---$/gm) ?? []).length;
  assert.equal(fenceCount, 2, 'agent must keep exactly its own single fenced block');
});

test('reinstall removes stale artifact folder when lockfile entry disappears from filtered set', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-notion.yaml');

  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifactsAll = loadArtifacts(FIXTURES_SOURCE);

  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts: artifactsAll });
  const pkgVersion = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;
  writeLockfile(join(consumer, LOCKFILE_NAME), { pluginVersion: pkgVersion, target: 'claude', artifacts: lockEntries, now: FIXED_NOW });

  assert.ok(existsSync(join(consumer, '.claude', 'skills', 'notion-skill', 'SKILL.md')));

  // Drop notion-skill from the artifact list (e.g. removed from upstream)
  const filtered = artifactsAll.filter((a) => a.id !== 'notion-skill');
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts: filtered, warn: { write: () => {} } });

  assert.ok(!existsSync(join(consumer, '.claude', 'skills', 'notion-skill')), 'stale folder should be removed');
});

// ─────────────────────────────────────────────────────────────────────────────
// Ownership model
// ─────────────────────────────────────────────────────────────────────────────

const SKILL_PATH = (consumer, id) => join(consumer, '.claude', 'skills', id, 'SKILL.md');
const AGENT_PATH = (consumer, id) => join(consumer, '.claude', 'agents', id, 'AGENT.md');

function captureWarn() {
  const lines = [];
  return { write: (m) => lines.push(m), text: () => lines.join('') };
}

async function freshInstall(consumer, configName = 'install-config-no-notion.yaml') {
  copyConfig(consumer, configName);
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });
  writeLockfile(join(consumer, LOCKFILE_NAME), { pluginVersion: '1.0.0', target: 'claude', artifacts: lockEntries, now: FIXED_NOW });
  return { config, artifacts, lockEntries };
}

test('install stamps a provenance marker on skills and agents', async () => {
  const consumer = makeConsumerDir();
  await freshInstall(consumer);
  assert.ok(hasMarker(readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8')), 'skill marked');
  assert.ok(hasMarker(readFileSync(AGENT_PATH(consumer, 'fixture-agent'), 'utf8')), 'agent marked');
});

test('lockfile checksum equals the marker-stripped on-disk checksum', async () => {
  const consumer = makeConsumerDir();
  const { lockEntries } = await freshInstall(consumer);
  const entry = lockEntries.find((e) => e.id === 'universal-skill');
  const onDisk = readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8');
  assert.equal(entry.checksum, sha256(stripMarker(onDisk)));
});

test('install skips a local edit and warns (no --force), preserving the edit', async () => {
  const consumer = makeConsumerDir();
  const { config, artifacts } = await freshInstall(consumer);

  const edited = readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8') + '\n<!-- my edit -->\n';
  writeFileSync(SKILL_PATH(consumer, 'universal-skill'), edited, 'utf8');

  const warn = captureWarn();
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts, warn });

  assert.equal(readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8'), edited, 'edit preserved');
  assert.match(warn.text(), /universal-skill: local edits present/);
});

test('install --force resets our own local edit', async () => {
  const consumer = makeConsumerDir();
  const { config, artifacts } = await freshInstall(consumer);

  writeFileSync(SKILL_PATH(consumer, 'universal-skill'),
    readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8') + '\nGARBAGE\n', 'utf8');

  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts, force: true, warn: { write: () => {} } });

  assert.ok(!readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8').includes('GARBAGE'), 'edit reset by --force');
});

test('install never overwrites an owner-authored (unmarked) collision, even with --force', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  // Owner authors their OWN universal-skill before any install: unmarked, no lockfile.
  const ownerBody = '# My own universal-skill\nhand-authored\n';
  mkdirSync(join(consumer, '.claude', 'skills', 'universal-skill'), { recursive: true });
  writeFileSync(SKILL_PATH(consumer, 'universal-skill'), ownerBody, 'utf8');

  const warn = captureWarn();
  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts, force: true, warn });

  assert.equal(readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8'), ownerBody, 'owner file untouched even with --force');
  assert.ok(!lockEntries.some((e) => e.id === 'universal-skill'), 'collision id not added to lockfile');
  assert.match(warn.text(), /universal-skill: owner-authored file occupies this id/);
});

test('migration: pre-marker install backfills the marker without rewriting the body content', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  // Simulate a pre-marker install: install, then strip the marker from disk and
  // pin the lockfile to the marker-stripped checksum (what the old code wrote).
  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });
  const marked = readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8');
  const preMarker = stripMarker(marked);
  writeFileSync(SKILL_PATH(consumer, 'universal-skill'), preMarker, 'utf8');
  writeLockfile(join(consumer, LOCKFILE_NAME), { pluginVersion: '1.0.0', target: 'claude', artifacts: lockEntries, now: FIXED_NOW });

  const warn = captureWarn();
  await installClaude({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts, warn });

  const after = readFileSync(SKILL_PATH(consumer, 'universal-skill'), 'utf8');
  assert.ok(hasMarker(after), 'marker backfilled on first post-upgrade install');
  assert.equal(stripMarker(after), preMarker, 'body content unchanged — no spurious overwrite');
  assert.doesNotMatch(warn.text(), /local edits|owner-authored/, 'no false conflict/collision warnings');
});

// ─────────────────────────────────────────────────────────────────────────────
// Rules: lockfile tracking + ownership
// ─────────────────────────────────────────────────────────────────────────────

const RULE_PATH = (consumer, id) => join(consumer, '.claude', 'rules', ...id.split('/')) + '.md';

/**
 * A package root carrying only a rules/ tree: one ungated group and one gated
 * on stack.kmp. Artifacts still come from FIXTURES_SOURCE, so these tests never
 * depend on the rule bodies the package actually ships.
 */
function makeRulesPkg() {
  const root = mkdtempSync(join(tmpdir(), 'rules-pkg-'));
  mkdirSync(join(root, 'rules', 'common'), { recursive: true });
  mkdirSync(join(root, 'rules', 'kmp'), { recursive: true });
  writeFileSync(join(root, 'rules', 'common', 'style.md'), '# Style\n{{PROJECT_NAME}} style rule.\n', 'utf8');
  writeFileSync(join(root, 'rules', 'kmp', 'architecture.md'), '# KMP architecture\nLayers.\n', 'utf8');
  return root;
}

/** Installs against a rules-only pkgRoot and pins the result in the lockfile. */
async function installRulesFixture(consumer, pkg, configName) {
  copyConfig(consumer, configName);
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const warn = captureWarn();
  const lockEntries = await installClaude({ consumerCwd: consumer, pkgRoot: pkg, config, artifacts, warn });
  writeLockfile(join(consumer, LOCKFILE_NAME), { pluginVersion: '1.0.0', target: 'claude', artifacts: lockEntries, now: FIXED_NOW });
  return { config, artifacts, lockEntries, warn };
}

test('rule lock entries cover the active groups only', async () => {
  const pkg = makeRulesPkg();

  const kmpConsumer = makeConsumerDir();
  const kmp = await installRulesFixture(kmpConsumer, pkg, 'install-config-kmp.yaml');
  const kmpIds = kmp.lockEntries.filter((e) => e.kind === 'rule').map((e) => e.id);
  assert.deepEqual(kmpIds.sort(), ['common/style', 'kmp/architecture']);

  const plainConsumer = makeConsumerDir();
  const plain = await installRulesFixture(plainConsumer, pkg, 'install-config-no-notion.yaml');
  const plainIds = plain.lockEntries.filter((e) => e.kind === 'rule').map((e) => e.id);
  assert.deepEqual(plainIds, ['common/style'], 'a gated group must not be locked when its flag is off');
});

test('rule lock entries carry the unversioned sentinel and a checksum of the rendered body', async () => {
  const pkg = makeRulesPkg();
  const consumer = makeConsumerDir();
  const { lockEntries } = await installRulesFixture(consumer, pkg, 'install-config-no-notion.yaml');

  const entry = lockEntries.find((e) => e.id === 'common/style');
  assert.equal(entry.kind, 'rule');
  assert.equal(entry.version, '0.0.0', 'rules are unversioned data — version is a sentinel');
  assert.equal(
    entry.checksum,
    sha256(readFileSync(RULE_PATH(consumer, 'common/style'), 'utf8')),
    'checksum must cover the rendered body exactly as written to disk'
  );
});

test('turning a stack flag off removes the untouched rule and drops its lock entry', async () => {
  const pkg = makeRulesPkg();
  const consumer = makeConsumerDir();
  await installRulesFixture(consumer, pkg, 'install-config-kmp.yaml');
  assert.ok(existsSync(RULE_PATH(consumer, 'kmp/architecture')));

  const { lockEntries, warn } = await installRulesFixture(consumer, pkg, 'install-config-no-notion.yaml');

  assert.ok(!existsSync(RULE_PATH(consumer, 'kmp/architecture')), 'de-selected rule file should be removed');
  assert.ok(!existsSync(join(consumer, '.claude', 'rules', 'kmp')), 'the emptied group dir should be pruned');
  assert.ok(!lockEntries.some((e) => e.id === 'kmp/architecture'), 'entry should be dropped');
  assert.match(warn.text(), /Removed stale rule file/);
  assert.ok(existsSync(RULE_PATH(consumer, 'common/style')), 'ungated rules stay');
});

test('turning a stack flag off leaves a locally edited rule untouched', async () => {
  const pkg = makeRulesPkg();
  const consumer = makeConsumerDir();
  await installRulesFixture(consumer, pkg, 'install-config-kmp.yaml');

  const edited = '# KMP architecture\nMY OWN NOTES\n';
  writeFileSync(RULE_PATH(consumer, 'kmp/architecture'), edited, 'utf8');

  const { warn } = await installRulesFixture(consumer, pkg, 'install-config-no-notion.yaml');

  assert.equal(readFileSync(RULE_PATH(consumer, 'kmp/architecture'), 'utf8'), edited, 'owner edit preserved');
  assert.match(warn.text(), /kmp\/architecture: no longer selected by the active stack but locally edited/);
});

test('install does not overwrite a locally edited rule; --force does', async () => {
  const pkg = makeRulesPkg();
  const consumer = makeConsumerDir();
  const { config, artifacts } = await installRulesFixture(consumer, pkg, 'install-config-no-notion.yaml');

  const edited = '# Style\nMY OWN RULE\n';
  writeFileSync(RULE_PATH(consumer, 'common/style'), edited, 'utf8');

  const warn = captureWarn();
  const entries = await installClaude({ consumerCwd: consumer, pkgRoot: pkg, config, artifacts, warn });
  assert.equal(readFileSync(RULE_PATH(consumer, 'common/style'), 'utf8'), edited, 'edit preserved');
  assert.match(warn.text(), /rule:common\/style: local edits present/);
  assert.ok(entries.some((e) => e.id === 'common/style'), 'the id stays tracked while skipped');

  await installClaude({ consumerCwd: consumer, pkgRoot: pkg, config, artifacts, force: true, warn: { write: () => {} } });
  assert.ok(
    !readFileSync(RULE_PATH(consumer, 'common/style'), 'utf8').includes('MY OWN RULE'),
    'edit reset by --force'
  );
});

test('an owner-authored file at a rule id is never overwritten and is not locked', async () => {
  const pkg = makeRulesPkg();
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  const ownerBody = '# My own style rule\nhand-authored\n';
  mkdirSync(join(consumer, '.claude', 'rules', 'common'), { recursive: true });
  writeFileSync(RULE_PATH(consumer, 'common/style'), ownerBody, 'utf8');

  const warn = captureWarn();
  const entries = await installClaude({ consumerCwd: consumer, pkgRoot: pkg, config, artifacts, force: true, warn });

  assert.equal(readFileSync(RULE_PATH(consumer, 'common/style'), 'utf8'), ownerBody, 'owner file untouched even with --force');
  assert.ok(!entries.some((e) => e.id === 'common/style'), 'collision id not added to lockfile');
  assert.match(warn.text(), /rule:common\/style: owner-authored file occupies this id/);
});

test('migration: rules already on disk with no rule lock entries are adopted silently', async () => {
  const pkg = makeRulesPkg();
  const consumer = makeConsumerDir();
  const { config, artifacts, lockEntries } = await installRulesFixture(consumer, pkg, 'install-config-kmp.yaml');

  // A ≤1.15.0 consumer: rule files on disk, but the lockfile knows nothing about them.
  writeLockfile(join(consumer, LOCKFILE_NAME), {
    pluginVersion: '1.15.0',
    target: 'claude',
    artifacts: lockEntries.filter((e) => e.kind !== 'rule'),
    now: FIXED_NOW,
  });

  const warn = captureWarn();
  const entries = await installClaude({ consumerCwd: consumer, pkgRoot: pkg, config, artifacts, warn });

  assert.deepEqual(
    entries.filter((e) => e.kind === 'rule').map((e) => e.id).sort(),
    ['common/style', 'kmp/architecture'],
    'existing rules are adopted into the lockfile'
  );
  assert.equal(warn.text(), '', 'adoption must be silent — no anomaly wave on upgrade');
  assert.ok(existsSync(RULE_PATH(consumer, 'kmp/architecture')), 'no file removed during migration');
});

test('a user-authored file under .claude/rules/ is never removed', async () => {
  const pkg = makeRulesPkg();
  const consumer = makeConsumerDir();
  await installRulesFixture(consumer, pkg, 'install-config-kmp.yaml');

  const minePath = join(consumer, '.claude', 'rules', 'mine', 'notes.md');
  mkdirSync(dirname(minePath), { recursive: true });
  writeFileSync(minePath, '# My notes\n', 'utf8');

  await installRulesFixture(consumer, pkg, 'install-config-no-notion.yaml');

  assert.ok(existsSync(minePath), 'files at ids the plugin never shipped are not candidates for removal');
});
