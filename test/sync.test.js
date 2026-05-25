import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { runInstall } from '../bin/install.js';
import { runSync } from '../bin/sync.js';
import { LOCKFILE_NAME } from '../lib/lockfile.js';
import { load as parseYaml, CORE_SCHEMA } from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_SOURCE = join(here, 'fixtures', 'source');
const PKG_ROOT = join(here, '..');

function makeConsumerDir() {
  return mkdtempSync(join(tmpdir(), 'sync-test-'));
}

function copyConfig(consumerDir, configName) {
  const src = join(here, 'fixtures', configName);
  const dest = join(consumerDir, 'spovishun-skills.config.yaml');
  cpSync(src, dest);
  return dest;
}

test('sync re-applies after config change (notion flip)', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  await runInstall({ target: 'claude', cwd: consumer, pkgRoot: FIXTURES_SOURCE, out: { write: () => {} } });

  // Notion skill should not be installed initially
  assert.ok(!existsSync(join(consumer, '.claude', 'skills', 'notion-skill.md')));

  // Replace config with the notion-enabled version
  copyConfig(consumer, 'install-config-notion.yaml');

  await runSync({ cwd: consumer, pkgRoot: FIXTURES_SOURCE, out: { write: () => {} } });

  assert.ok(existsSync(join(consumer, '.claude', 'skills', 'notion-skill.md')), 'notion-skill.md should exist after sync with notion=true');
});

test('sync fails without config', async () => {
  const consumer = makeConsumerDir();
  // No config copied
  await assert.rejects(
    () => runSync({ cwd: consumer, out: { write: () => {} } }),
    (err) => {
      assert.ok(err.actionable?.includes('init'), `actionable should mention init: ${err.actionable}`);
      return true;
    }
  );
});

test('sync fails without lockfile', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');
  // No install run — no lockfile
  await assert.rejects(
    () => runSync({ cwd: consumer, out: { write: () => {} } }),
    (err) => {
      assert.ok(err.actionable?.includes('install'), `actionable should mention install: ${err.actionable}`);
      return true;
    }
  );
});

test('sync infers target from lockfile (windsurf)', async () => {
  const consumer = makeConsumerDir();
  copyConfig(consumer, 'install-config-no-notion.yaml');

  await runInstall({ target: 'windsurf', cwd: consumer, pkgRoot: FIXTURES_SOURCE, out: { write: () => {} } });

  // Confirm windsurf rules were written
  assert.ok(existsSync(join(consumer, '.windsurf', 'rules')));

  // Run sync — should re-apply windsurf, not create .claude/
  await runSync({ cwd: consumer, pkgRoot: FIXTURES_SOURCE, out: { write: () => {} } });

  assert.ok(existsSync(join(consumer, '.windsurf', 'rules')), '.windsurf/rules should still exist');
  assert.ok(!existsSync(join(consumer, '.claude', 'skills')), '.claude/ should NOT be created for windsurf target');

  // Verify lockfile still says windsurf
  const lockData = parseYaml(readFileSync(join(consumer, LOCKFILE_NAME), 'utf8'), { schema: CORE_SCHEMA });
  assert.equal(lockData.target, 'windsurf');
});
