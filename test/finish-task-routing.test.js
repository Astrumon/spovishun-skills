import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = join(repoRoot, 'skills', 'finish-task');
const body = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
const manifest = parseYaml(readFileSync(join(skillDir, 'manifest.yaml'), 'utf8'));

// Routing targets that deliberately do NOT ship with this package. They are the
// reason Step 5b resolves by presence instead of by id: a table nailed to
// spovishun-skills ids could never see a skill living in the user's
// ~/.claude/skills/ or in another plugin. Adding a row here is a decision, not
// a fix for a red test.
const EXTERNAL_TARGETS = new Set([
  'kotlin-coroutines-expert',
  'kotlin-code-review',
  'thermo-nuclear-code-quality-review',
]);

/** Backticked ids in the "Candidates (first available wins)" column of Step 5b. */
function routingTargets(markdown) {
  const table = markdown.split('#### Step 5b')[1]?.split('#### Step 5c')[0];
  assert.ok(table, 'SKILL.md must still contain a Step 5b section with the routing table');

  const ids = new Set();
  for (const line of table.split('\n')) {
    if (!line.startsWith('|')) continue;
    const candidates = line.split('|')[2];
    if (!candidates) continue;
    for (const [, id] of candidates.matchAll(/`([a-z][a-z0-9-]*[a-z0-9])`/g)) ids.add(id);
  }
  return ids;
}

test('finish-task stays universal — narrowing it would delete the skill from non-Kotlin projects', () => {
  assert.equal(manifest.category, 'universal');
  assert.equal(manifest.requires, undefined);
});

test('PROJECT_LANGUAGE is declared in the manifest and actually used in the body', () => {
  const keys = (manifest.placeholders ?? []).map((p) => p.key);
  assert.ok(keys.includes('PROJECT_LANGUAGE'), 'manifest must declare PROJECT_LANGUAGE');
  assert.ok(body.includes('{{PROJECT_LANGUAGE}}'), 'SKILL.md must interpolate PROJECT_LANGUAGE');
});

test('the routing table is non-trivial and every in-package target exists on disk', () => {
  const targets = routingTargets(body);
  assert.ok(targets.size >= 10, `expected the routing table to name 10+ ids, got ${targets.size}`);

  for (const id of targets) {
    if (EXTERNAL_TARGETS.has(id)) continue;
    const isSkill = existsSync(join(repoRoot, 'skills', id, 'SKILL.md'));
    const isAgent = existsSync(join(repoRoot, 'agents', id, 'AGENT.md'));
    assert.ok(
      isSkill || isAgent,
      `Routing target \`${id}\` is neither a skill nor an agent in this package. ` +
        `Rename the row, drop it, or add the id to EXTERNAL_TARGETS if it ships elsewhere.`
    );
  }
});

test('every external routing target is genuinely absent from this package', () => {
  for (const id of EXTERNAL_TARGETS) {
    assert.ok(
      !existsSync(join(repoRoot, 'skills', id)) && !existsSync(join(repoRoot, 'agents', id)),
      `\`${id}\` now ships in this package — remove it from EXTERNAL_TARGETS.`
    );
  }
});
