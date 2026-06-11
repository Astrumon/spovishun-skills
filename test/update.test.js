import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { runInstall } from '../bin/install.js';
import { runUpdate } from '../bin/update.js';
import { LOCKFILE_NAME, readLockfile } from '../lib/lockfile.js';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE_V1 = join(here, 'fixtures', 'source');
const SOURCE_V2 = join(here, 'fixtures', 'source-v2');

const NOOP_OUT = { write: () => {} };

function makeConsumerDir() {
  return mkdtempSync(join(tmpdir(), 'update-test-'));
}

function copyConfig(consumerDir, configName) {
  const src = join(here, 'fixtures', configName);
  const dest = join(consumerDir, 'spovishun-skills.config.yaml');
  cpSync(src, dest);
  return dest;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO_APPLY: upstream changed, on-disk untouched
// ─────────────────────────────────────────────────────────────────────────────
test('AUTO_APPLY: v2 body written to disk, lockfile checksum updated', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  const skillPath = join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md');
  const v1Content = readFileSync(skillPath, 'utf8');
  assert.ok(v1Content.includes('all projects.'), 'v1 body should be on disk initially');

  const summary = await runUpdate({ cwd: consumer, upstreamRoot: SOURCE_V2, out: NOOP_OUT });

  assert.equal(summary.autoApplied, 1);
  assert.equal(summary.conflicts, 0);

  const v2Content = readFileSync(skillPath, 'utf8');
  assert.ok(v2Content.includes('v2'), 'v2 body should be on disk after update');
  assert.ok(!v2Content.includes('<<<<<<<'), 'no conflict markers should appear');

  const lock = readLockfile(join(consumer, LOCKFILE_NAME));
  const entry = lock.artifacts.find((e) => e.id === 'universal-skill');
  assert.equal(entry.version, '2.0.0', 'lockfile version should reflect v2');
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFLICT: upstream changed AND local edits present
// ─────────────────────────────────────────────────────────────────────────────
test('CONFLICT: conflict markers written, lockfile version unchanged', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  const skillPath = join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md');
  // Simulate local edit
  writeFileSync(skillPath, readFileSync(skillPath, 'utf8') + '\nlocal edit here', 'utf8');

  const summary = await runUpdate({ cwd: consumer, upstreamRoot: SOURCE_V2, out: NOOP_OUT });

  assert.equal(summary.conflicts, 1);
  assert.equal(summary.autoApplied, 0);

  const content = readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('<<<<<<<'), 'conflict marker start should be present');
  assert.ok(content.includes('======='), 'conflict separator should be present');
  assert.ok(content.includes('>>>>>>>'), 'conflict marker end should be present');
  assert.ok(content.includes('local edit here'), 'ours content should appear in conflict');

  const lock = readLockfile(join(consumer, LOCKFILE_NAME));
  const entry = lock.artifacts.find((e) => e.id === 'universal-skill');
  assert.equal(entry.version, '1.0.0', 'lockfile version should stay at v1 after conflict');
});

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL_ONLY: upstream unchanged (v1 vs v1), local edit → file untouched
// ─────────────────────────────────────────────────────────────────────────────
test('LOCAL_ONLY: local edit with same upstream version leaves file untouched', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  const skillPath = join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md');
  const localEdit = readFileSync(skillPath, 'utf8') + '\nmy local addition';
  writeFileSync(skillPath, localEdit, 'utf8');

  // Update against same v1 — upstream did not change
  const summary = await runUpdate({ cwd: consumer, upstreamRoot: SOURCE_V1, out: NOOP_OUT });

  assert.equal(summary.conflicts, 0, 'no conflicts expected');
  assert.equal(summary.autoApplied, 0, 'no auto-apply expected');

  const afterContent = readFileSync(skillPath, 'utf8');
  assert.equal(afterContent, localEdit, 'file should be unchanged');
});

// ─────────────────────────────────────────────────────────────────────────────
// --skill filter: only the specified artifact is processed
// ─────────────────────────────────────────────────────────────────────────────
test('--skill filter applies update only to specified artifact', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-notion.yaml');

  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  const universalPath = join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md');
  const notionPath = join(consumer, '.claude', 'skills', 'notion-skill', 'SKILL.md');

  const notionContentBefore = readFileSync(notionPath, 'utf8');

  // Update only universal-skill
  const summary = await runUpdate({
    cwd: consumer,
    upstreamRoot: SOURCE_V2,
    skillId: 'universal-skill',
    out: NOOP_OUT,
  });

  assert.equal(summary.autoApplied, 1);

  const universalAfter = readFileSync(universalPath, 'utf8');
  assert.ok(universalAfter.includes('v2'), 'universal-skill should be updated to v2');

  const notionAfter = readFileSync(notionPath, 'utf8');
  assert.equal(notionAfter, notionContentBefore, 'notion-skill should be untouched');
});

// ─────────────────────────────────────────────────────────────────────────────
// --dry-run: nothing written to disk
// ─────────────────────────────────────────────────────────────────────────────
test('--dry-run: no files changed, no lockfile updated', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  const skillPath = join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md');
  // Add local edit so we get CONFLICT action in dry-run
  writeFileSync(skillPath, readFileSync(skillPath, 'utf8') + '\nlocal edit', 'utf8');
  const contentBefore = readFileSync(skillPath, 'utf8');
  const lockBefore = readFileSync(join(consumer, LOCKFILE_NAME), 'utf8');

  await runUpdate({ cwd: consumer, upstreamRoot: SOURCE_V2, dryRun: true, out: NOOP_OUT });

  assert.equal(readFileSync(skillPath, 'utf8'), contentBefore, 'skill file should be unchanged in dry-run');
  assert.equal(readFileSync(join(consumer, LOCKFILE_NAME), 'utf8'), lockBefore, 'lockfile should be unchanged in dry-run');
});

// ─────────────────────────────────────────────────────────────────────────────
// NEW: upstream adds a skill not in lockfile
// ─────────────────────────────────────────────────────────────────────────────
test('NEW: artifact present in upstream but not in lockfile is written', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  // Install from v1 which only has universal-skill (no notion)
  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  // Manually remove universal-skill from lockfile to simulate "not installed" state
  // Actually test NEW by having a source-v2 skill that doesn't exist in v1.
  // The fixture-agent exists in both. Let's use a different approach:
  // Install with v1 (no notion), then update against v1 with notion enabled config.
  // But that's a stack filter issue, not NEW.
  // Simpler: install from v1 source, then corrupt lockfile to remove universal-skill entry.
  const lockPath = join(consumer, LOCKFILE_NAME);
  const lock = readLockfile(lockPath);
  lock.artifacts = lock.artifacts.filter((e) => e.id !== 'universal-skill');
  const { dump } = await import('js-yaml');
  writeFileSync(lockPath, dump(lock), 'utf8');

  const summary = await runUpdate({ cwd: consumer, upstreamRoot: SOURCE_V2, out: NOOP_OUT });

  assert.equal(summary.newArtifacts, 1, 'universal-skill should be treated as NEW');
  const content = readFileSync(join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md'), 'utf8');
  assert.ok(content.includes('v2'), 'NEW artifact should have v2 body');
});

// ─────────────────────────────────────────────────────────────────────────────
// REMOVED: lockfile has entry, artifact no longer in upstream
// ─────────────────────────────────────────────────────────────────────────────
test('REMOVED: lockfile entry dropped when artifact absent from upstream', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-notion.yaml');

  // Install both universal and notion skill from v1
  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  // Update against v2, which also has both skills (notion in v2 fixture is same as v1).
  // To simulate REMOVED: manually add a fake artifact to the lockfile.
  const lockPath = join(consumer, LOCKFILE_NAME);
  const lock = readLockfile(lockPath);
  lock.artifacts.push({ kind: 'skill', id: 'ghost-skill', version: '1.0.0', checksum: 'sha256:abc123' });
  const { dump } = await import('js-yaml');
  writeFileSync(lockPath, dump(lock), 'utf8');

  const summary = await runUpdate({ cwd: consumer, upstreamRoot: SOURCE_V1, out: NOOP_OUT });

  assert.equal(summary.removed, 1, 'ghost-skill should be reported as removed');

  const lockAfter = readLockfile(lockPath);
  const stillThere = lockAfter.artifacts.find((e) => e.id === 'ghost-skill');
  assert.equal(stillThere, undefined, 'ghost-skill should be removed from lockfile');
});

// ─────────────────────────────────────────────────────────────────────────────
// RULE entries: never classified as REMOVED, preserved verbatim
// ─────────────────────────────────────────────────────────────────────────────
test('rule lock entries are preserved by update (not dropped as REMOVED)', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  // Rules never appear in loadArtifacts(upstream); before the rule-skip guard
  // they were classified REMOVED and silently dropped from the lockfile.
  const lockPath = join(consumer, LOCKFILE_NAME);
  const lock = readLockfile(lockPath);
  lock.artifacts.push({ kind: 'rule', id: 'common/git-workflow', version: '0.0.0', checksum: 'sha256:rulehash' });
  const { dump } = await import('js-yaml');
  writeFileSync(lockPath, dump(lock), 'utf8');

  const summary = await runUpdate({ cwd: consumer, upstreamRoot: SOURCE_V1, out: NOOP_OUT });

  assert.equal(summary.removed, 0, 'rule entry must not be counted as removed');
  assert.equal(summary.rulesSkipped, 1, 'rule entry must be reported as skipped');

  const lockAfter = readLockfile(lockPath);
  const ruleEntry = lockAfter.artifacts.find((e) => e.kind === 'rule' && e.id === 'common/git-workflow');
  assert.ok(ruleEntry, 'rule entry must survive the update');
  assert.equal(ruleEntry.checksum, 'sha256:rulehash', 'rule entry must be preserved verbatim');
});

// ─────────────────────────────────────────────────────────────────────────────
// installed-files-loader: windsurf template files keyed as template:<id>
// ─────────────────────────────────────────────────────────────────────────────
test('loadInstalledFiles keys windsurf templates--<id>.md files under template:<id>', async () => {
  const { loadInstalledFiles } = await import('../lib/installed-files-loader.js');
  const { mkdirSync } = await import('node:fs');

  const consumer = makeConsumerDir();
  const rulesDir = join(consumer, '.windsurf', 'rules');
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, 'templates--epic-page.md'), '# Epic template\n', 'utf8');
  writeFileSync(join(rulesDir, 'some-skill.md'), '# Skill\n', 'utf8');

  const map = loadInstalledFiles(consumer, 'windsurf');

  assert.ok(map.has('template:epic-page'), 'template file must be keyed by kind template');
  assert.equal(map.has('skill:templates--epic-page'), false, 'template must not leak under skill kind');
  assert.ok(map.has('skill:some-skill'), 'plain skill files keep the skill kind');
});

// ─────────────────────────────────────────────────────────────────────────────
// codex: unsupported, exits 0 with warning
// ─────────────────────────────────────────────────────────────────────────────
test('codex target: prints warning and returns without error', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  await runInstall({ target: 'codex', cwd: consumer, pkgRoot: SOURCE_V1, out: NOOP_OUT });

  const agentsMdBefore = readFileSync(join(consumer, 'AGENTS.md'), 'utf8');

  const messages = [];
  const summary = await runUpdate({
    cwd: consumer,
    upstreamRoot: SOURCE_V2,
    out: { write: (m) => messages.push(m) },
  });

  const output = messages.join('');
  assert.ok(output.includes('codex'), 'output should mention codex');
  assert.ok(output.includes('not supported'), 'output should say not supported');

  // AGENTS.md must be unchanged
  assert.equal(readFileSync(join(consumer, 'AGENTS.md'), 'utf8'), agentsMdBefore);

  assert.equal(summary.autoApplied, 0);
  assert.equal(summary.conflicts, 0);
});
