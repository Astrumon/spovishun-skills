import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, cpSync, unlinkSync, existsSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { runInstall } from '../bin/install.js';
import { runDoctor } from '../bin/doctor.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, 'fixtures');
const FIXTURES_SOURCE = join(FIXTURES, 'source');

function silentOut() {
  const chunks = [];
  return {
    write: (msg) => chunks.push(msg),
    text: () => chunks.join(''),
  };
}

function makeConsumer() {
  return mkdtempSync(join(tmpdir(), 'doctor-test-'));
}

function copyConfig(consumerDir, configName) {
  cpSync(join(FIXTURES, configName), join(consumerDir, 'spovishun-skills.config.yaml'));
}

function writeGitignore(consumerDir, lines) {
  writeFileSync(join(consumerDir, '.gitignore'), lines.join('\n') + '\n', 'utf8');
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'X',
    async json() {
      return body;
    },
  };
}

/**
 * Build a fetch impl that responds based on path predicate.
 * Defaults to 200 OK for unmatched requests.
 */
function fakeFetch(handlers) {
  return async (url) => {
    for (const { match, response } of handlers) {
      if (match(url)) return response;
    }
    return jsonResponse(200, {});
  };
}

function findResult(text, name) {
  const lines = text.split(/\n/);
  return lines.find((l) => l.includes(` ${name} `) || l.includes(` ${name}  `));
}

function statusOf(text, name) {
  const line = findResult(text, name);
  if (!line) return null;
  if (line.startsWith('✓')) return 'pass';
  if (line.startsWith('✗')) return 'fail';
  if (line.startsWith('·')) return 'skip';
  return null;
}

function installClaudeFully(consumer, configName) {
  copyConfig(consumer, configName);
  return runInstall({
    target: 'claude',
    cwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    out: { write: () => {} },
  });
}

test('happy path: claude + notion=false → notion + gitignore-config skipped, everything else passes', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-no-notion.yaml');
  writeGitignore(consumer, ['.claude/settings.local.json']);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, true, `expected pass, output was:\n${text}`);
  assert.equal(statusOf(text, 'config-present'), 'pass');
  assert.equal(statusOf(text, 'config-valid'), 'pass');
  assert.equal(statusOf(text, 'lockfile-present'), 'pass');
  assert.equal(statusOf(text, 'lockfile-valid'), 'pass');
  assert.equal(statusOf(text, 'notion-token-env'), 'skip');
  assert.equal(statusOf(text, 'notion-token-valid'), 'skip');
  assert.equal(statusOf(text, 'notion-database-access'), 'skip');
  assert.equal(statusOf(text, 'gitignore-config'), 'skip');
  assert.equal(statusOf(text, 'gitignore-local-settings'), 'pass');
  assert.equal(statusOf(text, 'settings-json-present'), 'pass');
  assert.equal(statusOf(text, 'settings-json-hooks'), 'pass');
});

test('happy path: claude + notion=true with mocked /users/me + /databases', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-notion.yaml');
  writeGitignore(consumer, ['spovishun-skills.config.yaml', '.claude/settings.local.json']);

  const fetchImpl = fakeFetch([
    { match: (u) => u.includes('/users/me'), response: jsonResponse(200, { id: 'u_1' }) },
    { match: (u) => u.includes('/databases/'), response: jsonResponse(200, { id: 'db_1' }) },
  ]);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: { NOTION_TOKEN: 'secret_abc' }, out, fetchImpl });
  const text = out.text();

  assert.equal(ok, true, `expected pass, output was:\n${text}`);
  assert.equal(statusOf(text, 'notion-token-env'), 'pass');
  assert.equal(statusOf(text, 'notion-token-valid'), 'pass');
  assert.equal(statusOf(text, 'notion-database-access'), 'pass');
  assert.equal(statusOf(text, 'gitignore-config'), 'pass');
});

test('missing config → check 1 fails, check 2 skipped, downstream still evaluated', async () => {
  const consumer = makeConsumer();
  writeGitignore(consumer, ['.claude/settings.local.json']);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'config-present'), 'fail');
  assert.equal(statusOf(text, 'config-valid'), 'skip');
  assert.equal(statusOf(text, 'lockfile-present'), 'fail');
});

test('missing lockfile → check 3 fails, gitignore + settings still evaluated', async () => {
  const consumer = makeConsumer();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  writeGitignore(consumer, ['.claude/settings.local.json']);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'config-present'), 'pass');
  assert.equal(statusOf(text, 'lockfile-present'), 'fail');
  assert.equal(statusOf(text, 'lockfile-valid'), 'skip');
  assert.equal(statusOf(text, 'gitignore-local-settings'), 'pass');
  // settings-json checks skipped because target is unknown
  assert.equal(statusOf(text, 'settings-json-present'), 'skip');
});

test('notion=true but token env unset → check 5 fails, 6+7 skipped', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-notion.yaml');
  writeGitignore(consumer, ['spovishun-skills.config.yaml', '.claude/settings.local.json']);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'notion-token-env'), 'fail');
  assert.equal(statusOf(text, 'notion-token-valid'), 'skip');
  assert.equal(statusOf(text, 'notion-database-access'), 'skip');
});

test('notion token invalid (401) → check 6 fails, check 7 skipped', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-notion.yaml');
  writeGitignore(consumer, ['spovishun-skills.config.yaml', '.claude/settings.local.json']);

  const fetchImpl = fakeFetch([
    { match: (u) => u.includes('/users/me'), response: jsonResponse(401, { message: 'API token is invalid' }) },
  ]);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: { NOTION_TOKEN: 'bad' }, out, fetchImpl });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'notion-token-env'), 'pass');
  assert.equal(statusOf(text, 'notion-token-valid'), 'fail');
  assert.equal(statusOf(text, 'notion-database-access'), 'skip');
});

test('notion database 404 → check 7 fails', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-notion.yaml');
  writeGitignore(consumer, ['spovishun-skills.config.yaml', '.claude/settings.local.json']);

  const fetchImpl = fakeFetch([
    { match: (u) => u.includes('/users/me'), response: jsonResponse(200, { id: 'u_1' }) },
    { match: (u) => u.includes('/databases/'), response: jsonResponse(404, { message: 'Database not found' }) },
  ]);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: { NOTION_TOKEN: 'tok' }, out, fetchImpl });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'notion-token-valid'), 'pass');
  assert.equal(statusOf(text, 'notion-database-access'), 'fail');
});

test('.gitignore missing config entry → check 8 fails (when notion=true)', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-notion.yaml');
  writeGitignore(consumer, ['.claude/settings.local.json']); // missing config.yaml

  const fetchImpl = fakeFetch([
    { match: () => true, response: jsonResponse(200, {}) },
  ]);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: { NOTION_TOKEN: 'tok' }, out, fetchImpl });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'gitignore-config'), 'fail');
  assert.equal(statusOf(text, 'gitignore-local-settings'), 'pass');
});

test('.gitignore missing local-settings entry → check 9 fails', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-no-notion.yaml');
  writeGitignore(consumer, ['some-other-file']);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'gitignore-local-settings'), 'fail');
});

test('settings.json malformed → check 10 fails, 11 skipped', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-no-notion.yaml');
  writeGitignore(consumer, ['.claude/settings.local.json']);
  writeFileSync(join(consumer, '.claude', 'settings.json'), '{ this is not json', 'utf8');

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'settings-json-present'), 'fail');
  assert.equal(statusOf(text, 'settings-json-hooks'), 'skip');
});

test('settings.json references missing hook script → check 11 fails', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-no-notion.yaml');
  writeGitignore(consumer, ['.claude/settings.local.json']);

  // Inject a fake _spovishun hook entry pointing at a non-existent script
  const settingsPath = join(consumer, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.hooks = settings.hooks ?? {};
  settings.hooks.Stop = [
    {
      _spovishun: true,
      matcher: '',
      hooks: [{ type: 'command', command: 'node .claude/hooks/does-not-exist.js', timeout: 30 }],
    },
  ];
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, false);
  assert.equal(statusOf(text, 'settings-json-present'), 'pass');
  assert.equal(statusOf(text, 'settings-json-hooks'), 'fail');
});

test('settings.json hooks check ignores non-_spovishun entries (user-owned)', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-no-notion.yaml');
  writeGitignore(consumer, ['.claude/settings.local.json']);

  const settingsPath = join(consumer, '.claude', 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.hooks = settings.hooks ?? {};
  // User-added hook (NOT marked) referencing a missing script — should be ignored
  settings.hooks.Stop = [
    { matcher: '', hooks: [{ type: 'command', command: 'node .claude/hooks/user-script.js' }] },
  ];
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, true);
  assert.equal(statusOf(text, 'settings-json-hooks'), 'pass');
});

test('target=windsurf → checks 10–11 skipped', async () => {
  const consumer = makeConsumer();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  await runInstall({
    target: 'windsurf',
    cwd: consumer,
    pkgRoot: FIXTURES_SOURCE,
    out: { write: () => {} },
  });
  writeGitignore(consumer, ['.claude/settings.local.json']);

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, true, `expected pass, got:\n${text}`);
  assert.equal(statusOf(text, 'settings-json-present'), 'skip');
  assert.equal(statusOf(text, 'settings-json-hooks'), 'skip');
});

test('runDoctor returns false on any single failure', async () => {
  const consumer = makeConsumer();
  // No config at all → guaranteed multiple failures
  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  assert.equal(ok, false);
});

test('installed-artifacts: passes after install, reports local edits as detail', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-no-notion.yaml');
  writeGitignore(consumer, ['.claude/settings.local.json']);

  // Local edit must NOT fail the check (supported workflow), only annotate it.
  const { writeFileSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const skillPath = join(consumer, '.claude', 'skills', 'universal-skill', 'SKILL.md');
  writeFileSync(skillPath, readFileSync(skillPath, 'utf8') + '\nlocal edit', 'utf8');

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, true, `expected pass, output was:\n${text}`);
  assert.equal(statusOf(text, 'installed-artifacts'), 'pass');
  assert.ok(findResult(text, 'installed-artifacts').includes('locally modified'), 'local edit must be annotated');
});

test('installed-artifacts: fails when a locked artifact body is missing on disk', async () => {
  const consumer = makeConsumer();
  await installClaudeFully(consumer, 'install-config-no-notion.yaml');
  writeGitignore(consumer, ['.claude/settings.local.json']);

  const { rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  rmSync(join(consumer, '.claude', 'skills', 'universal-skill'), { recursive: true, force: true });

  const out = silentOut();
  const ok = await runDoctor({ cwd: consumer, env: {}, out });
  const text = out.text();

  assert.equal(ok, false, 'doctor must fail when a locked artifact is missing');
  assert.equal(statusOf(text, 'installed-artifacts'), 'fail');
  assert.ok(findResult(text, 'installed-artifacts').includes('skill:universal-skill'));
});
