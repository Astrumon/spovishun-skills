#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import { validateManifest } from '../lib/manifest-validator.js';
import { collectSourcePins, readNoticePins, diffPins } from '../lib/attribution.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_DIRS = ['skills', 'agents', 'templates'];
let failed = 0;

for (const artifactDir of ARTIFACT_DIRS) {
  let names;
  try {
    names = readdirSync(join(repoRoot, artifactDir));
  } catch {
    continue;
  }
  for (const name of names) {
    const dir = join(artifactDir, name);
    if (!statSync(join(repoRoot, dir)).isDirectory()) continue;
    const manifestPath = join(dir, 'manifest.yaml');
    let raw;
    try {
      raw = readFileSync(join(repoRoot, manifestPath), 'utf8');
    } catch {
      continue;
    }
    const result = validateManifest(parseYaml(raw));
    if (result.ok) {
      process.stdout.write(`OK  ${manifestPath}\n`);
    } else {
      failed++;
      process.stderr.write(`ERR ${manifestPath}\n`);
      for (const e of result.errors) {
        process.stderr.write(`   ${e.path}: ${e.message}\n`);
      }
    }
  }
}

// Attribution: a derived artifact declares its upstream files in `source:`, and
// NOTICE.md lists the same pins in human-readable form. Checking both directions
// is what keeps the two registries from drifting apart — neither is generated
// from the other.
const problems = diffPins(collectSourcePins(repoRoot), readNoticePins(repoRoot));
if (problems.length === 0) {
  process.stdout.write(`OK  NOTICE.md matches every manifest source: block\n`);
} else {
  failed++;
  process.stderr.write(`ERR NOTICE.md is out of sync with the manifests\n`);
  for (const p of problems) process.stderr.write(`   ${p}\n`);
}

process.exit(failed === 0 ? 0 : 1);
