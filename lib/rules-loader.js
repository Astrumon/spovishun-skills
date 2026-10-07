import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { load as parseYaml, CORE_SCHEMA } from 'js-yaml';
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
 * A rule may narrow that further with `requires:` in its frontmatter (see
 * parseRuleFrontmatter): the group gate and every listed flag must all hold.
 *
 * Gating fails closed: with no flags passed, only ungated groups are returned.
 *
 * @param {string} pkgRoot — absolute path to the spovishun-skills package root
 * @param {object} [stackFlags] — active stack flags, e.g. { kotlin: true, kmp: true }
 * @returns {Array<{id: string, body: string, paths: string[], requires: string[]}>}
 *   — id is the relative path with '/' separators and no .md extension
 *   (e.g. "common/git-workflow"); body has its frontmatter stripped
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
 * @returns {Array<{id: string, body: string, paths: string[], requires: string[], active: boolean}>}
 *   — sorted by id
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
    if (entry.isDirectory()) walk(rulesDir, fullPath, active, stackFlags, collected);
    else collectFile(rulesDir, fullPath, entry.name, active, stackFlags, collected);
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
 * @param {string} rendered — the text the target writes: placeholders resolved
 *   and passed through formatRule, so the checksum matches the file on disk
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
 * Turns a rendered rule body into the exact text a target writes, translating
 * the rule's `paths:` scope into that target's own vocabulary:
 *
 *   - claude   — `paths:` frontmatter (Claude Code path-scoped rule: loaded only
 *                when the agent works with a matching file)
 *   - windsurf — `trigger: glob` + `globs:` frontmatter
 *   - codex    — AGENTS.md has no scoping, so an "Applies to" line instead
 *
 * `requires:` is package-side gating and never reaches the consumer. A rule
 * without `paths` comes back unchanged on every target. The result is the file
 * on disk, so it is also what the lock checksum must cover.
 *
 * @param {{paths?: string[]}} rule — as returned by collectRules
 * @param {string} rendered — body with placeholders resolved (renderRule)
 * @param {'claude'|'windsurf'|'codex'} target
 * @returns {string}
 */
export function formatRule(rule, rendered, target) {
  const paths = rule.paths ?? [];
  if (paths.length === 0) return rendered;
  switch (target) {
    case 'claude':
      return `---\npaths:\n${paths.map((p) => `  - "${p}"`).join('\n')}\n---\n\n${rendered}`;
    case 'windsurf':
      return `---\ntrigger: glob\nglobs: ${paths.join(', ')}\n---\n\n${rendered}`;
    case 'codex':
      return `_Applies to: ${paths.map((p) => `\`${p}\``).join(', ')}_\n\n${rendered}`;
    default:
      throw new Error(`formatRule: unknown target "${target}"`);
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const RULE_FRONTMATTER_KEYS = ['paths', 'requires'];

/**
 * Splits a rule source into its frontmatter and body. Rules have no manifest,
 * so the frontmatter is all the metadata they carry, and it is held to a
 * closed key set: a typo (`path:`, `require:`) would otherwise ship an
 * unscoped, always-loaded rule without a word — the exact outcome scoping
 * exists to prevent.
 *
 *   paths:    globs the rule applies to; translated per target by formatRule
 *   requires: stack flags that must all be on, on top of the group gate
 *
 * @param {string} source — raw rule file
 * @param {string} id — rule id, for error messages
 * @returns {{body: string, paths: string[], requires: string[]}}
 * @throws {Error} on malformed YAML, an unknown key, or an unknown stack flag
 */
export function parseRuleFrontmatter(source, id) {
  const match = source.match(FRONTMATTER_RE);
  if (!match) return { body: source, paths: [], requires: [] };

  let data;
  try {
    data = parseYaml(match[1], { schema: CORE_SCHEMA }) ?? {};
  } catch (err) {
    throw new Error(`rule ${id}: frontmatter is not valid YAML — ${err.message}`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`rule ${id}: frontmatter must be a mapping`);
  }
  for (const key of Object.keys(data)) {
    if (!RULE_FRONTMATTER_KEYS.includes(key)) {
      throw new Error(`rule ${id}: unknown frontmatter key "${key}" (allowed: ${RULE_FRONTMATTER_KEYS.join(', ')})`);
    }
  }
  const paths = stringList(data.paths, id, 'paths');
  const requires = stringList(data.requires, id, 'requires');
  for (const flag of requires) {
    if (!STACK_FLAGS.includes(flag)) {
      throw new Error(`rule ${id}: requires unknown stack flag "${flag}" (known: ${STACK_FLAGS.join(', ')})`);
    }
  }
  return { body: source.slice(match[0].length).replace(/^\r?\n/, ''), paths, requires };
}

function stringList(value, id, key) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === 'string' && v.length > 0)) {
    throw new Error(`rule ${id}: frontmatter "${key}" must be a non-empty list of strings`);
  }
  return value;
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

function walk(baseDir, currentDir, groupActive, stackFlags, out) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walk(baseDir, fullPath, groupActive, stackFlags, out);
    } else {
      collectFile(baseDir, fullPath, entry.name, groupActive, stackFlags, out);
    }
  }
}

function collectFile(baseDir, fullPath, name, groupActive, stackFlags, out) {
  if (!name.endsWith('.md')) return;
  const rel = relative(baseDir, fullPath).split(/[\\/]/).join('/');
  const id = rel.replace(/\.md$/, '');
  const { body, paths, requires } = parseRuleFrontmatter(readFileSync(fullPath, 'utf8'), id);
  const active = groupActive && requires.every((flag) => stackFlags?.[flag] === true);
  out.push({ id, body, paths, requires, active });
}
