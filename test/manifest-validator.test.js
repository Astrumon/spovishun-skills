import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { validateManifest } from '../lib/manifest-validator.js';

const VALID_BASE = {
  id: 'sample-skill',
  version: '1.0.0',
  category: 'universal',
  description: 'A sample skill used in tests with enough length for description.'
};

test('happy path: minimal valid manifest', () => {
  const r = validateManifest(VALID_BASE);
  assert.equal(r.ok, true);
});

test('happy path: all reference manifests pass', () => {
  const skillsDir = 'skills';
  let checked = 0;
  for (const name of readdirSync(skillsDir)) {
    const dir = join(skillsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'manifest.yaml');
    let raw;
    try {
      raw = readFileSync(manifestPath, 'utf8');
    } catch {
      continue;
    }
    checked++;
    const result = validateManifest(parseYaml(raw));
    assert.equal(
      result.ok,
      true,
      `${manifestPath} should be valid: ${JSON.stringify(result.errors)}`
    );
  }
  assert.ok(checked >= 5, `Expected at least 5 reference manifests, found ${checked}`);
});

test('error: missing required field "id"', () => {
  const { id, ...m } = VALID_BASE;
  const r = validateManifest(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Missing required field: "id"/.test(e.message)));
});

test('error: invalid category', () => {
  const r = validateManifest({ ...VALID_BASE, category: 'stack-spec' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Must be one of/.test(e.message)));
});

test('error: stack-specific without requires', () => {
  const r = validateManifest({ ...VALID_BASE, category: 'stack-specific' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Missing required field: "requires"/.test(e.message)));
});

test('error: universal with requires is forbidden', () => {
  const r = validateManifest({ ...VALID_BASE, requires: ['kotlin'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Forbidden field/.test(e.message)));
});

test('happy: kmp is an accepted requires flag', () => {
  const r = validateManifest({
    ...VALID_BASE,
    category: 'stack-specific',
    requires: ['kotlin', 'kmp']
  });
  assert.equal(r.ok, true);
});

test('error: invalid requires value', () => {
  const r = validateManifest({
    ...VALID_BASE,
    category: 'stack-specific',
    requires: ['rust']
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Must be one of/.test(e.message)));
});

test('error: version not semver', () => {
  const r = validateManifest({ ...VALID_BASE, version: '1.0' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Invalid semver/.test(e.message)));
});

test('error: unknown field (typo detection)', () => {
  const r = validateManifest({ ...VALID_BASE, triggrs: { en: ['x'] } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Unknown field/.test(e.message)));
});

// --- source: upstream provenance for derived artifacts -----------------------

const SOURCE = {
  repo: 'rcosteira79/android-skills',
  ref: '6373e59c1dcdb28fe94649e7db59055a5052f4db',
  files: [{ path: 'plugins/android-skills/skills/koin/SKILL.md', sha: 'f'.repeat(40) }]
};

test('happy: source is optional', () => {
  assert.equal(validateManifest(VALID_BASE).ok, true);
});

test('happy: a well-formed source block validates', () => {
  const r = validateManifest({ ...VALID_BASE, source: SOURCE });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('happy: source.ref is optional', () => {
  const { ref, ...noRef } = SOURCE;
  assert.equal(validateManifest({ ...VALID_BASE, source: noRef }).ok, true);
});

test('happy: source may pin several upstream files', () => {
  const files = [
    { path: 'a/SKILL.md', sha: 'a'.repeat(40) },
    { path: 'b/SKILL.md', sha: 'b'.repeat(40) }
  ];
  assert.equal(validateManifest({ ...VALID_BASE, source: { ...SOURCE, files } }).ok, true);
});

test('error: source without repo', () => {
  const { repo, ...noRepo } = SOURCE;
  const r = validateManifest({ ...VALID_BASE, source: noRepo });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Missing required field: "repo"/.test(e.message)));
});

test('error: a pinned file without a sha', () => {
  const r = validateManifest({
    ...VALID_BASE,
    source: { ...SOURCE, files: [{ path: 'a/SKILL.md' }] }
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /Missing required field: "sha"/.test(e.message)));
});

test('error: sha that is not a 40-char hex blob id', () => {
  for (const sha of ['abc123', 'F'.repeat(40), 'a'.repeat(41)]) {
    const r = validateManifest({
      ...VALID_BASE,
      source: { ...SOURCE, files: [{ path: 'a/SKILL.md', sha }] }
    });
    assert.equal(r.ok, false, `${sha} should be rejected`);
    assert.ok(r.errors.some((e) => /does not match pattern/.test(e.message)));
  }
});

test('error: empty files array — a source that pins nothing is not checkable', () => {
  const r = validateManifest({ ...VALID_BASE, source: { ...SOURCE, files: [] } });
  assert.equal(r.ok, false);
});

test('error: unknown key inside source (typo detection)', () => {
  const r = validateManifest({ ...VALID_BASE, source: { ...SOURCE, commit: 'abc' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /must NOT have additional properties|Unknown field/.test(e.message)));
});

test('error: repo that is not owner/name', () => {
  const r = validateManifest({ ...VALID_BASE, source: { ...SOURCE, repo: 'android-skills' } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /does not match pattern/.test(e.message)));
});
