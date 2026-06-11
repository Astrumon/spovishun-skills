import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Walks pkgRoot/rules/ recursively and returns each .md file as a flat list,
 * sorted by id. Rules are data files (no per-artifact manifest), so they are
 * not part of artifact-loader — every adapter consumes them through this
 * helper instead of carrying its own walker.
 *
 * @param {string} pkgRoot — absolute path to the spovishun-skills package root
 * @returns {Array<{id: string, body: string}>} — id is the relative path with
 *   '/' separators and no .md extension (e.g. "common/git-workflow")
 */
export function collectRules(pkgRoot) {
  if (!pkgRoot) return [];
  const rulesDir = join(pkgRoot, 'rules');
  if (!existsSync(rulesDir)) return [];

  const collected = [];
  walk(rulesDir, rulesDir, collected);
  collected.sort((a, b) => a.id.localeCompare(b.id));
  return collected;
}

function walk(baseDir, currentDir, out) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walk(baseDir, fullPath, out);
    } else if (entry.name.endsWith('.md')) {
      const rel = relative(baseDir, fullPath).split(/[\\/]/).join('/');
      const id = rel.replace(/\.md$/, '');
      out.push({ id, body: readFileSync(fullPath, 'utf8') });
    }
  }
}
