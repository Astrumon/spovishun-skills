import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { filterByStack } from '../lib/stack-filter.js';
import { collectRules } from '../lib/rules-loader.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Runs against the real package, not a fixture: the point is to catch a KMP
// artifact that was added with the wrong `requires:` before a consumer does.
const ARTIFACTS = loadArtifacts(PKG_ROOT);

const KMP_ON = { kotlin: true, kmp: true, postgres: false, telegram: false, notion: false, docker: false };
const KOTLIN_ONLY = { ...KMP_ON, kmp: false };

const skillIds = (flags) =>
  filterByStack(ARTIFACTS, flags)
    .filter((a) => a.kind === 'skill')
    .map((a) => a.id);

/** Every skill gated on `kmp`. Update deliberately — this list is the contract. */
const KMP_SKILLS = [
  'compose-multiplatform',
  'kmp-ios-interop',
  'kmp-multiplatform-specialist',
  'kmp-persistence',
  'kmp-testing',
  'koin-kmp',
  'ktor-client-kmp',
  'new-feature',
];

test('stack.kmp installs exactly the expected skill set', () => {
  const installed = skillIds(KMP_ON);
  const gated = installed.filter((id) => !skillIds(KOTLIN_ONLY).includes(id));
  assert.deepEqual(gated.sort(), KMP_SKILLS, 'the kmp-gated skill set changed — update this list on purpose');
});

test('no kmp-gated skill installs when the flag is off', () => {
  const installed = skillIds(KOTLIN_ONLY);
  for (const id of KMP_SKILLS) {
    assert.ok(!installed.includes(id), `${id} must not install without stack.kmp`);
  }
});

test('every kmp-gated skill requires kotlin as well', () => {
  // `kmp` alone is meaningless: these skills are all Kotlin. Requiring both keeps
  // a KMP skill from landing in a project that only ticked kmp by mistake.
  const kmpOnly = { ...KOTLIN_ONLY, kotlin: false, kmp: true };
  for (const id of KMP_SKILLS) {
    assert.ok(!skillIds(kmpOnly).includes(id), `${id} should also require kotlin`);
  }
});

test('the six adapted skills carry a source: block and exist on disk', () => {
  const adapted = [
    'compose-multiplatform',
    'kmp-ios-interop',
    'kmp-persistence',
    'kmp-testing',
    'koin-kmp',
    'ktor-client-kmp',
  ];

  for (const id of adapted) {
    const artifact = ARTIFACTS.find((a) => a.kind === 'skill' && a.id === id);
    assert.ok(artifact, `${id} should be loadable`);
    assert.ok(artifact.manifest.source, `${id} is adapted from upstream and must declare source:`);
    assert.ok(existsSync(join(PKG_ROOT, 'skills', id, 'SKILL.md')), `${id}/SKILL.md should exist`);
  }
});

test('compose-multiplatform ships its four references as supporting files', () => {
  const artifact = ARTIFACTS.find((a) => a.id === 'compose-multiplatform');
  const refs = artifact.files.map((f) => f.relPath).filter((p) => p.startsWith('references/'));
  assert.deepEqual(refs.sort(), [
    'references/lists-and-scrolling.md',
    'references/modifiers-and-layout.md',
    'references/performance-and-stability.md',
    'references/state-management.md',
  ]);
});

test('stack.kmp ships the whole rules/kmp group', () => {
  const ids = collectRules(PKG_ROOT, KMP_ON).map((r) => r.id);
  assert.deepEqual(ids.filter((id) => id.startsWith('kmp/')).sort(), [
    'kmp/architecture',
    'kmp/feature-structure',
    'kmp/localization',
    'kmp/modularization',
    'kmp/navigation',
    'kmp/networking',
    'kmp/persistence',
    'kmp/testing',
    'kmp/uikit',
  ]);
});
