import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { NOTION_VERSION as libVersion } from '../lib/notion-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const require = createRequire(import.meta.url);

// The Notion-Version header is pinned in three independent runtimes that
// cannot share a module: the ESM lib (doctor/init), the CJS scripts tree
// (installed into .claude/scripts/notion/), and the standalone hook. This
// guard keeps the three copies from drifting when the API version is bumped.
test('Notion-Version header is identical across lib, scripts, and hook', () => {
  const scriptsVersion = require(
    join(PKG_ROOT, 'scripts', 'notion', 'lib', 'constants.js')
  ).NOTION_VERSION;

  const hookSource = readFileSync(join(PKG_ROOT, 'hooks', 'notion-task-inject.js'), 'utf8');
  const m = hookSource.match(/'Notion-Version':\s*'([\d-]+)'/);
  assert.ok(m, 'hook must pin a Notion-Version header');

  assert.equal(scriptsVersion, libVersion, 'scripts/notion/lib/constants.js diverged from lib/notion-client.js');
  assert.equal(m[1], libVersion, 'hooks/notion-task-inject.js diverged from lib/notion-client.js');
});
