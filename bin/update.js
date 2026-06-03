import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { ConfigError } from '../lib/errors.js';
import { readLockfile, writeLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { loadInstalledFiles } from '../lib/installed-files-loader.js';
import { filterByStack } from '../lib/stack-filter.js';
import { buildPlaceholderMap } from '../lib/placeholder-map.js';
import { renderTemplate } from '../lib/template-renderer.js';
import { sha256 } from '../lib/checksum.js';
import { classifyArtifact, ACTIONS } from '../lib/update-classifier.js';
import { updateClaude } from '../adapters/claude/update.js';
import { updateWindsurf } from '../adapters/windsurf/update.js';
import { ensureSkillFrontmatter } from '../lib/skill-frontmatter.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Compares installed artifacts against an upstream copy and applies safe changes.
 *
 * @param {object} opts
 * @param {string}   opts.cwd          — consumer project directory
 * @param {string}   opts.upstreamRoot — absolute path to upstream spovishun-skills package root
 * @param {string}   [opts.skillId]    — if set, only process this artifact id
 * @param {boolean}  [opts.dryRun]     — if true, print planned actions but write nothing
 * @param {object}   [opts.out]        — writable stream for messages
 * @param {Function} [opts.now]        — injectable clock for lockfile timestamp
 */
export async function runUpdate({
  cwd,
  upstreamRoot,
  skillId,
  dryRun = false,
  out = process.stdout,
  now,
}) {
  const write = (msg) => out.write(msg);

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

  if (!existsSync(upstreamRoot)) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      `Upstream directory not found: ${upstreamRoot}`,
      "Provide the path to a local spovishun-skills package clone via --upstream=<dir>."
    );
  }
  const upstreamSkillsDir = join(upstreamRoot, 'skills');
  if (!existsSync(upstreamSkillsDir)) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      `Upstream directory does not look like a spovishun-skills package (missing skills/): ${upstreamRoot}`,
      "Ensure --upstream points to a valid spovishun-skills package root."
    );
  }

  const { target } = lockData;

  if (target === 'codex') {
    write(
      `[update] codex target is not supported in V1 — AGENTS.md is monolithic and cannot be updated per-artifact.\n` +
      `  Workaround: edit AGENTS.md manually, then run \`spovishun-skills install --target=codex\` to regenerate.\n`
    );
    return { autoApplied: 0, conflicts: 0, newArtifacts: 0, removed: 0 };
  }

  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  const config = loadConfig(configPath);
  const configMap = buildPlaceholderMap(config);

  const upstreamArtifacts = filterByStack(loadArtifacts(upstreamRoot), config.stack ?? {});
  const installedFiles = loadInstalledFiles(cwd, target);

  const lockEntryMap = new Map(
    (lockData.artifacts ?? []).map((e) => [`${e.kind}:${e.id}`, e])
  );
  const upstreamMap = new Map();
  for (const artifact of upstreamArtifacts) {
    const manifestPlaceholders = (artifact.manifest?.placeholders ?? []).map((p) => p.key);
    const renderedBody = renderTemplate(artifact.bodyText, { configMap, manifestPlaceholders });
    // Claude installs prepend a synthesized YAML frontmatter to every skill
    // body (see adapters/claude/index.js). Mirror that here so the
    // upstream checksum matches what is actually on disk after install/sync.
    const rendered = target === 'claude' && artifact.kind === 'skill'
      ? ensureSkillFrontmatter(renderedBody, artifact.manifest)
      : renderedBody;
    const checksum = sha256(rendered);
    upstreamMap.set(`${artifact.kind}:${artifact.id}`, { artifact, rendered, checksum });
  }

  // All keys across lockfile + upstream (filtered by --skill if given)
  const allKeys = new Set([...lockEntryMap.keys(), ...upstreamMap.keys()]);
  const filteredKeys = skillId
    ? [...allKeys].filter((k) => k.split(':')[1] === skillId)
    : [...allKeys];

  if (skillId && filteredKeys.length === 0) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      `No artifact matching id "${skillId}" found in upstream or lockfile.`,
      `Check the available artifact ids in the upstream package.`
    );
  }

  const summary = { autoApplied: 0, conflicts: 0, newArtifacts: 0, removed: 0, localOnly: 0, unchanged: 0 };
  const newLockEntries = [];

  for (const key of filteredKeys) {
    const lockEntry = lockEntryMap.get(key) ?? null;
    const upstreamEntry = upstreamMap.get(key) ?? null;
    const installedEntry = installedFiles.get(key) ?? null;

    const onDiskChecksum = installedEntry ? installedEntry.checksum : null;
    const upstreamForClassifier = upstreamEntry
      ? { version: upstreamEntry.artifact.version, checksum: upstreamEntry.checksum }
      : null;

    const action = classifyArtifact({ upstream: upstreamForClassifier, lockEntry, onDiskChecksum });

    write(`  ${action.padEnd(16)} ${key}\n`);

    switch (action) {
      case ACTIONS.UNCHANGED:
      case ACTIONS.LOCAL_ONLY:
      case ACTIONS.MISSING_ON_DISK:
        summary[action === ACTIONS.UNCHANGED ? 'unchanged' : 'localOnly']++;
        if (lockEntry) newLockEntries.push(lockEntry);
        break;

      case ACTIONS.AUTO_APPLY: {
        summary.autoApplied++;
        if (!dryRun) {
          await applyArtifact({ target, cwd, key, upstreamEntry, installedEntry });
        }
        newLockEntries.push({
          kind: upstreamEntry.artifact.kind,
          id: upstreamEntry.artifact.id,
          version: upstreamEntry.artifact.version,
          checksum: upstreamEntry.checksum,
        });
        break;
      }

      case ACTIONS.CONFLICT: {
        summary.conflicts++;
        const oursLabel = relative(cwd, installedEntry.paths[0]);
        const theirsLabel = `spovishun-skills@${pkg.version}`;
        if (!dryRun) {
          await applyConflict({ target, cwd, key, upstreamEntry, installedEntry, oursLabel, theirsLabel });
        }
        // Keep old lock entry so the next run re-detects the conflict
        if (lockEntry) newLockEntries.push(lockEntry);
        break;
      }

      case ACTIONS.NEW: {
        summary.newArtifacts++;
        if (!dryRun) {
          await applyArtifact({ target, cwd, key, upstreamEntry, installedEntry: null });
        }
        newLockEntries.push({
          kind: upstreamEntry.artifact.kind,
          id: upstreamEntry.artifact.id,
          version: upstreamEntry.artifact.version,
          checksum: upstreamEntry.checksum,
        });
        break;
      }

      case ACTIONS.REMOVED: {
        summary.removed++;
        write(`  (entry removed from lockfile)\n`);
        // Drop from lockfile — do NOT push lockEntry
        break;
      }
    }
  }

  // Re-include lock entries that were not part of the filtered set (--skill filter case)
  if (skillId) {
    for (const [key, entry] of lockEntryMap) {
      if (key.split(':')[1] !== skillId) {
        newLockEntries.push(entry);
      }
    }
  }

  if (!dryRun) {
    const pluginVersion = pkg.version;
    writeLockfile(lockfilePath, { pluginVersion, target, artifacts: newLockEntries, now });
  }

  write(
    `\nDone (${dryRun ? 'dry-run, ' : ''}` +
    `auto-applied: ${summary.autoApplied}, ` +
    `conflicts: ${summary.conflicts}, ` +
    `new: ${summary.newArtifacts}, ` +
    `removed: ${summary.removed})\n`
  );

  return summary;
}

async function applyArtifact({ target, cwd, upstreamEntry }) {
  if (target === 'claude') {
    await updateClaude({ consumerCwd: cwd, upstreamEntry, conflict: false });
  } else if (target === 'windsurf') {
    await updateWindsurf({ consumerCwd: cwd, upstreamEntry, conflict: false });
  }
}

async function applyConflict({ target, cwd, upstreamEntry, installedEntry, oursLabel, theirsLabel }) {
  if (target === 'claude') {
    await updateClaude({ consumerCwd: cwd, upstreamEntry, installedEntry, conflict: true, oursLabel, theirsLabel });
  } else if (target === 'windsurf') {
    await updateWindsurf({ consumerCwd: cwd, upstreamEntry, installedEntry, conflict: true, oursLabel, theirsLabel });
  }
}
