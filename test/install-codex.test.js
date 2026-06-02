import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { installCodex, AGENTS_MD_FILENAME, SIZE_LIMIT_BYTES } from '../adapters/codex/index.js';
import { buildAgentsMd } from '../adapters/codex/build-agents-md.js';
import { buildPlaceholderMap } from '../lib/placeholder-map.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_SOURCE = join(here, 'fixtures', 'source');
const PKG_ROOT = join(here, '..');
const PLUGIN_VERSION = '0.0.0-test';

class CapturingWriter {
  constructor() {
    this.chunks = [];
  }
  write(chunk) {
    this.chunks.push(chunk);
    return true;
  }
  get text() {
    return this.chunks.join('');
  }
}

function makeConsumerDir() {
  return mkdtempSync(join(tmpdir(), 'install-codex-'));
}

function copyConfig(consumerDir, configName) {
  const src = join(here, 'fixtures', configName);
  const dest = join(consumerDir, 'spovishun-skills.config.yaml');
  cpSync(src, dest);
  return dest;
}

test('writes AGENTS.md at the consumer project root', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  const outPath = join(consumer, AGENTS_MD_FILENAME);
  assert.ok(existsSync(outPath), 'AGENTS.md should be written to consumer root');
});

test('includes universal skill and excludes notion skill when notion stack is off', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  const content = readFileSync(join(consumer, AGENTS_MD_FILENAME), 'utf8');
  assert.match(content, /### universal-skill \(v1\.0\.0\)/);
  assert.doesNotMatch(content, /notion-skill/);
});

test('includes notion skill when notion stack is enabled and renders database id', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  const content = readFileSync(join(consumer, AGENTS_MD_FILENAME), 'utf8');
  assert.match(content, /### notion-skill/);
  assert.match(content, /3193462f68a980d69ec9c7ccc6329b88/);
  assert.doesNotMatch(content, /\{\{NOTION_DATABASE_ID\}\}/);
});

test('substitutes PROJECT_NAME placeholder in the rendered output', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  const content = readFileSync(join(consumer, AGENTS_MD_FILENAME), 'utf8');
  assert.match(content, /FixtureProject/);
  assert.doesNotMatch(content, /\{\{PROJECT_NAME\}\}/);
});

test('renders agents under the ## Agents section and strips YAML frontmatter', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  const content = readFileSync(join(consumer, AGENTS_MD_FILENAME), 'utf8');
  assert.match(content, /## Agents/);
  assert.match(content, /### fixture-agent \(v1\.0\.0\)/);
  assert.doesNotMatch(content, /^tools: Read, Grep$/m, 'frontmatter tools line must be stripped');
  assert.doesNotMatch(content, /^model: claude-sonnet-4-6$/m, 'frontmatter model line must be stripped');
});

test('does not emit a hooks or MCP section', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(PKG_ROOT);
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: PKG_ROOT,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  const content = readFileSync(join(consumer, AGENTS_MD_FILENAME), 'utf8');
  assert.doesNotMatch(content, /^## Hooks$/m);
});

test('demotes ATX headings inside skill bodies', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  const content = readFileSync(join(consumer, AGENTS_MD_FILENAME), 'utf8');
  // universal-skill SKILL.md starts with `# universal-skill`; demoted by 2 → `### universal-skill`
  assert.match(content, /^### universal-skill$/m);
  // Must not contain a top-level `# universal-skill` after demotion
  assert.doesNotMatch(content, /^# universal-skill$/m);
});

test('lockfile entries cover skills, agents and rules with sha256-prefixed checksums', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const lockEntries = await installCodex({
    consumerCwd: consumer,
    pkgRoot: PKG_ROOT, // PKG_ROOT has real rules/, so this exercises rule entries too
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  assert.ok(lockEntries.length > 0, 'should return at least one entry');
  for (const entry of lockEntries) {
    assert.match(entry.checksum, /^sha256:[0-9a-f]{64}$/);
    assert.ok(['skill', 'agent', 'rule'].includes(entry.kind));
  }
  const kinds = new Set(lockEntries.map((e) => e.kind));
  assert.ok(kinds.has('skill'));
  assert.ok(kinds.has('agent'));
  assert.ok(kinds.has('rule'));
});

test('header contains plugin version and project name', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn: new CapturingWriter(),
  });

  const content = readFileSync(join(consumer, AGENTS_MD_FILENAME), 'utf8');
  assert.match(content, /^# FixtureProject — Agent Instructions$/m);
  assert.match(content, new RegExp(`spovishun-skills v${PLUGIN_VERSION}`));
});

test('emits a warning when AGENTS.md exceeds the 32 KiB soft limit but still writes the file', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(PKG_ROOT);
  const warn = new CapturingWriter();
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: PKG_ROOT,
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn,
  });

  const outPath = join(consumer, AGENTS_MD_FILENAME);
  assert.ok(existsSync(outPath), 'AGENTS.md must still be written when oversized');
  const size = Buffer.byteLength(readFileSync(outPath, 'utf8'), 'utf8');
  assert.ok(
    size > SIZE_LIMIT_BYTES,
    `expected real-skill output > ${SIZE_LIMIT_BYTES} bytes, got ${size}`
  );
  assert.match(warn.text, /AGENTS\.md is [\d.]+ KiB \(>32 KiB Codex soft limit\)/);
  assert.match(warn.text, /~\/\.codex\/AGENTS\.md/);
});

test('does not warn when output is under the size limit', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(FIXTURES_SOURCE);
  const warn = new CapturingWriter();
  await installCodex({
    consumerCwd: consumer,
    pkgRoot: FIXTURES_SOURCE, // no rules/ dir → small output
    config,
    artifacts,
    pluginVersion: PLUGIN_VERSION,
    warn,
  });

  assert.equal(warn.text, '', 'no warnings expected for small output');
});

test('buildAgentsMd is pure and deterministic for the same inputs', () => {
  const config = {
    project: { name: 'TestProj', language: 'uk' },
    stack: { kotlin: true, notion: false },
    git: { branch_prefix: 'feature/' },
  };
  const configMap = buildPlaceholderMap(config);
  const artifacts = [
    {
      kind: 'skill',
      id: 'a-skill',
      version: '1.0.0',
      manifest: {},
      bodyText: '# a-skill\n\nHello {{PROJECT_NAME}}\n',
    },
  ];

  const out1 = buildAgentsMd({ artifacts, config, configMap, pluginVersion: '1.2.3' });
  const out2 = buildAgentsMd({ artifacts, config, configMap, pluginVersion: '1.2.3' });
  assert.equal(out1, out2);
  assert.match(out1, /### a-skill \(v1\.0\.0\)/);
  assert.match(out1, /Hello TestProj/);
});

test('renders templates under ## Templates section with sub-headings for supporting files', () => {
  const config = {
    project: { name: 'P', language: 'uk' },
    stack: { kotlin: false, postgres: false, telegram: false, notion: false },
    git: { branch_prefix: 'feature/' },
  };
  const configMap = buildPlaceholderMap(config);
  const artifacts = [
    {
      kind: 'template',
      id: 'epic-page',
      version: '1.0.0',
      manifest: {},
      bodyText: '# Epic\nUse {{PROJECT_NAME}}\n',
      files: [
        { relPath: 'references/notes.md', contents: '# notes', encoding: 'utf8' },
        { relPath: 'assets/diagram.png', contents: 'AAA=', encoding: 'base64' },
      ],
    },
  ];
  const warn = new CapturingWriter();
  const out = buildAgentsMd({ artifacts, config, configMap, pluginVersion: '1.0.0', warn });
  assert.match(out, /## Templates/);
  assert.match(out, /### epic-page \(v1\.0\.0\)/);
  assert.match(out, /#### epic-page — references\/notes\.md/);
  assert.match(out, /Use P/);
  // Binary asset emits a warning, not a heading.
  assert.match(warn.text, /assets\/diagram\.png/);
  assert.doesNotMatch(out, /assets\/diagram\.png/);
});
