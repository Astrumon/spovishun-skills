#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { validateManifest } from '../lib/manifest-validator.js';

const ARTIFACT_DIRS = ['skills', 'agents'];
let failed = 0;

for (const artifactDir of ARTIFACT_DIRS) {
  let names;
  try {
    names = readdirSync(artifactDir);
  } catch {
    continue;
  }
  for (const name of names) {
    const dir = join(artifactDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, 'manifest.yaml');
    let raw;
    try {
      raw = readFileSync(manifestPath, 'utf8');
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

process.exit(failed === 0 ? 0 : 1);
