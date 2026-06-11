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
import { runSync } from './sync.js';
import { runUpdate } from './update.js';
import { runDoctor } from './doctor.js';

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

// Runs an async subcommand: exit 0 on resolve (or a truthy boolean result),
// exit 1 with the error message + actionable hint otherwise.
function runAsync(label, promise) {
  promise
    .then((result) => process.exit(result === false ? 1 : 0))
    .catch((err) => {
      process.stderr.write(`${label} failed: ${err.message}\n`);
      if (err.actionable) process.stderr.write(`  ${err.actionable}\n`);
      process.exit(1);
    });
}

// node:util parseArgs throws on unknown flags — turn that into a usage line
// instead of an unhandled stack trace.
function parseFlags(label, args, options, usage) {
  try {
    return parseArgs({ args, options, allowPositionals: false }).values;
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.stderr.write(`Usage: ${usage}\n`);
    process.exit(1);
  }
}

switch (subcommand) {
  case 'validate':
    process.exit(runValidate(rest));
  case 'init':
    runAsync('init', runInit({ cwd: process.cwd(), prompter: createPromptModule(), out: process.stdout }));
    break;
  case 'install': {
    const installOpts = parseFlags(
      'install', rest,
      { target: { type: 'string' } },
      'spovishun-skills install --target=claude'
    );
    if (!installOpts.target) {
      process.stderr.write(`Error: --target is required.\n`);
      process.stderr.write(`Usage: spovishun-skills install --target=claude\n`);
      process.exit(1);
    }
    runAsync('install', runInstall({ target: installOpts.target, cwd: process.cwd(), out: process.stdout }));
    break;
  }
  case 'sync':
    runAsync('sync', runSync({ cwd: process.cwd(), out: process.stdout }));
    break;
  case 'update': {
    const updateOpts = parseFlags(
      'update', rest,
      {
        upstream: { type: 'string' },
        skill: { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
      'spovishun-skills update --upstream=<dir> [--skill <id>] [--dry-run]'
    );
    if (!updateOpts.upstream) {
      process.stderr.write(`Error: --upstream is required.\n`);
      process.stderr.write(`Usage: spovishun-skills update --upstream=<dir>\n`);
      process.exit(1);
    }
    runAsync('update', runUpdate({
      cwd: process.cwd(),
      upstreamRoot: updateOpts.upstream,
      skillId: updateOpts.skill,
      dryRun: updateOpts['dry-run'] ?? false,
      out: process.stdout,
    }));
    break;
  }
  case 'doctor':
    runAsync('doctor', runDoctor({ cwd: process.cwd(), env: process.env, out: process.stdout }));
    break;
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
    `  spovishun-skills install --target=<t>   Install skills/agents/hooks for target (claude, codex, windsurf)\n` +
    `  spovishun-skills sync                   Re-apply install using existing config + lockfile (no wizard)\n` +
    `  spovishun-skills update --upstream=<d>  Diff installed artifacts against an upstream copy\n` +
    `    [--skill <id>]                         Limit update to one artifact\n` +
    `    [--dry-run]                            Print planned actions, write nothing\n` +
    `  spovishun-skills doctor                 Validate installation integrity (config, lockfile, Notion, .gitignore, settings.json)\n` +
    `  Note: update is not supported for --target=codex (AGENTS.md is monolithic);\n` +
    `        run install --target=codex to regenerate.\n`
  );
}
