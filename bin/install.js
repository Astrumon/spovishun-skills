import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { installClaude } from '../adapters/claude/index.js';
import { writeLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * @param {object} opts
 * @param {string}   opts.target     — install target (only "claude" is supported now)
 * @param {string}   opts.cwd        — consumer project directory
 * @param {object}   [opts.out]      — writable stream for messages (default: process.stdout)
 * @param {Function} [opts.now]      — injectable clock for lockfile timestamp
 */
export async function runInstall({ target, cwd, out = process.stdout, now }) {
  const write = (msg) => out.write(msg);

  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  const pkgRoot = join(here, '..');
  const configPath = join(cwd, 'spovishun-skills.config.yaml');

  const config = loadConfig(configPath);
  const artifacts = loadArtifacts(pkgRoot);

  let lockEntries;
  if (target === 'claude') {
    lockEntries = await installClaude({ consumerCwd: cwd, config, artifacts });
  } else {
    throw Object.assign(
      new Error(`Unknown target: "${target}". Supported targets: claude`),
      { actionable: `Use --target=claude (support for codex, windsurf, cursor is planned for V1).` }
    );
  }

  const lockfilePath = join(cwd, LOCKFILE_NAME);
  writeLockfile(lockfilePath, {
    pluginVersion: pkg.version,
    target,
    artifacts: lockEntries,
    now,
  });

  write(`Installed ${lockEntries.length} artifact(s) → .claude/\n`);
  write(`Wrote ${lockfilePath}\n`);
}
