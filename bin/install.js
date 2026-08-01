import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { getTarget } from '../adapters/registry.js';
import { writeLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * @param {object} opts
 * @param {string}   opts.target     — install target; see adapters/registry.js
 * @param {string}   opts.cwd        — consumer project directory
 * @param {boolean}  [opts.force]    — reset our own locally-edited files (claude only); owner files stay sacred
 * @param {object}   [opts.out]      — writable stream for messages (default: process.stdout)
 * @param {Function} [opts.now]      — injectable clock for lockfile timestamp
 * @param {string}   [opts.pkgRoot]  — override package root (for tests)
 */
export async function runInstall({ target, cwd, force = false, out = process.stdout, now, pkgRoot: pkgRootOverride }) {
  const write = (msg) => out.write(msg);

  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  const pkgRoot = pkgRootOverride ?? join(here, '..');
  const configPath = join(cwd, 'spovishun-skills.config.yaml');

  const targetDef = getTarget(target);
  const config = loadConfig(configPath);
  const artifacts = loadArtifacts(pkgRoot);

  // Every adapter takes the same argument object and ignores what it does not
  // need — see adapters/registry.js for why the signatures are uniform.
  const lockEntries = await targetDef.install({
    consumerCwd: cwd,
    pkgRoot,
    config,
    artifacts,
    pluginVersion: pkg.version,
    force,
  });

  const lockfilePath = join(cwd, LOCKFILE_NAME);
  writeLockfile(lockfilePath, {
    pluginVersion: pkg.version,
    target,
    artifacts: lockEntries,
    now,
  });

  write(`Installed ${lockEntries.length} artifact(s) → ${targetDef.hint}\n`);
  write(`Wrote ${lockfilePath}\n`);
}
