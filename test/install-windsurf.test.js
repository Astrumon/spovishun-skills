import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, readdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import {
  installWindsurf,
  RULES_DIR,
  CHAR_LIMIT,
  splitIntoChunks,
  writeChunked,
} from '../adapters/windsurf/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_SOURCE = join(here, 'fixtures', 'source');
const PKG_ROOT = join(here, '..');

function makeConsumerDir() {
  return mkdtempSync(join(tmpdir(), 'install-windsurf-'));
}

function copyConfig(consumerDir, configName) {
  cpSync(join(here, 'fixtures', configName), join(consumerDir, 'spovishun-skills.config.yaml'));
}

function getRulesDir(consumerDir) {
  return join(consumerDir, RULES_DIR);
}

// ── Core output ─────────────────────────────────────────────────────────────

test('creates .windsurf/rules/ directory', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  await installWindsurf({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  assert.ok(existsSync(getRulesDir(consumer)), '.windsurf/rules/ must be created');
});

test('writes one .md file per skill', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  await installWindsurf({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const files = readdirSync(getRulesDir(consumer));
  assert.ok(files.includes('universal-skill.md'), 'universal-skill.md should be written');
});

test('substitutes PROJECT_NAME placeholder', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  await installWindsurf({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const content = readFileSync(join(getRulesDir(consumer), 'universal-skill.md'), 'utf8');
  assert.match(content, /FixtureProject/);
  assert.doesNotMatch(content, /\{\{PROJECT_NAME\}\}/);
});

// ── Stack filtering ──────────────────────────────────────────────────────────

test('excludes notion-skill when notion stack is off', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  await installWindsurf({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const files = readdirSync(getRulesDir(consumer));
  assert.ok(!files.some((f) => f.startsWith('notion-skill')), 'notion-skill must not be installed');
});

test('includes notion-skill when notion stack is on', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  await installWindsurf({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const files = readdirSync(getRulesDir(consumer));
  assert.ok(files.some((f) => f.startsWith('notion-skill')), 'notion-skill must be installed');
});

// ── Agents excluded ──────────────────────────────────────────────────────────

test('does not write a file for agents (only skills are installed)', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  await installWindsurf({ consumerCwd: consumer, pkgRoot: FIXTURES_SOURCE, config, artifacts });

  const files = readdirSync(getRulesDir(consumer));
  assert.ok(!files.some((f) => f.includes('agent')), 'no agent files should be written');
});

// ── Rules included ───────────────────────────────────────────────────────────

test('writes rule files from rules/ directory using double-dash path encoding', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  await installWindsurf({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts });

  const files = readdirSync(getRulesDir(consumer));
  // rules/common/git-workflow.md → common--git-workflow.md
  assert.ok(
    files.some((f) => f.includes('git-workflow')),
    'rules should be written to .windsurf/rules/'
  );
});

// ── splitIntoChunks ──────────────────────────────────────────────────────────

test('splitIntoChunks returns single chunk when text is under limit', () => {
  const text = 'hello world';
  const chunks = splitIntoChunks(text, 6000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], text);
});

test('splitIntoChunks splits text into chunks each <= maxChars', () => {
  const text = 'a'.repeat(15000);
  const chunks = splitIntoChunks(text, 6000);
  assert.ok(chunks.length >= 3, 'should produce at least 3 chunks');
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 6000, `chunk too long: ${chunk.length}`);
  }
  assert.equal(chunks.join(''), text, 'all chunks must reassemble to original text');
});

test('splitIntoChunks prefers newline boundary when available near end of window', () => {
  // 5500 'a' chars + newline + 1000 'b' chars: total 6501; should break after the newline
  const part1 = 'a'.repeat(5500) + '\n';
  const part2 = 'b'.repeat(1000);
  const text = part1 + part2;
  const chunks = splitIntoChunks(text, 6000);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], part1);
  assert.equal(chunks[1], part2);
});

// ── writeChunked ─────────────────────────────────────────────────────────────

test('writeChunked writes a single file when content fits within limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wchunked-'));
  const content = 'x'.repeat(100);
  const count = writeChunked(dir, 'my-skill', content);
  assert.equal(count, 1);
  assert.ok(existsSync(join(dir, 'my-skill.md')));
  assert.equal(readFileSync(join(dir, 'my-skill.md'), 'utf8'), content);
});

test('writeChunked writes part files when content exceeds limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wchunked-'));
  const content = 'y'.repeat(CHAR_LIMIT + 1);
  const count = writeChunked(dir, 'big-skill', content);
  assert.ok(count >= 2, 'should produce at least 2 part files');
  assert.ok(existsSync(join(dir, 'big-skill-part-1.md')));
  assert.ok(existsSync(join(dir, 'big-skill-part-2.md')));
  assert.ok(!existsSync(join(dir, 'big-skill.md')), 'plain file must not exist when split');
});

// ── Lockfile entries ─────────────────────────────────────────────────────────

test('returns lockfile entries with sha256-prefixed checksums', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  const entries = await installWindsurf({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    config,
    artifacts,
  });

  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.match(entry.checksum, /^sha256:[0-9a-f]{64}$/);
    assert.ok(['skill', 'rule'].includes(entry.kind));
  }
});

test('lockfile entries include rule entries when pkgRoot has rules/', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);

  const entries = await installWindsurf({
    consumerCwd: consumer,
    pkgRoot: PKG_ROOT,
    config,
    artifacts,
  });

  const ruleEntries = entries.filter((e) => e.kind === 'rule');
  assert.ok(ruleEntries.length > 0, 'rule entries must be present when pkgRoot has rules/');
  for (const e of ruleEntries) {
    assert.equal(e.version, '0.0.0');
  }
});

test('writes template artifacts as templates--{id}.md with supporting files', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  const tmpPkg = mkdtempSync(join(tmpdir(), 'wt-pkg-'));
  const tDir = join(tmpPkg, 'templates', 'sample');
  mkdirSync(tDir, { recursive: true });
  writeFileSync(
    join(tDir, 'manifest.yaml'),
    'id: sample\nversion: "1.0.0"\ncategory: universal\ndescription: Sample template fixture.\n',
    'utf8'
  );
  writeFileSync(join(tDir, 'TEMPLATE.md'), '# {{PROJECT_NAME}}\n', 'utf8');
  mkdirSync(join(tDir, 'references'), { recursive: true });
  writeFileSync(join(tDir, 'references', 'note.md'), '# note', 'utf8');

  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(tmpPkg);
  await installWindsurf({ consumerCwd: consumer, pkgRoot: tmpPkg, config, artifacts, warn: { write: () => {} } });

  const rulesDir = join(consumer, '.windsurf', 'rules');
  assert.ok(existsSync(join(rulesDir, 'templates--sample.md')), 'main template body should be written under templates-- prefix');
  assert.ok(existsSync(join(rulesDir, 'templates--sample--references--note.md')), 'supporting file should be written with chained -- separators');
  const body = readFileSync(join(rulesDir, 'templates--sample.md'), 'utf8');
  assert.ok(body.includes('FixtureProject'), 'Mustache must render template body');
});

// ── Stale-file reconcile ─────────────────────────────────────────────────────

test('reinstall removes stale plugin files but preserves user files', async () => {
  const { writeFileSync } = await import('node:fs');
  const { runInstall } = await import('../bin/install.js');
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  // First install writes the lockfile (target=windsurf) that drives reconcile.
  await runInstall({ target: 'windsurf', cwd: consumer, pkgRoot: FIXTURES_SOURCE, out: { write: () => {} } });

  const rulesDir = getRulesDir(consumer);
  // Simulate leftovers from a previous install: a shrunk chunked artifact part
  // for a plugin-known id, and a user-authored file the plugin never wrote.
  writeFileSync(join(rulesDir, 'universal-skill-part-2.md'), 'stale chunk', 'utf8');
  writeFileSync(join(rulesDir, 'my-own-rule.md'), 'user content', 'utf8');

  await runInstall({ target: 'windsurf', cwd: consumer, pkgRoot: FIXTURES_SOURCE, out: { write: () => {} } });

  assert.ok(!existsSync(join(rulesDir, 'universal-skill-part-2.md')), 'stale part file must be removed');
  assert.ok(existsSync(join(rulesDir, 'my-own-rule.md')), 'user file must be preserved');
  assert.ok(existsSync(join(rulesDir, 'universal-skill.md')), 'current artifact body must be present');
});
