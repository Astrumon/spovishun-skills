import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { loadWindsurfFiles } from '../lib/installed-files-loader.js';
import { writeLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';
import { WINDSURF_MANIFEST, readWindsurfManifest } from '../lib/windsurf-manifest.js';
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
const FIXED_NOW = () => new Date('2025-06-01T12:00:00.000Z');

function makeConsumerDir() {
  return mkdtempSync(join(tmpdir(), 'install-windsurf-'));
}

function captureWarn() {
  let text = '';
  return { write: (s) => { text += s; }, text: () => text };
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
  const names = writeChunked(dir, 'my-skill', content);
  assert.deepEqual(names, ['my-skill.md']);
  assert.ok(existsSync(join(dir, 'my-skill.md')));
  assert.equal(readFileSync(join(dir, 'my-skill.md'), 'utf8'), content);
});

test('writeChunked writes part files when content exceeds limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wchunked-'));
  const content = 'y'.repeat(CHAR_LIMIT + 1);
  const names = writeChunked(dir, 'big-skill', content);
  assert.ok(names.length >= 2, 'should produce at least 2 part files');
  assert.deepEqual(names.slice(0, 2), ['big-skill-part-1.md', 'big-skill-part-2.md']);
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

// ─────────────────────────────────────────────────────────────────────────────
// Provenance manifest — filename → {kind, id} attribution
// ─────────────────────────────────────────────────────────────────────────────

/** A package root carrying only a rules/ tree; artifacts come from FIXTURES_SOURCE. */
function makeRulesPkg() {
  const root = mkdtempSync(join(tmpdir(), 'ws-rules-pkg-'));
  mkdirSync(join(root, 'rules', 'common'), { recursive: true });
  writeFileSync(join(root, 'rules', 'common', 'style.md'), '# Style\n{{PROJECT_NAME}} style rule.\n', 'utf8');
  return root;
}

/** Installs and pins the resulting entries in a windsurf lockfile, as bin/install.js does. */
async function installAndLock(consumer, pkg, { artifactsRoot = FIXTURES_SOURCE, warn = captureWarn() } = {}) {
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(artifactsRoot);
  const lockEntries = await installWindsurf({ consumerCwd: consumer, pkgRoot: pkg, config, artifacts, warn });
  writeLockfile(join(consumer, LOCKFILE_NAME), {
    pluginVersion: '1.0.0',
    target: 'windsurf',
    artifacts: lockEntries,
    now: FIXED_NOW,
  });
  return { lockEntries, warn };
}

const keysOf = (entries) => entries.map((e) => `${e.kind}:${e.id}`).sort();

test('loadWindsurfFiles returns exactly the keys the lockfile contains', async () => {
  const consumer = makeConsumerDir();
  const { lockEntries } = await installAndLock(consumer, makeRulesPkg());

  assert.deepEqual([...loadWindsurfFiles(consumer).keys()].sort(), keysOf(lockEntries));
});

test('rules are keyed rule:<id> with the slash intact, not skill:<id--with-dashes>', async () => {
  const consumer = makeConsumerDir();
  await installAndLock(consumer, makeRulesPkg());

  const installed = loadWindsurfFiles(consumer);
  assert.ok(installed.has('rule:common/style'), 'rule must keep its lockfile identity');
  assert.ok(!installed.has('skill:common--style'), 'the old filename-derived phantom key must be gone');
  assert.equal(
    installed.get('rule:common/style').content,
    readFileSync(join(getRulesDir(consumer), 'common--style.md'), 'utf8')
  );
});

test('supporting files do not masquerade as skills', async () => {
  const consumer = makeConsumerDir();
  const pkg = mkdtempSync(join(tmpdir(), 'ws-support-pkg-'));
  const sDir = join(pkg, 'skills', 'with-refs');
  mkdirSync(join(sDir, 'references'), { recursive: true });
  writeFileSync(
    join(sDir, 'manifest.yaml'),
    'id: with-refs\nversion: "1.0.0"\ncategory: universal\ndescription: Skill carrying a reference file.\n',
    'utf8'
  );
  writeFileSync(join(sDir, 'SKILL.md'), '# with-refs\n', 'utf8');
  writeFileSync(join(sDir, 'references', 'note.md'), '# note\n', 'utf8');

  await installAndLock(consumer, pkg, { artifactsRoot: pkg });

  assert.ok(
    existsSync(join(getRulesDir(consumer), 'with-refs--references--note.md')),
    'the supporting file is still written'
  );
  assert.deepEqual([...loadWindsurfFiles(consumer).keys()], ['skill:with-refs'],
    'a supporting file owns no id of its own — it follows its body, as on claude');
});

test('chunked bodies are reassembled in part order', async () => {
  const consumer = makeConsumerDir();
  const pkg = mkdtempSync(join(tmpdir(), 'ws-big-pkg-'));
  const sDir = join(pkg, 'skills', 'big-skill');
  mkdirSync(sDir, { recursive: true });
  writeFileSync(
    join(sDir, 'manifest.yaml'),
    'id: big-skill\nversion: "1.0.0"\ncategory: universal\ndescription: Skill larger than the windsurf char limit.\n',
    'utf8'
  );
  const body = ('# big-skill\n' + 'lorem ipsum dolor sit amet\n'.repeat(400)).slice(0, CHAR_LIMIT * 2);
  writeFileSync(join(sDir, 'SKILL.md'), body, 'utf8');

  await installAndLock(consumer, pkg, { artifactsRoot: pkg });

  const rulesDir = getRulesDir(consumer);
  assert.ok(existsSync(join(rulesDir, 'big-skill-part-1.md')), 'body must be chunked');
  const entry = loadWindsurfFiles(consumer).get('skill:big-skill');
  assert.equal(entry.content, body, 'concatenated chunks must restore the body byte-for-byte');
  assert.equal(entry.paths.length, readdirSync(rulesDir).filter((f) => f.startsWith('big-skill-part-')).length);
});

test('the manifest is a dotfile, so it is never read back as a rule', async () => {
  const consumer = makeConsumerDir();
  await installAndLock(consumer, makeRulesPkg());

  const rulesDir = getRulesDir(consumer);
  assert.ok(existsSync(join(rulesDir, WINDSURF_MANIFEST)));
  assert.ok(WINDSURF_MANIFEST.startsWith('.'), 'must be hidden from windsurf itself');
  assert.ok(
    ![...loadWindsurfFiles(consumer).keys()].some((k) => k.includes('spovishun-manifest')),
    'the manifest must not appear as an artifact'
  );

  const manifest = readWindsurfManifest(rulesDir);
  assert.deepEqual(manifest['common--style.md'], { kind: 'rule', id: 'common/style', role: 'body' });
});

test('a corrupt manifest degrades to filename parsing instead of throwing', async () => {
  const consumer = makeConsumerDir();
  await installAndLock(consumer, makeRulesPkg());

  writeFileSync(join(getRulesDir(consumer), WINDSURF_MANIFEST), '{ not json', 'utf8');
  assert.equal(readWindsurfManifest(getRulesDir(consumer)), null);
  assert.ok(loadWindsurfFiles(consumer).has('skill:universal-skill'), 'fallback still finds bodies');
});

// ── Legacy installs (no manifest on disk) ────────────────────────────────────

test('an install predating the manifest still resolves rule ids via the lockfile', async () => {
  const consumer = makeConsumerDir();
  const { lockEntries } = await installAndLock(consumer, makeRulesPkg());

  // Reproduce a pre-1.21.0 tree: files and lockfile, no manifest.
  rmSync(join(getRulesDir(consumer), WINDSURF_MANIFEST), { force: true });

  const installed = loadWindsurfFiles(consumer);
  assert.ok(installed.has('rule:common/style'), 'the lockfile names what the filename cannot');
  assert.deepEqual(
    [...installed.keys()].sort(),
    keysOf(lockEntries).concat().sort(),
    'legacy migration must not lose or invent ids'
  );
});

test('a locked id shaped like a chunk name is not swallowed by the greedy part pattern', () => {
  // `foo-part-1.md` is chunk 1 of `foo` — unless `foo-part-1` is itself a
  // locked id, which is the case the old reader always got wrong.
  const consumer = makeConsumerDir();
  const rulesDir = join(consumer, RULES_DIR);
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, 'foo-part-1.md'), 'whole body\n', 'utf8');
  writeLockfile(join(consumer, LOCKFILE_NAME), {
    pluginVersion: '1.0.0',
    target: 'windsurf',
    artifacts: [{ kind: 'skill', id: 'foo-part-1', version: '1.0.0', checksum: 'sha256:x' }],
    now: FIXED_NOW,
  });

  const installed = loadWindsurfFiles(consumer);
  assert.ok(installed.has('skill:foo-part-1'), 'the locked id wins over the chunk reading');
  assert.ok(!installed.has('skill:foo'), 'no phantom base id');
});

// ── Non-injective `--` encoding ──────────────────────────────────────────────

test('two artifacts flattening to the same filename warn instead of clobbering silently', async () => {
  const consumer = makeConsumerDir();
  const pkg = mkdtempSync(join(tmpdir(), 'ws-collide-pkg-'));

  // Skill literally named `common--style` → common--style.md
  const sDir = join(pkg, 'skills', 'common--style');
  mkdirSync(sDir, { recursive: true });
  writeFileSync(
    join(sDir, 'manifest.yaml'),
    'id: common--style\nversion: "1.0.0"\ncategory: universal\ndescription: Skill whose id collides with a flattened rule path.\n',
    'utf8'
  );
  writeFileSync(join(sDir, 'SKILL.md'), '# from the skill\n', 'utf8');

  // Rule `common/style` flattens to common--style.md — the same name.
  mkdirSync(join(pkg, 'rules', 'common'), { recursive: true });
  writeFileSync(join(pkg, 'rules', 'common', 'style.md'), '# from the rules tree\n', 'utf8');

  const { warn } = await installAndLock(consumer, pkg, { artifactsRoot: pkg });

  assert.match(warn.text(), /rule:common\/style and skill:common--style both write common--style\.md/);
  assert.match(warn.text(), /Rename one of the two/);
  assert.equal(
    readFileSync(join(getRulesDir(consumer), 'common--style.md'), 'utf8'),
    '# from the rules tree\n',
    'last write wins on disk'
  );
  assert.deepEqual(
    readWindsurfManifest(getRulesDir(consumer))['common--style.md'],
    { kind: 'rule', id: 'common/style', role: 'body' },
    'the manifest must describe what is actually on disk'
  );
});
