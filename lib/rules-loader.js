import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { STACK_FLAGS } from './stack-filter.js';
import { renderTemplate } from './template-renderer.js';
import { sha256 } from './checksum.js';

/**
 * Version stamped on every `kind: rule` lockfile entry.
 *
 * Rules have no manifest and therefore no version of their own, so this is a
 * sentinel meaning "unversioned data artifact — the checksum is the identity".
 * Deliberately NOT the plugin version: that would flip every rule to
 * AUTO_APPLY on each release even when its body is byte-identical, turning a
 * no-op into diff noise.
 */
export const RULE_LOCK_VERSION = '0.0.0';

/**
 * Walks pkgRoot/rules/ recursively and returns each .md file as a flat list,
 * sorted by id. Rules are data files (no per-artifact manifest), so they are
 * not part of artifact-loader — every adapter consumes them through this
 * helper instead of carrying its own walker.
 *
 * Top-level groups double as the stack gate: a group whose directory name is a
 * known stack flag (`kotlin/`, `kmp/`, …) is collected only when that flag is
 * active in the consumer config. Any other group (`common/`) is unconditional.
 * This is what keeps Compose Multiplatform rules out of a JVM-only consumer
 * without giving rules a manifest of their own.
 *
 * Gating fails closed: with no flags passed, only ungated groups are returned.
 *
 * @param {string} pkgRoot — absolute path to the spovishun-skills package root
 * @param {object} [stackFlags] — active stack flags, e.g. { kotlin: true, kmp: true }
 * @returns {Array<{id: string, body: string}>} — id is the relative path with
 *   '/' separators and no .md extension (e.g. "common/git-workflow")
 */
export function collectRules(pkgRoot, stackFlags = {}) {
  return collectAllRules(pkgRoot, stackFlags).filter((rule) => rule.active);
}

/**
 * Every rule the package ships, each flagged with whether the current stack
 * selects it — one walk, one read per file.
 *
 * The de-selected rules are not noise: `install` needs them to decide which
 * files to delete when a flag goes off (reconcileStaleRules), and it needs
 * their bodies to prove a file on disk is one of ours before removing it.
 * Returning both halves from a single pass is what stops the Claude adapter
 * from walking rules/ a second time and re-rendering the whole package just to
 * build that oracle.
 *
 * @param {string} pkgRoot — absolute path to the spovishun-skills package root
 * @param {object} [stackFlags] — active stack flags, e.g. { kotlin: true, kmp: true }
 * @returns {Array<{id: string, body: string, active: boolean}>} — sorted by id
 */
export function collectAllRules(pkgRoot, stackFlags = {}) {
  if (!pkgRoot) return [];
  const rulesDir = join(pkgRoot, 'rules');
  if (!existsSync(rulesDir)) return [];

  const collected = [];
  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(rulesDir, entry.name);
    // A top-level group name that is a stack flag gates everything beneath it;
    // files sitting directly in rules/ are ungated.
    const active = entry.isDirectory() ? isGroupActive(entry.name, stackFlags) : true;
    if (entry.isDirectory()) walk(rulesDir, fullPath, active, collected);
    else collectFile(rulesDir, fullPath, entry.name, active, collected);
  }
  collected.sort((a, b) => a.id.localeCompare(b.id));
  return collected;
}

/**
 * Renders a rule and returns its lockfile entry. Every adapter goes through
 * this so a `kind: rule` entry means the same thing on all three targets: the
 * checksum always covers the RENDERED body (placeholders resolved), matching
 * how skill/agent checksums are taken.
 *
 * Takes the RENDERED body rather than the config map: every caller needs that
 * render anyway (to write the file, or to compare against what is on disk), and
 * re-deriving it here rendered each rule twice per install.
 *
 * @param {{id: string}} rule — as returned by collectRules
 * @param {string} rendered — the rule body with placeholders resolved
 * @returns {{kind: 'rule', id: string, version: string, checksum: string}}
 */
export function ruleLockEntry(rule, rendered) {
  return {
    kind: 'rule',
    id: rule.id,
    version: RULE_LOCK_VERSION,
    checksum: sha256(rendered),
  };
}

/**
 * Renders a rule body against the consumer config. Rules carry no manifest, so
 * there are no optional placeholders — every UPPER_SNAKE_CASE token must
 * resolve from config.
 */
export function renderRule(rule, configMap) {
  return renderTemplate(rule.body, { configMap, manifestPlaceholders: [] });
}

/**
 * A group is gated only when its name is a known stack flag; unknown names
 * (`common/`) are always active, so adding a rules group never silently hides
 * it behind a flag that does not exist.
 */
function isGroupActive(groupName, stackFlags) {
  if (!STACK_FLAGS.includes(groupName)) return true;
  return stackFlags?.[groupName] === true;
}

function walk(baseDir, currentDir, active, out) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walk(baseDir, fullPath, active, out);
    } else {
      collectFile(baseDir, fullPath, entry.name, active, out);
    }
  }
}

function collectFile(baseDir, fullPath, name, active, out) {
  if (!name.endsWith('.md')) return;
  const rel = relative(baseDir, fullPath).split(/[\\/]/).join('/');
  const id = rel.replace(/\.md$/, '');
  out.push({ id, body: readFileSync(fullPath, 'utf8'), active });
}
