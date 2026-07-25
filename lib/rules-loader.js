import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { STACK_FLAGS } from './stack-filter.js';

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
  if (!pkgRoot) return [];
  const rulesDir = join(pkgRoot, 'rules');
  if (!existsSync(rulesDir)) return [];

  const collected = [];
  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && !isGroupActive(entry.name, stackFlags)) continue;
    const fullPath = join(rulesDir, entry.name);
    if (entry.isDirectory()) walk(rulesDir, fullPath, collected);
    else collectFile(rulesDir, fullPath, entry.name, collected);
  }
  collected.sort((a, b) => a.id.localeCompare(b.id));
  return collected;
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

function walk(baseDir, currentDir, out) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walk(baseDir, fullPath, out);
    } else {
      collectFile(baseDir, fullPath, entry.name, out);
    }
  }
}

function collectFile(baseDir, fullPath, name, out) {
  if (!name.endsWith('.md')) return;
  const rel = relative(baseDir, fullPath).split(/[\\/]/).join('/');
  const id = rel.replace(/\.md$/, '');
  out.push({ id, body: readFileSync(fullPath, 'utf8') });
}
