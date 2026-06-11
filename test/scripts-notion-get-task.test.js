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

// scripts/notion/get-task.js is CommonJS. The module exports the pure helpers
// (normalizeTaskArg, renderText, VALID_FORMATS) and only invokes main() when
// loaded directly via `node get-task.js` — see the `require.main === module`
// guard. Each test runs in its own cwd + clean module cache so projectPrefix()
// reads a fresh consumer config / env on every call.

function withSandbox(envOverrides, configBody, fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'get-task-test-'));
  if (configBody !== null) {
    writeFileSync(join(cwd, 'spovishun-skills.config.yaml'), configBody, 'utf8');
  }
  const oldCwd = process.cwd();
  const oldEnv = {};
  for (const k of Object.keys(envOverrides)) {
    oldEnv[k] = process.env[k];
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  process.chdir(cwd);

  // Force a fresh require so the modules that read cwd/env do so for *this* test.
  const root = join(PKG_ROOT, 'scripts', 'notion');
  for (const m of [
    'get-task.js',
    'lib/project-prefix.js',
    'lib/config-reader.js',
    'lib/constants.js',
  ]) {
    const p = require.resolve(join(root, m));
    delete require.cache[p];
  }

  try {
    return fn(require(join(root, 'get-task.js')));
  } finally {
    process.chdir(oldCwd);
    for (const [k, v] of Object.entries(oldEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('normalizeTaskArg: bare number is rewritten to "<prefix>-<N>"', () => {
  withSandbox(
    { PROJECT_PREFIX: 'spovishun' },
    null,
    ({ normalizeTaskArg }) => {
      assert.equal(normalizeTaskArg('93'), 'spovishun-93');
      assert.equal(normalizeTaskArg('1'), 'spovishun-1');
      assert.equal(normalizeTaskArg('00042'), 'spovishun-00042'); // leading zeros preserved
    }
  );
});

test('normalizeTaskArg: prefixed task id passes through unchanged', () => {
  withSandbox(
    { PROJECT_PREFIX: 'spovishun' },
    null,
    ({ normalizeTaskArg }) => {
      assert.equal(normalizeTaskArg('spovishun-42'), 'spovishun-42');
      assert.equal(normalizeTaskArg('SPOVISHUN-7'), 'SPOVISHUN-7');
    }
  );
});

test('normalizeTaskArg: a pageId-shaped string is not touched', () => {
  withSandbox(
    { PROJECT_PREFIX: 'spovishun' },
    null,
    ({ normalizeTaskArg }) => {
      const compact = 'aaaaaaaa11111111bbbbbbbb22222222';
      const dashed = '12345678-1234-1234-1234-123456789012';
      assert.equal(normalizeTaskArg(compact), compact);
      assert.equal(normalizeTaskArg(dashed), dashed);
    }
  );
});

test('normalizeTaskArg: derives prefix from consumer config when env unset', () => {
  withSandbox(
    { PROJECT_PREFIX: undefined },
    'project:\n  name: "Acme Bot"\n',
    ({ normalizeTaskArg }) => {
      assert.equal(normalizeTaskArg('19'), 'acme-bot-19');
    }
  );
});

test('normalizeTaskArg: normalized value matches the board-lookup regex', () => {
  withSandbox(
    { PROJECT_PREFIX: 'myapp' },
    null,
    ({ normalizeTaskArg }) => {
      const { taskIdRegex } = require(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'project-prefix.js'));
      // After normalization, a bare number must match the regex that drives
      // the board query path in resolvePageId — otherwise the fallback would
      // send it to toDashed() and fail with an invalid uuid error.
      assert.ok(taskIdRegex().test(normalizeTaskArg('42')));
    }
  );
});

test('VALID_FORMATS now includes "text" (parity with get-board.js / list-epics.js)', () => {
  withSandbox(
    { PROJECT_PREFIX: 'x' },
    null,
    ({ VALID_FORMATS }) => {
      assert.deepEqual(VALID_FORMATS, ['json', 'md', 'text']);
    }
  );
});

test('renderText: plain human summary contains title + status + branch and is NOT JSON', () => {
  withSandbox(
    { PROJECT_PREFIX: 'x' },
    null,
    ({ renderText }) => {
      const out = renderText({
        title: 'feature/x-93: Wire foo into bar',
        status: 'In progress',
        priority: 'High',
        branch: 'feature/x-93-wire-foo',
        epic: { id: 'eee', title: 'Foo Epic' },
        blockedBy: [{ id: 'b1', title: 'Earlier Task' }],
        content: 'Goal\n\nDo the thing.',
      });

      assert.ok(out.includes('feature/x-93: Wire foo into bar'), 'title');
      assert.ok(out.includes('In progress | High | feature/x-93-wire-foo'), 'meta line');
      assert.ok(out.includes('Epic: Foo Epic'), 'epic line');
      assert.ok(out.includes('Earlier Task'), 'blocker line');
      assert.ok(out.includes('Goal'), 'content body');
      // Sanity: this must be human text, not JSON.
      assert.throws(() => JSON.parse(out), /JSON/);
    }
  );
});

test('renderText: omits optional sections cleanly when fields are absent', () => {
  withSandbox(
    { PROJECT_PREFIX: 'x' },
    null,
    ({ renderText }) => {
      const out = renderText({
        title: 'Bare task',
        status: null,
        priority: null,
        branch: null,
        epic: null,
        blockedBy: [],
        content: '',
      });
      assert.equal(out.trim(), 'Bare task');
    }
  );
});

test('renderText/renderMd: stage appears in the meta line when set (Board v2)', () => {
  withSandbox(
    { PROJECT_PREFIX: 'x' },
    null,
    ({ renderText, renderMd }) => {
      const task = {
        title: 'feature/x-93: Wire foo into bar',
        status: 'In progress',
        stage: 'Sprint',
        priority: 'High',
        branch: 'feature/x-93-wire-foo',
        epic: null,
        blockedBy: [],
        content: '',
      };
      assert.ok(renderText(task).includes('In progress | Sprint | High'), 'text meta line');
      assert.ok(renderMd(task).includes('In progress | Sprint | High'), 'md meta line');
    }
  );
});

test('renderText/renderMd: null stage leaves the meta line unchanged (Board v1)', () => {
  withSandbox(
    { PROJECT_PREFIX: 'x' },
    null,
    ({ renderText, renderMd }) => {
      const task = {
        title: 'feature/x-93: Wire foo into bar',
        status: 'In progress',
        stage: null,
        priority: 'High',
        branch: 'feature/x-93-wire-foo',
        epic: null,
        blockedBy: [],
        content: '',
      };
      assert.ok(renderText(task).includes('In progress | High | feature/x-93-wire-foo'), 'text meta line');
      assert.ok(renderMd(task).includes('In progress | High | feature/x-93-wire-foo'), 'md meta line');
    }
  );
});
