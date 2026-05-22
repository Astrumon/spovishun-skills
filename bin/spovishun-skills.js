#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    `spovishun-skills v${pkg.version}\n` +
    `\n` +
    `Usage:\n` +
    `  spovishun-skills --version   Print the installed version\n` +
    `  spovishun-skills --help      Show this help\n` +
    `\n` +
    `Commands will be added in upcoming tasks (init, install, sync, update, doctor).\n`
  );
  process.exit(0);
}

process.stderr.write(`Unknown command: ${args.join(' ')}\n`);
process.stderr.write(`Run 'spovishun-skills --help' for usage.\n`);
process.exit(1);
