import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const require = createRequire(import.meta.url);
const LOAD_TOKEN_PATH = join(PKG_ROOT, 'scripts', 'notion', 'lib', 'load-token.js');

// loadToken reads env first, then .env in process.cwd(). It has no module-level
// state, so a fresh require per case isn't required — but cwd + env must be
// controlled and restored.
function withEnv(envOverrides, envFileBody, fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'load-token-'));
  if (envFileBody !== null) writeFileSync(join(cwd, '.env'), envFileBody, 'utf8');
  const oldCwd = process.cwd();
  const keys = ['NOTION_TOKEN', 'NOTION_SKILLS_TOKEN'];
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  process.chdir(cwd);
  try {
    return fn();
  } finally {
    process.chdir(oldCwd);
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('env precedence: NOTION_TOKEN wins over NOTION_SKILLS_TOKEN', () => {
  const { loadToken } = require(LOAD_TOKEN_PATH);
  const token = withEnv({ NOTION_TOKEN: 'primary', NOTION_SKILLS_TOKEN: 'skills' }, null, loadToken);
  assert.equal(token, 'primary');
});

test('.env file precedence: NOTION_TOKEN wins over NOTION_SKILLS_TOKEN', () => {
  const { loadToken } = require(LOAD_TOKEN_PATH);
  const token = withEnv(
    {},
    'NOTION_SKILLS_TOKEN=skills\nNOTION_TOKEN=primary\n',
    loadToken
  );
  assert.equal(token, 'primary');
});

test('CRLF .env file is parsed (Windows)', () => {
  const { loadToken } = require(LOAD_TOKEN_PATH);
  const token = withEnv({}, 'NOTION_TOKEN=secret-crlf\r\nOTHER=x\r\n', loadToken);
  assert.equal(token, 'secret-crlf');
});

test('CRLF .env file: falls back to NOTION_SKILLS_TOKEN when no NOTION_TOKEN', () => {
  const { loadToken } = require(LOAD_TOKEN_PATH);
  const token = withEnv({}, 'NOTION_SKILLS_TOKEN=skills-crlf\r\n', loadToken);
  assert.equal(token, 'skills-crlf');
});
