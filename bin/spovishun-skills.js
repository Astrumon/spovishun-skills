#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { load as parseYaml } from 'js-yaml';
import { createPromptModule } from 'inquirer';
import { validateManifest } from '../lib/manifest-validator.js';
import { runInit } from './init.js';
import { runInstall } from './install.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

const [, , subcommand, ...rest] = process.argv;

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

if (!subcommand || subcommand === '--help' || subcommand === '-h') {
  printHelp(pkg);
  process.exit(0);
}

switch (subcommand) {
  case 'validate':
    process.exit(runValidate(rest));
  case 'init':
    runInit({ cwd: process.cwd(), prompter: createPromptModule(), out: process.stdout })
      .then(() => process.exit(0))
      .catch((err) => {
        process.stderr.write(`init failed: ${err.message}\n`);
        if (err.actionable) process.stderr.write(`  ${err.actionable}\n`);
        process.exit(1);
      });
    break;
  case 'install': {
    const { values: installOpts } = parseArgs({
      args: rest,
      options: { target: { type: 'string' } },
      allowPositionals: false,
    });
    if (!installOpts.target) {
      process.stderr.write(`Error: --target is required.\n`);
      process.stderr.write(`Usage: spovishun-skills install --target=claude\n`);
      process.exit(1);
    }
    runInstall({ target: installOpts.target, cwd: process.cwd(), out: process.stdout })
      .then(() => process.exit(0))
      .catch((err) => {
        process.stderr.write(`install failed: ${err.message}\n`);
        if (err.actionable) process.stderr.write(`  ${err.actionable}\n`);
        process.exit(1);
      });
    break;
  }
  default:
    process.stderr.write(`Unknown command: ${subcommand}\n`);
    process.stderr.write(`Run 'spovishun-skills --help' for usage.\n`);
    process.exit(1);
}

function runValidate(args) {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const skillDir = positionals[0];
  if (!skillDir) {
    process.stderr.write(`Usage: spovishun-skills validate <skill-dir>\n`);
    return 1;
  }
  const manifestPath = join(skillDir, 'manifest.yaml');
  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    process.stderr.write(`Cannot read ${manifestPath}: ${err.message}\n`);
    return 1;
  }
  let parsed;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    process.stderr.write(`Cannot parse ${manifestPath}: ${err.message}\n`);
    return 1;
  }
  const result = validateManifest(parsed);
  if (result.ok) {
    process.stdout.write(`OK  ${manifestPath} is valid\n`);
    return 0;
  }
  process.stderr.write(`ERR ${manifestPath} failed validation:\n`);
  for (const e of result.errors) {
    process.stderr.write(`  ${e.path}: ${e.message}\n`);
  }
  return 1;
}

function printHelp(pkg) {
  process.stdout.write(
    `spovishun-skills v${pkg.version}\n\n` +
    `Usage:\n` +
    `  spovishun-skills --version              Print the installed version\n` +
    `  spovishun-skills --help                 Show this help\n` +
    `  spovishun-skills validate <skill-dir>   Validate a skill's manifest.yaml\n` +
    `  spovishun-skills init                   Create spovishun-skills.config.yaml interactively\n` +
    `  spovishun-skills install --target=<t>   Install skills/agents/hooks for target (claude)\n\n` +
    `More commands (sync, update, doctor) will be added in upcoming tasks.\n`
  );
}
