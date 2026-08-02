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

// The Notion-Version header is pinned in two runtimes that cannot share a
// module: the ESM lib (doctor/init) and the CommonJS hook tree, which ships
// into .claude/ without a node_modules. The scripts tree re-exports the hook's
// copy, so only the ESM↔CJS boundary is a genuine duplication now — and this
// guard is what keeps the two sides together when the API version is bumped.
test('Notion-Version is identical across lib, hooks, and scripts', () => {
  const hookVersion = require(join(PKG_ROOT, 'hooks', 'notion-constants.js')).NOTION_VERSION;
  const scriptsVersion = require(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'constants.js')).NOTION_VERSION;

  assert.equal(hookVersion, libVersion, 'hooks/notion-constants.js diverged from lib/notion-client.js');
  assert.equal(scriptsVersion, hookVersion, 'scripts/notion/lib/constants.js must re-export the hook constant');
});

// The header the hook actually sends has to be the constant, not a literal that
// happens to match today.
test('the hook sends the pinned version rather than its own literal', () => {
  const shared = require(join(PKG_ROOT, 'hooks', 'notion-constants.js'));
  const api = require(join(PKG_ROOT, 'hooks', 'notion-api.js'));
  assert.equal(api.NOTION_VERSION, shared.NOTION_VERSION);

  const src = readFileSync(join(PKG_ROOT, 'hooks', 'notion-api.js'), 'utf8');
  assert.match(src, /'Notion-Version': NOTION_VERSION/);
});
