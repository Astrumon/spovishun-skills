#!/usr/bin/env node
// Re-vendors marked from node_modules/marked/lib/marked.cjs into
// scripts/notion/lib/vendor/marked.cjs. Run after every `npm install` /
// `npm update marked` and commit the result. The bundled file is what the
// installed CLI scripts in consumer projects actually require — keeping it in
// sync with the pinned dep is enforced by scripts/check-vendored-marked.js.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const UPSTREAM = resolve(repoRoot, 'node_modules/marked/lib/marked.cjs');
const VENDORED = resolve(repoRoot, 'scripts/notion/lib/vendor/marked.cjs');

if (!existsSync(UPSTREAM)) {
  process.stderr.write(
    `Missing ${UPSTREAM}. Run \`npm install\` first.\n`
  );
  process.exit(1);
}

mkdirSync(dirname(VENDORED), { recursive: true });
copyFileSync(UPSTREAM, VENDORED);
process.stdout.write(`Wrote vendored copy: ${VENDORED}\n`);
