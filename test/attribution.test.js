import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourcePins, readNoticePins, diffPins } from '../lib/attribution.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same encoding lib/attribution.js uses internally: path, NUL, sha. Built with
// fromCharCode so the separator survives every editor and diff tool intact.
const SEP = String.fromCharCode(0);
const pin = (char) => ['up/SKILL.md', char.repeat(40)].join(SEP);
// `collectSourcePins` shape: one artifact, one or more upstream repos.
const sourced = (...pinSets) => ({
  sources: pinSets.map((pins, i) => ({ repo: `owner/repo-${i}`, pins: new Set(pins) })),
});

test('NOTICE.md and every manifest source: block agree', () => {
  // The same predicate `npm run lint` uses. Duplicated into the test suite on
  // purpose: a forgotten NOTICE row is a licensing defect, so it should fail
  // `npm test` too, not only the lint job.
  const problems = diffPins(collectSourcePins(PKG_ROOT), readNoticePins(PKG_ROOT));
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('NOTICE.md names every upstream project and its licence', () => {
  const notice = readFileSync(join(PKG_ROOT, 'NOTICE.md'), 'utf8');
  assert.match(notice, /rcosteira79\/android-skills/);
  assert.match(notice, /MIT License/);
  assert.match(notice, /Copyright \(c\) 2026 Ricardo Costeira/);
  // Apache-2.0 §4(d): a derivative work must carry the upstream NOTICE text.
  assert.match(notice, /skydoves\/compose-stability-analyzer/);
  assert.match(notice, /Apache License, Version 2\.0/);
  assert.match(notice, /Copyright 2026 skydoves \(Jaewoong Eum\)/);
});

test('every pinned artifact records the ref its SHAs were read at', () => {
  const pins = collectSourcePins(PKG_ROOT);
  assert.ok(pins.size > 0, 'no derived artifacts found — the walk is broken');
  for (const [artifact, { sources }] of pins) {
    assert.ok(sources.length > 0, `${artifact}: source: resolved to no entries`);
    for (const entry of sources) {
      assert.ok(entry.repo, `${artifact}: source.repo is required`);
      assert.match(
        entry.ref ?? '',
        /^[0-9a-f]{40}$/,
        `${artifact}: source.ref should pin a full commit sha`
      );
    }
  }
});

test('an array source: keeps one repo per entry', () => {
  // skills/compose-multiplatform is the two-upstream case: the body came from
  // rcosteira79/android-skills, the stability-baselines reference from
  // skydoves/compose-stability-analyzer. Each entry must stay separately
  // addressable or check-upstream-drift.js queries the wrong repository.
  const { sources } = collectSourcePins(PKG_ROOT).get('skills/compose-multiplatform');
  assert.equal(sources.length, 2);
  assert.deepEqual(
    sources.map((s) => s.repo).sort(),
    ['rcosteira79/android-skills', 'skydoves/compose-stability-analyzer']
  );
});

test('a manifest declaring source: is reported when NOTICE.md omits it', () => {
  const source = new Map([['skills/example', sourced([pin('a')])]]);
  const problems = diffPins(source, new Map());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no row in NOTICE\.md/);
});

test('a NOTICE.md row with no matching manifest is reported', () => {
  const notice = new Map([['skills/ghost', new Set([pin('a')])]]);
  const problems = diffPins(new Map(), notice);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /declares no source:/);
});

test('a stale SHA on one side is reported from both directions', () => {
  const id = 'skills/example';
  const source = new Map([[id, sourced([pin('a')])]]);
  const notice = new Map([[id, new Set([pin('b')])]]);
  const problems = diffPins(source, notice);
  assert.equal(problems.length, 2, 'missing-here and absent-there should both surface');
});

test('pins from every source are unioned before comparing to NOTICE.md', () => {
  // NOTICE.md keys rows by artifact, not by repo, so a two-upstream artifact
  // has one merged row set there. Comparing per-source would report each
  // repo's pins as missing from the other's section.
  const id = 'skills/example';
  const source = new Map([[id, sourced([pin('a')], [pin('b')])]]);
  const notice = new Map([[id, new Set([pin('a'), pin('b')])]]);
  assert.deepEqual(diffPins(source, notice), []);
});
