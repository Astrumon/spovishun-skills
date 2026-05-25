import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ConfigError } from '../lib/errors.js';
import { readLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';
import { runInstall } from './install.js';

/**
 * Re-applies install non-interactively using existing config + lockfile.
 * Derives the target from the lockfile (no --target flag needed).
 *
 * @param {object} opts
 * @param {string}   opts.cwd       — consumer project directory
 * @param {object}   [opts.out]     — writable stream for progress messages
 * @param {Function} [opts.now]     — injectable clock for lockfile timestamp
 * @param {string}   [opts.pkgRoot] — override package root (for tests)
 */
export async function runSync({ cwd, out = process.stdout, now, pkgRoot }) {
  const configPath = join(cwd, 'spovishun-skills.config.yaml');
  if (!existsSync(configPath)) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      'spovishun-skills.config.yaml not found.',
      "Run `spovishun-skills init` first."
    );
  }

  const lockfilePath = join(cwd, LOCKFILE_NAME);
  const lockData = readLockfile(lockfilePath);
  if (!lockData) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      `${LOCKFILE_NAME} not found.`,
      "Run `spovishun-skills install --target=<target>` first."
    );
  }

  const { target } = lockData;
  if (!target) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      `Lockfile is missing "target" field.`,
      "Run `spovishun-skills install --target=<target>` to regenerate the lockfile."
    );
  }

  await runInstall({ target, cwd, out, now, pkgRoot });
}
