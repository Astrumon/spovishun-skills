import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { filterByStack } from '../../lib/stack-filter.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { collectRules, renderRule, ruleLockEntry, RULE_LOCK_VERSION } from '../../lib/rules-loader.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import { renderArtifact, manifestPlaceholderKeys } from '../../lib/render-artifact.js';
import { readLockfile, LOCKFILE_NAME } from '../../lib/lockfile.js';
import { readWindsurfManifest, writeWindsurfManifest } from '../../lib/windsurf-manifest.js';
// Imported straight from lib/, never via adapters/registry.js — the registry
// imports this adapter, so reaching back for it would close a cycle.
import { loadWindsurfFiles } from '../../lib/installed-files-loader.js';
import { planInstall, MERGE_HINT } from '../../lib/install-planner.js';

export const RULES_DIR = '.windsurf/rules';
export const CHAR_LIMIT = 6000;

const WINDSURF_KINDS = new Set(['skill', 'template']);

/**
 * The flattened filename stem for an artifact. Templates are prefixed so they
 * stay visually grouped in the flat rules directory.
 *
 * Exported because `update` writes the same files and used to derive the stem
 * itself — and got templates wrong, writing `epic-page.md` next to the
 * `templates--epic-page.md` that `install` had written.
 */
export function windsurfBaseId({ kind, id }) {
  return kind === 'template' ? `templates--${id}` : id;
}

/**
 * Generates .windsurf/rules/*.md for Windsurf from stack-filtered skills, templates, and rules.
 *
 * Each skill, template, and rule gets its own .md file. Skills/templates with
 * supporting `references/` or `assets/` files generate additional rule files
 * named `{id}--{relpath-with-double-dash}.md`. Templates are prefixed with
 * `templates--` to keep them visually grouped. If a rendered file exceeds
 * CHAR_LIMIT characters it is split into `<id>-part-1.md`, `<id>-part-2.md`, ...
 * Agent and hook artifacts are skipped (Windsurf has no agent concept). Binary
 * supporting files are skipped with a stderr warning.
 *
 * Every filename written is attributed in `.windsurf/rules/.spovishun-manifest.json`
 * so the reader never has to guess kind and id back out of a flattened name —
 * see lib/windsurf-manifest.js for why that guessing was unfixable.
 *
 * Every file goes through the same ownership model as claude, selected via
 * `ownership: 'checksum'`: windsurf bodies carry no YAML frontmatter and are
 * written without the `x-spovishun` marker, so content alone answers "is this
 * ours?" — exactly the model claude already applies to rules. A locally edited
 * file is skipped with a warning; `--force` resets ours; a file at an id we
 * never locked is owner-authored and sacred even then.
 *
 * Takes the uniform installer argument object (see adapters/registry.js) and
 * destructures the fields it uses. `pluginVersion` is not among them: nothing in
 * .windsurf/rules/ carries a version header.
 *
 * @param {object} opts
 * @param {string}   opts.consumerCwd   — absolute path to consumer project root
 * @param {string}   opts.pkgRoot       — absolute path to the spovishun-skills package root (for rules/)
 * @param {object}   opts.config        — validated consumer config
 * @param {Array}    opts.artifacts     — all loaded artifacts from loadArtifacts()
 * @param {boolean}  [opts.force]       — reset our own locally-edited files; owner files stay sacred
 * @param {object}   [opts.warn]        — writable stream for warnings (default: process.stderr)
 * @returns {Array<{kind, id, version, checksum}>} — lockfile entries for installed artifacts
 */
export async function installWindsurf({ consumerCwd, pkgRoot, config, artifacts, force = false, warn = process.stderr }) {
  const stackFiltered = filterByStack(artifacts, config.stack ?? {});
  const included = stackFiltered.filter((a) => WINDSURF_KINDS.has(a.kind));
  const rules = collectRules(pkgRoot, config.stack ?? {});
  const configMap = buildPlaceholderMap(config);

  const rulesDir = join(consumerCwd, RULES_DIR);
  mkdirSync(rulesDir, { recursive: true });

  const priorLock = readLockfile(join(consumerCwd, LOCKFILE_NAME));
  const lockEntryMap = new Map(
    (priorLock?.target === 'windsurf' ? priorLock.artifacts ?? [] : []).map((e) => [`${e.kind}:${e.id}`, e])
  );

  // Snapshot disk BEFORE writing anything: the ownership predicate compares
  // against what was there when this run started.
  const priorManifest = readWindsurfManifest(rulesDir) ?? {};
  const installed = loadWindsurfFiles(consumerCwd);

  const manifest = {};
  const attribute = attributor(manifest, warn);
  const ctx = { rulesDir, configMap, lockEntryMap, installed, priorManifest, manifest, attribute, force, warn };

  const lockEntries = [];
  for (const artifact of included) {
    const lock = installArtifact({ artifact, ...ctx });
    if (lock) lockEntries.push(lock);
  }
  lockEntries.push(...installRules({ rules, ...ctx }));

  writeWindsurfManifest(rulesDir, manifest);
  reconcileStaleFiles({ consumerCwd, ...ctx });

  return lockEntries;
}

/**
 * Renders, classifies and (when the plan says so) writes one skill or template,
 * together with its supporting files.
 *
 * @returns {object|null} — the lockfile entry for this id, or null to drop it
 */
function installArtifact({ artifact, rulesDir, configMap, lockEntryMap, installed, priorManifest, manifest, attribute, force, warn }) {
  // No marker: windsurf bodies carry no x-spovishun frontmatter. stripMarker is
  // a no-op on an unmarked body, which keeps this checksum equal to the claude
  // one for the same content.
  const { rendered, checksum } = renderArtifact(artifact, configMap);

  const key = `${artifact.kind}:${artifact.id}`;
  const owner = { kind: artifact.kind, id: artifact.id, role: 'body' };
  const { writeBody, lock } = planInstall({
    key,
    freshEntry: { kind: artifact.kind, id: artifact.id, version: artifact.version, checksum },
    upstream: { version: artifact.version, checksum },
    lockEntry: lockEntryMap.get(key) ?? null,
    installedEntry: installed.get(key) ?? null,
    ownership: 'checksum',
    mergeHint: MERGE_HINT.artifact,
    force,
    warn,
  });

  // An id we do not own is not ours to describe either — leaving it out of the
  // manifest is what keeps the next run from mistaking it for plugin output.
  if (lock === null) return null;

  if (!writeBody) {
    keepPriorAttribution({ key, priorManifest, manifest, installed, owner });
    return lock;
  }

  const ruleBaseId = windsurfBaseId(artifact);
  attribute(writeChunked(rulesDir, ruleBaseId, rendered), owner);

  for (const file of artifact.files ?? []) {
    if (file.encoding !== 'utf8') {
      warn.write(
        `Warning: skipping binary supporting file ${artifact.id}/${file.relPath} ` +
          `(Windsurf rules are markdown-only).\n`
      );
      continue;
    }
    const fileRendered = renderTemplate(file.contents, {
      configMap,
      manifestPlaceholders: manifestPlaceholderKeys(artifact.manifest),
    });
    const fileRuleId = `${ruleBaseId}--${file.relPath.replace(/\//g, '--').replace(/\.md$/, '')}`;
    attribute(writeChunked(rulesDir, fileRuleId, fileRendered), {
      kind: artifact.kind,
      id: artifact.id,
      role: 'support',
      path: file.relPath,
    });
  }

  return lock;
}

/**
 * Same pass for rules. They differ from artifacts only in the merge hint —
 * `update` skips every `rule:` lock entry, so `install --force` is the only way
 * to resolve an edited rule.
 *
 * @returns {Array<object>} lock entries for the rules we own
 */
function installRules({ rules, rulesDir, configMap, lockEntryMap, installed, priorManifest, manifest, attribute, force, warn }) {
  const entries = [];

  for (const rule of rules) {
    const rendered = renderRule(rule, configMap);
    const freshEntry = ruleLockEntry(rule, rendered);
    const key = `rule:${rule.id}`;
    const owner = { kind: 'rule', id: rule.id, role: 'body' };

    const { writeBody, lock } = planInstall({
      key,
      freshEntry,
      upstream: { version: RULE_LOCK_VERSION, checksum: freshEntry.checksum },
      lockEntry: lockEntryMap.get(key) ?? null,
      installedEntry: installed.get(key) ?? null,
      ownership: 'checksum',
      mergeHint: MERGE_HINT.rule,
      force,
      warn,
    });

    if (lock === null) continue;
    if (writeBody) attribute(writeChunked(rulesDir, rule.id.replace(/\//g, '--'), rendered), owner);
    else keepPriorAttribution({ key, priorManifest, manifest, installed, owner });
    entries.push(lock);
  }

  return entries;
}

/**
 * Carries a skipped id's filenames into the new manifest.
 *
 * A skipped local edit still belongs to us — the lock entry is kept — so the
 * manifest has to keep describing it, or the next run would find no files for
 * the id, classify it MISSING_ON_DISK and overwrite the very edit this run
 * preserved. The prior manifest is the better source (it also carries the id's
 * supporting files); the on-disk paths are the fallback for a tree installed
 * before manifests existed.
 */
function keepPriorAttribution({ key, priorManifest, manifest, installed, owner }) {
  let carried = 0;
  for (const [name, entry] of Object.entries(priorManifest)) {
    if (`${entry.kind}:${entry.id}` !== key) continue;
    manifest[name] = entry;
    carried++;
  }
  if (carried > 0) return;

  for (const path of installed.get(key)?.paths ?? []) {
    manifest[basename(path)] = { ...owner };
  }
}

/**
 * Records which artifact produced which filename, building the manifest as a
 * side effect of writing. `part` is stamped only on genuinely chunked output so
 * a single-file artifact stays trivially readable.
 *
 * Flattening `/` to `--` is not injective: the rule `common/git-workflow` and a
 * skill `common` carrying `references/git-workflow.md` both land on
 * `common--git-workflow.md`. Whichever writes second wins on disk — silently,
 * before this warning existed. Last write also wins in the manifest, so the
 * manifest keeps describing what is actually there.
 *
 * @param {object} manifest — accumulator, filename → {kind, id, role, part?, path?}
 * @param {object} warn — writable stream
 * @returns {(names: string[], owner: object) => void}
 */
function attributor(manifest, warn) {
  return (names, owner) => {
    const chunked = names.length > 1;
    names.forEach((name, index) => {
      const prev = manifest[name];
      if (prev) {
        warn.write(
          `Warning: ${owner.kind}:${owner.id} and ${prev.kind}:${prev.id} both write ${name} — ` +
            `the '--' filename encoding cannot tell them apart and the first is lost. ` +
            `Rename one of the two.\n`
        );
      }
      manifest[name] = { ...owner, ...(chunked && { part: index + 1 }) };
    });
  };
}

/**
 * Removes plugin-generated files this run did not write: de-selected artifacts,
 * ids dropped upstream, and leftover `-part-N.md` chunks after content shrank
 * below CHAR_LIMIT.
 *
 * Mirrors reconcileStaleRules in adapters/claude/index.js: a file is deleted
 * only when we can PROVE it is ours. The proof is per id, not per file, because
 * a chunked body's checksum only exists for the concatenation — so the on-disk
 * content of an id (as snapshotted before this run wrote anything) must still
 * equal what the prior lockfile recorded. An id that drifted is owner-authored
 * now and is reported, not removed.
 *
 * Candidate filenames come from three sources, and anything outside all three
 * is a user file the plugin never wrote:
 *   1. the prior manifest — everything we claimed last run, supporting files
 *      included;
 *   2. the on-disk snapshot — the same set, reached via whichever reader ran;
 *   3. filenames derivable from the prior lockfile — migration only, for trees
 *      installed before the manifest existed, where (1) is empty.
 */
function reconcileStaleFiles({ consumerCwd, rulesDir, priorManifest, installed, lockEntryMap, manifest, warn }) {
  if (!existsSync(rulesDir)) return;

  const onDisk = new Set(readdirSync(rulesDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name));
  const stale = new Map(); // "<kind>:<id>" → filenames no longer written

  const claim = (name, key) => {
    if (manifest[name] || !onDisk.has(name)) return;
    if (!stale.has(key)) stale.set(key, new Set());
    stale.get(key).add(name);
  };

  for (const [name, entry] of Object.entries(priorManifest)) claim(name, `${entry.kind}:${entry.id}`);
  for (const [key, entry] of installed) {
    for (const path of entry.paths) claim(basename(path), key);
  }
  for (const [key, entry] of lockEntryMap) {
    const base = entry.kind === 'template' ? `templates--${entry.id}` : entry.id.replace(/\//g, '--');
    for (const name of onDisk) {
      if (name === `${base}.md` || name.startsWith(`${base}-part-`) || name.startsWith(`${base}--`)) claim(name, key);
    }
  }

  for (const [key, names] of stale) {
    const lockEntry = lockEntryMap.get(key) ?? null;
    const snapshot = installed.get(key) ?? null;
    const owned = lockEntry != null && snapshot != null && snapshot.checksum === lockEntry.checksum;

    if (!owned) {
      // A locked id whose content drifted is a local edit we must not delete.
      // An unlocked one was never ours — stay silent rather than report a file
      // the consumer is free to keep.
      if (lockEntry) warn.write(`${key}: no longer generated but locally edited — left untouched.\n`);
      continue;
    }

    for (const name of names) {
      const stalePath = join(rulesDir, name);
      rmSync(stalePath, { force: true });
      warn.write(`Removed stale rule file: ${relative(consumerCwd, stalePath)}\n`);
    }
  }
}

/**
 * Writes content as one or more files under rulesDir.
 * If content.length <= CHAR_LIMIT → single file: <id>.md
 * Otherwise → <id>-part-1.md, <id>-part-2.md, ...
 *
 * @returns {string[]} the filenames written, in part order — the caller needs
 *   them to attribute each one in the manifest and to reconcile stale files.
 */
export function writeChunked(rulesDir, id, content) {
  if (content.length <= CHAR_LIMIT) {
    writeFileSync(join(rulesDir, `${id}.md`), content, 'utf8');
    return [`${id}.md`];
  }

  return splitIntoChunks(content, CHAR_LIMIT).map((chunk, i) => {
    const name = `${id}-part-${i + 1}.md`;
    writeFileSync(join(rulesDir, name), chunk, 'utf8');
    return name;
  });
}

/**
 * Splits text into chunks of at most maxChars characters.
 * Prefers breaking at the last newline within the window (at or after the
 * halfway mark) to keep chunks reasonably sized. Falls back to a hard cut
 * if no such newline exists.
 */
export function splitIntoChunks(text, maxChars) {
  const chunks = [];
  let pos = 0;
  while (pos < text.length) {
    if (pos + maxChars >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }
    const window = text.slice(pos, pos + maxChars);
    const nlIdx = window.lastIndexOf('\n');
    // Only use the newline break if it is past the halfway point so that chunks
    // don't become tiny (e.g. first line is very short).
    const minCut = Math.floor(maxChars / 2);
    const cutAt = nlIdx >= minCut ? nlIdx + 1 : maxChars;
    chunks.push(text.slice(pos, pos + cutAt));
    pos += cutAt;
  }
  return chunks;
}

