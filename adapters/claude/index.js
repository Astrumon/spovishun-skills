import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { Buffer } from 'node:buffer';
import { collectRules, renderRule, ruleLockEntry, RULE_LOCK_VERSION } from '../../lib/rules-loader.js';
import { filterByStack, STACK_FLAGS } from '../../lib/stack-filter.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { sha256 } from '../../lib/checksum.js';
import { mergeSettings } from '../../lib/settings-merger.js';
import { readLockfile, LOCKFILE_NAME } from '../../lib/lockfile.js';
import { markBody } from '../../lib/skill-frontmatter.js';
import { stripMarker } from '../../lib/marker.js';
import { loadInstalledFiles } from '../../lib/installed-files-loader.js';
import { classifyArtifact, ACTIONS } from '../../lib/update-classifier.js';

const KIND_LAYOUT = {
  skill: { subdir: 'skills', bodyFilename: 'SKILL.md' },
  agent: { subdir: 'agents', bodyFilename: 'AGENT.md' },
  template: { subdir: '_templates', bodyFilename: 'TEMPLATE.md' },
};

/**
 * Installs filtered artifacts into the consumer's .claude/ directory.
 *
 * @param {object} opts
 * @param {string}   opts.consumerCwd   — absolute path to consumer project root
 * @param {string}   opts.pkgRoot       — absolute path to this package's root (for hooks/ and rules/)
 * @param {object}   opts.config        — validated consumer config object
 * @param {Array}    opts.artifacts     — all loaded artifacts from loadArtifacts()
 * @param {boolean}  [opts.force]       — reset our own locally-edited files (LOCAL_ONLY/CONFLICT). Unmarked owner files stay sacred regardless.
 * @param {object}   [opts.warn]        — writable stream for warnings (default: process.stderr)
 * @returns {Array<{kind, id, version, checksum}>}  — lockfile entries for installed artifacts
 */
export async function installClaude({ consumerCwd, pkgRoot, config, artifacts, force = false, warn = process.stderr }) {
  const filtered = filterByStack(artifacts, config.stack ?? {});
  const configMap = buildPlaceholderMap(config);

  const claudeDir = join(consumerCwd, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(join(claudeDir, 'skills'), { recursive: true });
  mkdirSync(join(claudeDir, 'agents'), { recursive: true });
  mkdirSync(join(claudeDir, '_templates'), { recursive: true });
  mkdirSync(join(claudeDir, 'hooks'), { recursive: true });
  mkdirSync(join(claudeDir, 'rules'), { recursive: true });

  const priorLock = readLockfile(join(consumerCwd, LOCKFILE_NAME));
  const lockEntryMap = new Map(
    (priorLock?.artifacts ?? []).map((e) => [`${e.kind}:${e.id}`, e])
  );

  reconcileLegacyArtifacts(consumerCwd, claudeDir, filtered, warn, priorLock);

  // Snapshot what is already on disk (checksums are marker-stripped) so the
  // ownership predicate can tell our own files from owner-authored collisions.
  const installed = loadInstalledFiles(consumerCwd, 'claude');

  const lockEntries = [];

  for (const artifact of filtered) {
    const layout = KIND_LAYOUT[artifact.kind];
    if (!layout) continue;

    const manifestPlaceholders = (artifact.manifest?.placeholders ?? []).map((p) => p.key);
    const renderedBody = renderTemplate(artifact.bodyText, { configMap, manifestPlaceholders });
    const bodyToWrite = markBody({ body: renderedBody, kind: artifact.kind, manifest: artifact.manifest });
    // Checksum is taken over the marker-stripped body so it is identical to the
    // pre-marker lockfile checksum — that invariance is what makes migration
    // and the ownership predicate work.
    const checksum = sha256(stripMarker(bodyToWrite));

    const key = `${artifact.kind}:${artifact.id}`;
    const lockEntry = lockEntryMap.get(key) ?? null;
    const installedEntry = installed.get(key) ?? null;
    const onDiskChecksum = installedEntry ? installedEntry.checksum : null;
    const onDiskOwned = installedEntry
      ? installedEntry.hasMarker || (lockEntry != null && installedEntry.checksum === lockEntry.checksum)
      : false;

    const action = classifyArtifact({
      upstream: { version: artifact.version, checksum },
      lockEntry,
      onDiskChecksum,
      onDiskOwned,
    });

    const freshEntry = { kind: artifact.kind, id: artifact.id, version: artifact.version, checksum };
    let writeBody = false;
    let lockToPush = null;

    switch (action) {
      case ACTIONS.NEW:
      case ACTIONS.UNCHANGED:
      case ACTIONS.AUTO_APPLY:
      // MISSING_ON_DISK restores the file here and in `update` alike — see the
      // contract in lib/update-classifier.js.
      case ACTIONS.MISSING_ON_DISK:
        writeBody = true;
        lockToPush = freshEntry;
        break;

      case ACTIONS.ADOPT:
        // Owner's file carries our marker but is not in the lockfile. Keep it,
        // register the on-disk content as the merge baseline, and defer any
        // plugin overwrite to `update`. install never merges.
        warn.write(`${key}: existing marked file not in lockfile — adopted as baseline (run \`update\` to merge plugin changes).\n`);
        lockToPush = { kind: artifact.kind, id: artifact.id, version: artifact.version, checksum: onDiskChecksum };
        break;

      case ACTIONS.LOCAL_ONLY:
      case ACTIONS.CONFLICT:
        if (force) {
          writeBody = true;
          lockToPush = freshEntry;
        } else {
          warn.write(`${key}: local edits present — skipped (run \`update\` to merge, or \`install --force\` to overwrite).\n`);
          lockToPush = lockEntry; // keep the id tracked
        }
        break;

      case ACTIONS.COLLISION:
        // An owner-authored file (no marker, not ours) occupies this id.
        // Sacred even under --force; the owner deletes it to hand over the id.
        warn.write(`${key}: owner-authored file occupies this id — left untouched, not added to lockfile.\n`);
        break;

      case ACTIONS.DISOWNED:
        warn.write(`${key}: on-disk file is no longer recognisably plugin-generated — left untouched, dropped from lockfile.\n`);
        break;
    }

    if (writeBody) {
      const artifactDir = join(claudeDir, layout.subdir, artifact.id);
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, layout.bodyFilename), bodyToWrite, 'utf8');

      for (const file of artifact.files ?? []) {
        const destPath = join(artifactDir, file.relPath);
        mkdirSync(dirname(destPath), { recursive: true });
        if (file.encoding === 'utf8') {
          const rendered = renderTemplate(file.contents, { configMap, manifestPlaceholders });
          writeFileSync(destPath, rendered, 'utf8');
        } else {
          writeFileSync(destPath, Buffer.from(file.contents, 'base64'));
        }
      }
    }

    if (lockToPush) lockEntries.push(lockToPush);
  }

  // installHooks returns {} when there are no hooks to merge, so this single
  // call also guarantees settings.json exists.
  patchSettings(claudeDir, installHooks(pkgRoot, claudeDir, warn));
  lockEntries.push(
    ...installRules({
      pkgRoot,
      consumerCwd,
      claudeDir,
      configMap,
      stackFlags: config.stack ?? {},
      lockEntryMap,
      installed,
      force,
      warn,
    })
  );
  installScripts(pkgRoot, claudeDir, config);

  return lockEntries;
}

/**
 * Removes stale artifact files from prior plugin layouts:
 *
 *   1. Flat `.claude/{subdir}/{id}.md` files from pre-v1.2.0 installs — but
 *      ONLY for ids the plugin knows about (current artifact set or prior
 *      lockfile). User-authored flat .md files in the same directories are
 *      never touched.
 *   2. `.claude/{subdir}/{id}/` folders for ids that were in the prior lockfile
 *      but are no longer in the filtered artifact set (e.g. removed skill,
 *      stack-flag toggled off).
 *
 * Reads the prior lockfile to drive both; skips (2) silently if absent.
 */
function reconcileLegacyArtifacts(consumerCwd, claudeDir, filteredArtifacts, warn, lock) {
  const wantById = new Map();
  for (const artifact of filteredArtifacts) {
    wantById.set(`${artifact.kind}:${artifact.id}`, true);
  }

  const lockedIds = new Set(
    (lock?.artifacts ?? []).map((e) => `${e.kind}:${e.id}`)
  );

  for (const [kind, layout] of Object.entries(KIND_LAYOUT)) {
    const subdirPath = join(claudeDir, layout.subdir);
    // Drop flat {id}.md files (legacy layout) — plugin-known ids only.
    if (existsSync(subdirPath)) {
      for (const entry of readdirSync(subdirPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const id = entry.name.slice(0, -'.md'.length);
        const key = `${kind}:${id}`;
        if (!wantById.has(key) && !lockedIds.has(key)) continue;
        const flatPath = join(subdirPath, entry.name);
        rmSync(flatPath, { force: true });
        warn.write(`Removed legacy flat file: ${relative(consumerCwd, flatPath)}\n`);
      }
    }
  }

  if (!lock || !Array.isArray(lock.artifacts)) return;

  for (const entry of lock.artifacts) {
    const layout = KIND_LAYOUT[entry.kind];
    if (!layout) continue;
    if (wantById.has(`${entry.kind}:${entry.id}`)) continue;
    const stalePath = join(claudeDir, layout.subdir, entry.id);
    if (existsSync(stalePath)) {
      rmSync(stalePath, { recursive: true, force: true });
      warn.write(`Removed stale artifact folder: ${relative(consumerCwd, stalePath)}\n`);
    }
  }
}

/**
 * Copies all hook scripts from hooks/ to .claude/hooks/ and returns the
 * hooks.json event mappings for the caller to merge into settings.json.
 * Returns {} when hooks/ or hooks.json is absent.
 */
function installHooks(pkgRoot, claudeDir, warn) {
  const hooksDir = join(pkgRoot, 'hooks');
  if (!existsSync(hooksDir)) return {};

  const hooksJsonPath = join(hooksDir, 'hooks.json');
  if (!existsSync(hooksJsonPath)) return {};

  let hooksJson;
  try {
    hooksJson = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
  } catch (err) {
    // A broken hooks.json must not pass silently: scripts would be skipped and
    // the install would still report success with hooks missing.
    warn.write(`Warning: hooks/hooks.json is not valid JSON (${err.message}) — hooks NOT installed.\n`);
    return {};
  }

  // Copy all .js scripts verbatim, plus package.json — it pins
  // "type": "commonjs" so the CJS hooks keep working in consumers whose root
  // package.json declares "type": "module".
  const scripts = readdirSync(hooksDir).filter((f) => f.endsWith('.js') || f === 'package.json');
  for (const script of scripts) {
    copyFileSync(join(hooksDir, script), join(claudeDir, 'hooks', script));
  }

  return hooksJson.hooks ?? {};
}

/**
 * Renders all .md rule files from rules/ into .claude/rules/, preserving subdirectory
 * structure. Rule bodies support Mustache placeholders (resolved from the consumer config),
 * mirroring the codex and windsurf adapters — never copied verbatim.
 *
 * Groups named after a stack flag (`kotlin/`, `kmp/`) are gated on that flag by
 * collectRules; `common/` always ships.
 *
 * Rules run through the same ownership model as skills and agents, with one
 * difference: they carry no YAML frontmatter, so there is no `x-spovishun`
 * provenance marker to consult. Ownership is decided by CHECKSUM EQUALITY
 * ALONE — see ownsRule() below.
 *
 * @returns {Array<{kind, id, version, checksum}>} lock entries for the rules we own
 */
function installRules({ pkgRoot, consumerCwd, claudeDir, configMap, stackFlags, lockEntryMap, installed, force, warn }) {
  const rules = collectRules(pkgRoot, stackFlags);
  const entries = [];

  for (const rule of rules) {
    const key = `rule:${rule.id}`;
    const rendered = renderRule(rule, configMap);
    const freshEntry = ruleLockEntry(rule, configMap);
    const checksum = freshEntry.checksum;

    const lockEntry = lockEntryMap.get(key) ?? null;
    const installedEntry = installed.get(key) ?? null;
    const onDiskChecksum = installedEntry ? installedEntry.checksum : null;

    const action = onDiskChecksum === checksum
      // The file already holds exactly what we would write — whether we put it
      // there, the owner hand-applied the same change, or this is a pre-1.16
      // install being adopted. Short-circuit so an adopted rule stays silent
      // and a hand-applied upstream change is not reported as a CONFLICT.
      ? ACTIONS.UNCHANGED
      : classifyArtifact({
          upstream: { version: RULE_LOCK_VERSION, checksum },
          lockEntry,
          onDiskChecksum,
          onDiskOwned: lockEntry != null,
        });

    switch (action) {
      case ACTIONS.NEW:
      case ACTIONS.UNCHANGED:
      case ACTIONS.AUTO_APPLY:
      case ACTIONS.MISSING_ON_DISK:
        writeRule(claudeDir, rule.id, rendered);
        entries.push(freshEntry);
        break;

      case ACTIONS.LOCAL_ONLY:
      case ACTIONS.CONFLICT:
        if (force) {
          writeRule(claudeDir, rule.id, rendered);
          entries.push(freshEntry);
        } else {
          warn.write(`${key}: local edits present — skipped (run \`install --force\` to overwrite).\n`);
          entries.push(lockEntry); // keep the id tracked
        }
        break;

      case ACTIONS.COLLISION:
        // No lock entry and the file differs from our render: an owner-authored
        // rule occupies this id. Sacred even under --force, same as skills.
        warn.write(`${key}: owner-authored file occupies this id — left untouched, not added to lockfile.\n`);
        break;
    }
  }

  reconcileStaleRules({ pkgRoot, consumerCwd, claudeDir, configMap, rules, lockEntryMap, installed, warn });

  return entries;
}

function writeRule(claudeDir, id, rendered) {
  const destPath = join(claudeDir, 'rules', ...id.split('/')) + '.md';
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, rendered, 'utf8');
}

/**
 * Deletes rule files the plugin owns but the current stack no longer selects —
 * the case a consumer hits when flipping `kmp: true → false`.
 *
 * Candidate ids are plugin-known ids only, drawn from two sources:
 *   1. `rule:` entries in the prior lockfile;
 *   2. every rule the package ships with ALL stack flags on.
 * (2) exists for migration: a consumer upgrading from ≤ 1.15.0 has rule files
 * on disk and no rule lock entries at all, so a lockfile-only candidate set
 * would strand their de-selected rules forever. Anything outside both sets is
 * an owner-authored file in .claude/rules/ and is never a candidate.
 *
 * A candidate is removed only when its on-disk content matches the locked
 * checksum or the current render — i.e. we can prove the file is ours. A
 * locally edited rule is owner-authored and is left in place with a warning.
 */
function reconcileStaleRules({ pkgRoot, consumerCwd, claudeDir, configMap, rules, lockEntryMap, installed, warn }) {
  const selected = new Set(rules.map((r) => r.id));

  const allFlagsOn = Object.fromEntries(STACK_FLAGS.map((flag) => [flag, true]));
  const knownRenders = new Map(
    collectRules(pkgRoot, allFlagsOn).map((rule) => [rule.id, renderRule(rule, configMap)])
  );

  const candidates = new Set(knownRenders.keys());
  for (const key of lockEntryMap.keys()) {
    if (key.startsWith('rule:')) candidates.add(key.slice('rule:'.length));
  }

  for (const id of candidates) {
    if (selected.has(id)) continue;
    const installedEntry = installed.get(`rule:${id}`);
    if (!installedEntry) continue;

    const lockEntry = lockEntryMap.get(`rule:${id}`) ?? null;
    const known = knownRenders.get(id);
    const owned =
      (lockEntry != null && installedEntry.checksum === lockEntry.checksum) ||
      (known != null && installedEntry.checksum === sha256(known));

    const rulePath = join(claudeDir, 'rules', ...id.split('/')) + '.md';
    if (!owned) {
      warn.write(`rule:${id}: no longer selected by the active stack but locally edited — left untouched.\n`);
      continue;
    }
    rmSync(rulePath, { force: true });
    warn.write(`Removed stale rule file: ${relative(consumerCwd, rulePath)}\n`);
    pruneEmptyDirs(dirname(rulePath), join(claudeDir, 'rules'));
  }
}

/**
 * Removes now-empty group directories up to (but never including) stopDir, so
 * turning `kmp` off does not leave a hollow `.claude/rules/kmp/` behind.
 */
function pruneEmptyDirs(dir, stopDir) {
  let current = dir;
  while (current !== stopDir && current.startsWith(stopDir) && existsSync(current)) {
    if (readdirSync(current).length > 0) return;
    rmSync(current, { recursive: true, force: true });
    current = dirname(current);
  }
}

/**
 * Copies CLI scripts that skill bodies invoke (e.g. `node .claude/scripts/notion/get-board.js`)
 * into the consumer's `.claude/scripts/` tree. Each subdirectory of `scripts/`
 * is mirrored recursively; top-level files (repo maintenance scripts like
 * validate-all-manifests.js) are never shipped. The `notion/` subtree is gated
 * on `stack.notion`.
 *
 * Codex / Windsurf adapters do not call this — those targets surface skills
 * as inline text where shell-script delivery makes no sense.
 */
function installScripts(pkgRoot, claudeDir, config) {
  const scriptsRoot = join(pkgRoot, 'scripts');
  if (!existsSync(scriptsRoot)) return;

  for (const entry of readdirSync(scriptsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name === 'notion' && !config.stack?.notion) continue;
    const dest = join(claudeDir, 'scripts', entry.name);
    mkdirSync(dest, { recursive: true });
    copyDirRecursive(join(scriptsRoot, entry.name), dest);
  }
}

function copyDirRecursive(srcDir, destDir) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function patchSettings(claudeDir, pluginHooks) {
  const settingsPath = join(claudeDir, 'settings.json');
  let existing = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const merged = mergeSettings(existing, pluginHooks);
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}
