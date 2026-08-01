import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { ConfigError } from '../lib/errors.js';
import { readLockfile, writeLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';
import { loadConfig } from '../lib/config-loader.js';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { getTarget } from '../adapters/registry.js';
import { filterByStack } from '../lib/stack-filter.js';
import { buildPlaceholderMap } from '../lib/placeholder-map.js';
import { renderArtifact } from '../lib/render-artifact.js';
import { classifyArtifact, ACTIONS } from '../lib/update-classifier.js';

const here = dirname(fileURLToPath(import.meta.url));

const CONFIG_NAME = 'spovishun-skills.config.yaml';

const CODEX_UNSUPPORTED =
  `[update] codex target is not supported in V1 — AGENTS.md is monolithic and cannot be updated per-artifact.\n` +
  `  Workaround: edit AGENTS.md manually, then run \`spovishun-skills install --target=codex\` to regenerate.\n`;

const UNSUPPORTED_MESSAGE = { codex: CODEX_UNSUPPORTED };

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
export async function runUpdate({ cwd, upstreamRoot, skillId, dryRun = false, out = process.stdout, now }) {
  const write = (msg) => out.write(msg);

  const { configPath, lockfilePath, lockData } = validateUpdatePreconditions({ cwd, upstreamRoot });
  const { target } = lockData;
  const targetDef = getTarget(target);

  if (!targetDef.supportsUpdate) {
    write(UNSUPPORTED_MESSAGE[target] ?? `[update] ${target} target does not support per-artifact update.\n`);
    return emptySummary();
  }

  const pluginVersion = readPluginVersion();
  const ctx = buildContext({ cwd, configPath, upstreamRoot, lockData, targetDef, dryRun, write, pluginVersion });

  const summary = emptySummary();
  const newLockEntries = [];
  for (const key of selectKeys(ctx, skillId)) {
    const { counter, lock } = await processKey(key, ctx);
    summary[counter]++;
    if (lock) newLockEntries.push(lock);
  }

  // Re-include lock entries that were not part of the filtered set (--skill filter case)
  if (skillId) newLockEntries.push(...unfilteredLockEntries(ctx.lockEntryMap, skillId));

  if (!dryRun) {
    writeLockfile(lockfilePath, { pluginVersion, target, artifacts: newLockEntries, now });
  }

  write(formatSummary(summary, { dryRun }));

  return summary;
}

function readPluginVersion() {
  return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version;
}

/**
 * Loads everything the per-key pass reads — the rendered upstream artifacts, the
 * lockfile entries and the on-disk snapshot — into the context `processKey` takes.
 */
function buildContext({ cwd, configPath, upstreamRoot, lockData, targetDef, dryRun, write, pluginVersion }) {
  const config = loadConfig(configPath);
  const artifacts = filterByStack(loadArtifacts(upstreamRoot), config.stack ?? {});

  return {
    targetDef,
    cwd,
    dryRun,
    write,
    pluginVersion,
    upstreamMap: buildUpstreamMap({ artifacts, configMap: buildPlaceholderMap(config), targetDef }),
    lockEntryMap: new Map((lockData.artifacts ?? []).map((e) => [`${e.kind}:${e.id}`, e])),
    installedFiles: targetDef.readInstalled(cwd),
  };
}

/**
 * Guards every precondition `update` needs before it touches anything: the
 * consumer config, the lockfile, and an upstream directory that actually looks
 * like a spovishun-skills package.
 *
 * @returns {{configPath: string, lockfilePath: string, lockData: object}}
 */
function validateUpdatePreconditions({ cwd, upstreamRoot }) {
  const configPath = join(cwd, CONFIG_NAME);
  requireOrThrow(existsSync(configPath), `${CONFIG_NAME} not found.`, 'Run `spovishun-skills init` first.');

  const lockfilePath = join(cwd, LOCKFILE_NAME);
  const lockData = readLockfile(lockfilePath);
  requireOrThrow(
    lockData,
    `${LOCKFILE_NAME} not found.`,
    'Run `spovishun-skills install --target=<target>` first.'
  );

  requireOrThrow(
    existsSync(upstreamRoot),
    `Upstream directory not found: ${upstreamRoot}`,
    'Provide the path to a local spovishun-skills package clone via --upstream=<dir>.'
  );
  requireOrThrow(
    existsSync(join(upstreamRoot, 'skills')),
    `Upstream directory does not look like a spovishun-skills package (missing skills/): ${upstreamRoot}`,
    'Ensure --upstream points to a valid spovishun-skills package root.'
  );

  return { configPath, lockfilePath, lockData };
}

function requireOrThrow(condition, message, actionable) {
  if (!condition) throw new ConfigError('MISSING_REQUIRED', message, actionable);
}

/**
 * Renders every upstream artifact and keys it by "<kind>:<id>".
 *
 * @returns {Map<string, {artifact: object, rendered: string, checksum: string}>}
 */
function buildUpstreamMap({ artifacts, configMap, targetDef }) {
  const map = new Map();
  for (const artifact of artifacts) {
    // Marker-ownership targets synthesize skill frontmatter and stamp a
    // provenance marker on skills/agents (see adapters/claude/index.js). Mirror
    // that here so the written body carries the marker, while the checksum is
    // taken over the marker-stripped body to stay invariant (matches lockfile +
    // on-disk).
    const { rendered, checksum } = renderArtifact(artifact, configMap, {
      mark: targetDef.ownership === 'marker',
    });
    map.set(`${artifact.kind}:${artifact.id}`, { artifact, rendered, checksum });
  }
  return map;
}

/**
 * All keys across lockfile + upstream, narrowed to `skillId` when --skill is given.
 * An id that matches nothing is a typo, not an empty result — it throws.
 */
function selectKeys({ lockEntryMap, upstreamMap }, skillId) {
  const allKeys = [...new Set([...lockEntryMap.keys(), ...upstreamMap.keys()])];
  if (!skillId) return allKeys;

  const filtered = allKeys.filter((k) => k.split(':')[1] === skillId);
  requireOrThrow(
    filtered.length > 0,
    `No artifact matching id "${skillId}" found in upstream or lockfile.`,
    'Check the available artifact ids in the upstream package.'
  );
  return filtered;
}

function unfilteredLockEntries(lockEntryMap, skillId) {
  return [...lockEntryMap]
    .filter(([key]) => key.split(':')[1] !== skillId)
    .map(([, entry]) => entry);
}

function emptySummary() {
  return {
    autoApplied: 0,
    conflicts: 0,
    newArtifacts: 0,
    removed: 0,
    restored: 0,
    localOnly: 0,
    unchanged: 0,
    rulesSkipped: 0,
    collisions: 0,
    adopted: 0,
    disowned: 0,
  };
}

/**
 * Only the 'marker' ownership model is wired up. For 'assume-owned' targets
 * (windsurf) the model is deferred — markers in chunked -part-N files need a
 * separate decision (spovishun-162) — so treat their files as owned to preserve
 * the pre-ownership classification.
 */
function ownershipOf({ targetDef, installedEntry, lockEntry }) {
  if (targetDef.ownership !== 'marker') return true;
  if (!installedEntry) return false;
  return installedEntry.hasMarker || (lockEntry != null && installedEntry.checksum === lockEntry.checksum);
}

function freshLock({ artifact }, checksum) {
  return { kind: artifact.kind, id: artifact.id, version: artifact.version, checksum };
}

/**
 * One pure planner per classifier action. Each returns
 *   { counter, lock, effect?: 'write' | 'conflict', note? }
 * — `counter` names the summary field to bump, `lock` is the entry to carry into
 * the new lockfile (null drops the id), `effect` is the write the caller performs
 * unless --dry-run, and `note` is an extra explanatory output line.
 *
 * Handlers that dereference `upstreamEntry` are only reachable with one present:
 * keys come from `lockEntryMap ∪ upstreamMap`, so a key with no lock entry
 * (NEW / ADOPT / COLLISION) is by construction an upstream key, and the
 * classifier returns REMOVED before any state that needs upstream otherwise.
 */
const ACTION_HANDLERS = Object.freeze({
  [ACTIONS.UNCHANGED]: ({ lockEntry }) => ({ counter: 'unchanged', lock: lockEntry }),

  [ACTIONS.LOCAL_ONLY]: ({ lockEntry }) => ({ counter: 'localOnly', lock: lockEntry }),

  // The locked file is gone. Restore it from upstream — same as `install` does.
  // See the MISSING_ON_DISK contract in lib/update-classifier.js.
  [ACTIONS.MISSING_ON_DISK]: ({ upstreamEntry }) => ({
    counter: 'restored',
    lock: freshLock(upstreamEntry, upstreamEntry.checksum),
    effect: 'write',
    note: '(locked file missing on disk — restored from upstream)',
  }),

  [ACTIONS.AUTO_APPLY]: ({ upstreamEntry }) => ({
    counter: 'autoApplied',
    lock: freshLock(upstreamEntry, upstreamEntry.checksum),
    effect: 'write',
  }),

  // Keep the old lock entry so the next run re-detects the conflict.
  [ACTIONS.CONFLICT]: ({ lockEntry }) => ({ counter: 'conflicts', lock: lockEntry, effect: 'conflict' }),

  [ACTIONS.NEW]: ({ upstreamEntry }) => ({
    counter: 'newArtifacts',
    lock: freshLock(upstreamEntry, upstreamEntry.checksum),
    effect: 'write',
  }),

  // Drop from lockfile — do NOT carry the entry.
  [ACTIONS.REMOVED]: () => ({
    counter: 'removed',
    lock: null,
    note: '(entry removed from lockfile; files on disk are kept — the next install/sync cleans them up)',
  }),

  // Owner wins: never write, never lock.
  [ACTIONS.COLLISION]: () => ({
    counter: 'collisions',
    lock: null,
    note: '(owner-authored file occupies this id — left untouched, not added to lockfile)',
  }),

  // Register on-disk as the merge baseline without overwriting this run.
  [ACTIONS.ADOPT]: ({ upstreamEntry, onDiskChecksum }) => ({
    counter: 'adopted',
    lock: freshLock(upstreamEntry, onDiskChecksum),
    note: '(marked file not in lockfile — registered on-disk content as baseline; rerun to merge)',
  }),

  // Leave the file, drop it from the lockfile.
  [ACTIONS.DISOWNED]: () => ({
    counter: 'disowned',
    lock: null,
    note: '(on-disk file no longer recognisably plugin-generated — left untouched, dropped from lockfile)',
  }),
});

/**
 * Classifies one artifact key, reports it, and performs the planned write.
 *
 * @returns {{counter: string, lock: object|null}}
 */
async function processKey(key, ctx) {
  const lockEntry = ctx.lockEntryMap.get(key) ?? null;

  // Rules are flat data files outside artifact-loader (no manifest), so they
  // never appear in the upstream map — without this guard every rule lock
  // entry would be misclassified as REMOVED and silently dropped. Rules are
  // regenerated wholesale by install/sync; update preserves their entries.
  if (key.startsWith('rule:')) {
    ctx.write(`  ${'RULE_SKIP'.padEnd(16)} ${key}\n`);
    return { counter: 'rulesSkipped', lock: lockEntry };
  }

  const upstreamEntry = ctx.upstreamMap.get(key) ?? null;
  const installedEntry = ctx.installedFiles.get(key) ?? null;
  const onDiskChecksum = installedEntry ? installedEntry.checksum : null;

  const action = classifyArtifact({
    upstream: upstreamEntry && { version: upstreamEntry.artifact.version, checksum: upstreamEntry.checksum },
    lockEntry,
    onDiskChecksum,
    onDiskOwned: ownershipOf({ targetDef: ctx.targetDef, installedEntry, lockEntry }),
  });

  ctx.write(`  ${action.padEnd(16)} ${key}\n`);

  const plan = ACTION_HANDLERS[action]({ lockEntry, upstreamEntry, onDiskChecksum });
  if (plan.note) ctx.write(`  ${plan.note}\n`);
  if (plan.effect && !ctx.dryRun) await applyPlan(plan, ctx, { upstreamEntry, installedEntry });

  return { counter: plan.counter, lock: plan.lock };
}

/**
 * Performs the write the plan asked for. Both adapters share one update
 * signature (see adapters/registry.js), so the conflict and non-conflict paths
 * differ only by the labels the diff markers carry — no target branching.
 */
async function applyPlan(plan, ctx, { upstreamEntry, installedEntry }) {
  const conflict = plan.effect === 'conflict';
  await ctx.targetDef.update({
    consumerCwd: ctx.cwd,
    upstreamEntry,
    installedEntry,
    conflict,
    ...(conflict && {
      oursLabel: relative(ctx.cwd, installedEntry.paths[0]),
      theirsLabel: `spovishun-skills@${ctx.pluginVersion}`,
    }),
  });
}

/**
 * Renders the closing "Done (...)" line. Pure — no filesystem, no streams — so
 * the counter wording can be tested on its own.
 */
export function formatSummary(summary, { dryRun = false } = {}) {
  const segments = [
    `auto-applied: ${summary.autoApplied}`,
    `conflicts: ${summary.conflicts}`,
    `new: ${summary.newArtifacts}`,
    `removed: ${summary.removed}`,
  ];

  const optional = [
    ['restored', (n) => `restored: ${n}`],
    ['collisions', (n) => `collisions: ${n}`],
    ['adopted', (n) => `adopted: ${n}`],
    ['disowned', (n) => `disowned: ${n}`],
    ['rulesSkipped', (n) => `rules skipped: ${n} (rules update via install/sync only)`],
  ];
  for (const [field, render] of optional) {
    if (summary[field] > 0) segments.push(render(summary[field]));
  }

  return `\nDone (${dryRun ? 'dry-run, ' : ''}${segments.join(', ')})\n`;
}
