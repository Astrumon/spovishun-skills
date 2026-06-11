import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// scripts/notion/get-board.js is CommonJS. It exports the pure helpers
// (parseArgs, mapPageRaw, renderMd, renderText) and only invokes main() when
// run directly — see the `require.main === module` guard.
const getBoard = require(join(here, '..', 'scripts', 'notion', 'get-board.js'));
const { queryByPriorityTier } = require(join(here, '..', 'scripts', 'notion', 'lib', 'query-tasks.js'));

function page({ title, status, stage, priority }) {
  return {
    id: 'aaaaaaaa-1111-2222-3333-bbbbbbbbcccc',
    properties: {
      Name: { title: [{ plain_text: title }] },
      ...(status ? { Status: { status: { name: status } } } : {}),
      ...(stage ? { Stage: { select: { name: stage } } } : {}),
      ...(priority ? { Priority: { select: { name: priority } } } : {}),
    },
  };
}

function task(overrides = {}) {
  return {
    id: 'aaaaaaaa-1111-2222-3333-bbbbbbbbcccc',
    title: 'feature/x-1: demo',
    status: 'To do',
    stage: null,
    branch: null,
    priority: 'Medium',
    epic: null,
    blockedBy: [],
    ...overrides,
  };
}

test('parseArgs: --stage and --stage= forms are parsed; default is null', () => {
  assert.equal(getBoard.parseArgs([]).stage, null);
  assert.equal(getBoard.parseArgs(['--stage', 'Sprint']).stage, 'Sprint');
  assert.equal(getBoard.parseArgs(['--stage=Backlog']).stage, 'Backlog');
});

test('parseArgs: stage value is returned verbatim (validation happens in main)', () => {
  // parseArgs does not validate; VALID_STAGES is the contract main() enforces.
  assert.equal(getBoard.parseArgs(['--stage', 'bogus']).stage, 'bogus');
  assert.deepEqual(getBoard.VALID_STAGES, ['Backlog', 'Sprint', 'Archive']);
});

test('mapPageRaw: extracts Stage when present, null when the property is absent (Board v1)', () => {
  const withStage = getBoard.mapPageRaw(page({ title: 't', stage: 'Sprint' }));
  assert.equal(withStage.stage, 'Sprint');

  const withoutStage = getBoard.mapPageRaw(page({ title: 't' }));
  assert.equal(withoutStage.stage, null);
});

test('renderMd: Stage column appears when any task has a stage', () => {
  const out = getBoard.renderMd([task({ stage: 'Sprint' }), task({ stage: null })]);
  const lines = out.split('\n');
  assert.match(lines[0], /\| Stage \|/);
  assert.match(lines[2], /\| Sprint \|/);
});

test('renderMd: no Stage column on Board v1 (all stages null, no filter)', () => {
  const out = getBoard.renderMd([task(), task()]);
  assert.doesNotMatch(out, /Stage/);
});

test('renderMd: --stage filter forces the column even when rows came back empty-staged', () => {
  const out = getBoard.renderMd([task()], 'Sprint');
  assert.match(out.split('\n')[0], /\| Stage \|/);
});

test('renderText: Stage column appears only with stage data', () => {
  const withStage = getBoard.renderText([task({ stage: 'Backlog' })]);
  assert.match(withStage.split('\n')[0], /Stage/);
  assert.match(withStage.split('\n')[2], /Backlog/);

  const withoutStage = getBoard.renderText([task()]);
  assert.doesNotMatch(withoutStage, /Stage/);
});

test('queryByPriorityTier: extraFilter is AND-combined into tier queries and the fallback', async () => {
  const captured = [];
  const stubHttp = {
    post: async (_token, _path, body) => {
      captured.push(body);
      return { results: [] };
    },
  };
  const stageFilter = { property: 'Stage', select: { equals: 'Sprint' } };
  await queryByPriorityTier(stubHttp, 'tok', 'To do', new Set(), stageFilter);

  // 3 tier queries + 1 fallback
  assert.equal(captured.length, 4);
  for (const body of captured.slice(0, 3)) {
    assert.ok(body.filter.and.some(f => f.property === 'Stage'), 'tier query must carry the Stage filter');
  }
  assert.deepEqual(captured[3].filter.and, [
    { property: 'Status', status: { equals: 'To do' } },
    stageFilter,
  ]);
});

test('queryByPriorityTier: without extraFilter the query shapes are unchanged (backward compat)', async () => {
  const captured = [];
  const stubHttp = {
    post: async (_token, _path, body) => {
      captured.push(body);
      return { results: [] };
    },
  };
  await queryByPriorityTier(stubHttp, 'tok', 'To do', new Set());

  assert.equal(captured.length, 4);
  for (const body of captured.slice(0, 3)) {
    assert.equal(body.filter.and.length, 2, 'tier query must contain only Status + Priority');
  }
  assert.deepEqual(captured[3].filter, { property: 'Status', status: { equals: 'To do' } });
});
