#!/usr/bin/env node
// Verifies that the vendored copy of marked under
// scripts/notion/lib/vendor/marked.cjs is byte-identical to the marked
// version pinned in the root package.json. Run on every commit (pre-commit
// or CI lint job) so the bundled file does not silently drift from the
// declared dependency.
//
// If the check fails, regenerate the vendor copy:
//   npm install
//   node scripts/vendor-marked.js     (writes vendor/marked.cjs from node_modules)

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const VENDORED = resolve(repoRoot, 'scripts/notion/lib/vendor/marked.cjs');
const UPSTREAM = resolve(repoRoot, 'node_modules/marked/lib/marked.cjs');

function sha(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

if (!existsSync(VENDORED)) {
  process.stderr.write(`Missing vendored copy: ${VENDORED}\n`);
  process.stderr.write(`Run: node scripts/vendor-marked.js\n`);
  process.exit(1);
}
if (!existsSync(UPSTREAM)) {
  // Pre-`npm install` case; skip silently — the CI install step will populate it.
  process.stdout.write(
    `Skip: node_modules/marked not installed yet; run \`npm ci\` first.\n`
  );
  process.exit(0);
}

const vSha = sha(VENDORED);
const uSha = sha(UPSTREAM);

if (vSha !== uSha) {
  process.stderr.write(
    `Vendored marked.cjs is out of sync with the installed marked package.\n` +
    `  vendored: ${vSha}\n` +
    `  upstream: ${uSha}\n` +
    `Run: node scripts/vendor-marked.js (and commit the result).\n`
  );
  process.exit(1);
}
process.stdout.write(`Vendored marked.cjs matches marked@installed (sha256=${vSha.slice(0, 12)}).\n`);
