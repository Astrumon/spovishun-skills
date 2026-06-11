import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { installClaude } from '../adapters/claude/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');

const NOTION_CONFIG = [
  'project:',
  '  name: "Scripts delivery test"',
  '  language: "uk"',
  'stack:',
  '  kotlin: true',
  '  postgres: false',
  '  telegram: false',
  '  notion: true',
  '  docker: false',
  'git:',
  '  branch_prefix: "feature/sd"',
  '  main_branch: "main"',
  '  dev_branch: "develop"',
  'notion:',
  '  token_env: "NOTION_TOKEN"',
  '  database_id: "aaaaaaaa11111111bbbbbbbb22222222"',
  '  epics_database_id: "cccccccc33333333dddddddd44444444"',
  '',
].join('\n');

const NO_NOTION_CONFIG = [
  'project:',
  '  name: "No notion"',
  '  language: "uk"',
  'stack:',
  '  kotlin: true',
  '  postgres: false',
  '  telegram: false',
  '  notion: false',
  '  docker: false',
  'git:',
  '  branch_prefix: "feature/nn"',
  '  main_branch: "main"',
  '  dev_branch: "develop"',
  '',
].join('\n');

function makeConsumer(configBody) {
  const dir = mkdtempSync(join(tmpdir(), 'scripts-delivery-'));
  writeFileSync(join(dir, 'spovishun-skills.config.yaml'), configBody, 'utf8');
  return dir;
}

async function install(configBody) {
  const consumer = makeConsumer(configBody);
  const config = loadConfig(join(consumer, 'spovishun-skills.config.yaml'));
  const artifacts = loadArtifacts(PKG_ROOT);
  await installClaude({ consumerCwd: consumer, pkgRoot: PKG_ROOT, config, artifacts, warn: { write: () => {} } });
  return consumer;
}

test('scripts/notion/*.js are copied into .claude/scripts/notion/ when stack.notion is true', async () => {
  const consumer = await install(NOTION_CONFIG);
  const notionDir = join(consumer, '.claude', 'scripts', 'notion');
  assert.ok(existsSync(notionDir), '.claude/scripts/notion/ must exist');

  const expectedScripts = [
    'get-board.js',
    'get-task.js',
    'get-claude-md.js',
    'create-task.js',
    'create-epic.js',
    'list-epics.js',
    'update-status.js',
    'archive-task.js',
    'bootstrap-config.js',
  ];
  for (const name of expectedScripts) {
    const p = join(notionDir, name);
    assert.ok(existsSync(p), `${name} must be installed`);
    const head = readFileSync(p, 'utf8').split('\n')[0];
    assert.match(head, /^#!\/usr\/bin\/env node/, `${name} must have shebang`);
  }
});

test('scripts/notion/lib/ modules are copied as a subdirectory', async () => {
  const consumer = await install(NOTION_CONFIG);
  const libDir = join(consumer, '.claude', 'scripts', 'notion', 'lib');
  assert.ok(existsSync(libDir));

  const expectedLib = [
    'notion-http.js',
    'load-token.js',
    'constants.js',
    'config-reader.js',
    'project-prefix.js',
    'format-task.js',
    'extract-branch.js',
    'page-id.js',
    'cache.js',
    'query-tasks.js',
    'resolve-relations.js',
    'section-parser.js',
    'markdown-to-blocks.js',
  ];
  for (const name of expectedLib) {
    assert.ok(existsSync(join(libDir, name)), `lib/${name} must be installed`);
  }
});

// markdown-to-blocks.js requires marked at runtime. Since consumer projects do
// not install the plugin's deps, marked is vendored under lib/vendor/ and must
// be delivered with the rest of the script tree.
test('vendored marked.cjs is shipped alongside markdown-to-blocks.js', async () => {
  const consumer = await install(NOTION_CONFIG);
  const vendored = join(consumer, '.claude', 'scripts', 'notion', 'lib', 'vendor', 'marked.cjs');
  assert.ok(existsSync(vendored), 'lib/vendor/marked.cjs must be delivered');
  // First line must be the marked banner so we know it's the real file, not a stub.
  const head = readFileSync(vendored, 'utf8').slice(0, 80);
  assert.match(head, /marked v\d+/i, 'vendored file must carry the marked banner');
});

test('installed markdown-to-blocks.js requires the vendored copy, not "marked"', async () => {
  const consumer = await install(NOTION_CONFIG);
  const src = readFileSync(
    join(consumer, '.claude', 'scripts', 'notion', 'lib', 'markdown-to-blocks.js'),
    'utf8'
  );
  // If we accidentally ship a `require('marked')` it would fail with
  // MODULE_NOT_FOUND on every consumer (no node_modules under .claude/).
  assert.ok(
    src.includes("require('./vendor/marked.cjs')"),
    'parser must require the vendored copy'
  );
  assert.equal(
    /require\(['"]marked['"]\)/.test(src),
    false,
    'parser must not require the package name'
  );
});

// All hooks are CommonJS. Without a "type": "commonjs" package.json next to
// them, a consumer whose root package.json declares "type": "module" would
// fail every hook invocation with `require is not defined in ES module scope`.
test('hooks/package.json (type: commonjs) is delivered alongside hook scripts', async () => {
  const consumer = await install(NOTION_CONFIG);
  const pkgPath = join(consumer, '.claude', 'hooks', 'package.json');
  assert.ok(existsSync(pkgPath), '.claude/hooks/package.json must be installed');
  const parsed = JSON.parse(readFileSync(pkgPath, 'utf8'));
  assert.equal(parsed.type, 'commonjs');
});

test('scripts/notion/ is NOT copied when stack.notion is false', async () => {
  const consumer = await install(NO_NOTION_CONFIG);
  const notionDir = join(consumer, '.claude', 'scripts', 'notion');
  assert.equal(existsSync(notionDir), false, 'notion scripts must not leak when notion is disabled');
});

test('ported scripts hard-code no project-specific Notion UUIDs', async () => {
  const consumer = await install(NOTION_CONFIG);
  const root = join(consumer, '.claude', 'scripts', 'notion');
  const targets = [
    'get-board.js',
    'get-task.js',
    'get-claude-md.js',
    'create-task.js',
    'create-epic.js',
    'list-epics.js',
    'update-status.js',
    'archive-task.js',
    'bootstrap-config.js',
    'lib/constants.js',
    'lib/extract-branch.js',
    'lib/query-tasks.js',
    'lib/resolve-relations.js',
    'lib/project-prefix.js',
    'lib/markdown-to-blocks.js',
  ];
  // Pre-port hardcoded UUIDs that must not appear anywhere in the installed
  // scripts. Sourced from the original Spovishun-specific constants.js.
  const FORBIDDEN_UUIDS = [
    '36f3462f68a981328625d728cac86ea3',
    'd0c0020049f74b0589979065d8cfe7d3',
    '3633462f68a981098385fa260e9ce132',
    '31c3462f-68a9-819c-8150-ff31d729293e',
    '3183462f-68a9-803a-a93a-e34eb81d2659',
    '3193462f68a981b79936e2e45291df85',
  ];

  for (const rel of targets) {
    const content = readFileSync(join(root, ...rel.split('/')), 'utf8');
    for (const uuid of FORBIDDEN_UUIDS) {
      assert.ok(
        !content.includes(uuid),
        `${rel} contains hard-coded project UUID ${uuid} — generalize via env + config-reader`
      );
    }
    // Hardcoded "spovishun-<digit>" task-id branding must also be gone — the
    // prefix comes from PROJECT_PREFIX. Allow `spovishun-skills` (the plugin's
    // own name) and `spovishun-cache` (cache dir branding).
    const projectSpecific = content.match(/spovishun-(?!skills|cache)[a-z0-9]*\d/gi);
    assert.equal(
      projectSpecific,
      null,
      `${rel} contains a hard-coded Spovishun task-id pattern (${projectSpecific?.[0]}) — must derive from project-prefix.js`
    );
  }
});

test('rendered SKILL.md bodies reference .claude/scripts/notion/, not scripts/notion/', async () => {
  const consumer = await install(NOTION_CONFIG);
  const skillsThatCallScripts = [
    'newtask',
    'newepic',
    'task-decomposer',
    'notion-spovishun-task-manager',
    'notion-task-to-code',
    'notion-workflow-spovishun',
    'notion-content-reader',
  ];
  for (const id of skillsThatCallScripts) {
    const body = readFileSync(join(consumer, '.claude', 'skills', id, 'SKILL.md'), 'utf8');
    // Any unprefixed `node scripts/notion/X.js` that escaped the rewrite would be a regression.
    // Allow the literal sequence inside backtick-quoted reference paths that talk *about*
    // the plugin directory layout (none of the affected skills do this currently).
    const stray = body.match(/\bnode\s+scripts\/notion\//g);
    assert.equal(stray, null, `${id} still references the un-prefixed scripts/notion/ path`);
    // At least one .claude/scripts/notion/ reference must be present (otherwise the
    // skill no longer needs the script set and is in the wrong list).
    assert.ok(
      body.includes('.claude/scripts/notion/'),
      `${id} must reference .claude/scripts/notion/ at least once`
    );
  }
});
