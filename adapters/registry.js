import { ConfigError } from '../lib/errors.js';
import { loadClaudeFiles, loadWindsurfFiles, loadCodexFiles } from '../lib/installed-files-loader.js';
import { installClaude } from './claude/index.js';
import { updateClaude } from './claude/update.js';
import { installCodex } from './codex/index.js';
import { installWindsurf } from './windsurf/index.js';
import { updateWindsurf } from './windsurf/update.js';

/**
 * The one place that knows which targets exist.
 *
 * Before this table, `claude | codex | windsurf` was re-branched by hand in
 * bin/install.js, bin/update.js (four times), bin/doctor.js and
 * lib/installed-files-loader.js — seven sites, each free to forget a target.
 * Adding one now means adding an adapter directory and one row here.
 *
 * This module is the composition root: it may import from every adapter and
 * from lib/, and NOTHING in lib/ or adapters/<target>/ may import it. An
 * adapter reaching back for the registry would close an import cycle and break
 * the layer rule in CLAUDE.md — adapters/claude/index.js therefore imports
 * loadClaudeFiles straight from lib/.
 *
 * Columns:
 *   install        — ({consumerCwd, pkgRoot, config, artifacts, pluginVersion, force, warn})
 *                    → Array<lockEntry>. Every adapter takes the full object and
 *                    destructures what it needs; the uniform signature is what
 *                    makes the table callable without per-target argument code.
 *   update         — ({consumerCwd, upstreamEntry, installedEntry, conflict, oursLabel, theirsLabel})
 *                    or null when the target cannot be updated per-artifact.
 *   readInstalled  — (consumerCwd) → Map<"<kind>:<id>", entry> of what is on disk.
 *   hint           — what `install` prints as the destination.
 *   ownership      — how a file on disk is recognised as plugin-generated:
 *                      'marker'   — x-spovishun frontmatter marker, else checksum equality
 *                      'checksum' — content equality alone, for bodies written without a
 *                                   marker (windsurf writes plain markdown; so do rules)
 *                      'none'     — no per-artifact files to own (codex inlines everything
 *                                   into a single AGENTS.md)
 *   supportsUpdate — mirrors `update !== null`; asserted in test/registry.test.js so the two
 *                    can never drift.
 */
export const TARGETS = Object.freeze({
  claude: Object.freeze({
    install: installClaude,
    update: updateClaude,
    readInstalled: loadClaudeFiles,
    hint: '.claude/',
    ownership: 'marker',
    supportsUpdate: true,
  }),
  codex: Object.freeze({
    install: installCodex,
    update: null,
    readInstalled: loadCodexFiles,
    hint: 'AGENTS.md',
    ownership: 'none',
    supportsUpdate: false,
  }),
  windsurf: Object.freeze({
    install: installWindsurf,
    update: updateWindsurf,
    readInstalled: loadWindsurfFiles,
    hint: '.windsurf/rules/',
    ownership: 'checksum',
    supportsUpdate: true,
  }),
});

/** Supported target names, in CLI help order. */
export const TARGET_NAMES = Object.keys(TARGETS);

/**
 * Looks up a target definition, throwing an actionable error for anything else.
 * Use this rather than indexing TARGETS directly so an unknown target always
 * fails loudly instead of yielding `undefined` and a silent no-op.
 *
 * @param {string} name
 * @returns {typeof TARGETS[keyof typeof TARGETS]}
 */
export function getTarget(name) {
  const target = TARGETS[name];
  if (target) return target;
  throw new ConfigError(
    'SCHEMA_VIOLATION',
    `Unknown target: "${name}". Supported targets: ${TARGET_NAMES.join(', ')}`,
    `Use ${TARGET_NAMES.map((t) => `--target=${t}`).join(', ')} (cursor is planned for V1).`
  );
}

/**
 * Like getTarget, but returns null instead of throwing — for read paths such as
 * `doctor`, which must report on a lockfile naming a target it does not know
 * rather than crash on it.
 *
 * @param {string|undefined|null} name
 * @returns {object|null}
 */
export function findTarget(name) {
  return (name && TARGETS[name]) || null;
}
