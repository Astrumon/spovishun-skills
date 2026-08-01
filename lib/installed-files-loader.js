import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sha256 } from './checksum.js';
import { stripMarker, hasMarker } from './marker.js';

/**
 * Reads currently-installed artifact files from disk, one reader per target.
 *
 * Every reader returns a Map keyed by "<kind>:<id>" with:
 *   { paths: string[], content: string, checksum: string }
 *
 * - claude:   scans .claude/skills/*.md, .claude/agents/*.md and .claude/rules/**.md
 * - windsurf: scans .windsurf/rules/*.md, groups part files by id,
 *             concatenates chunks to restore full content
 * - codex:    reads AGENTS.md as a whole (key "file:AGENTS.md")
 *
 * There is deliberately no `loadInstalledFiles(cwd, target)` dispatcher here:
 * target → reader is one column of the table in adapters/registry.js, and lib/
 * must not know which targets exist (see the layer rules in CLAUDE.md).
 *
 * @param {string} consumerCwd  — absolute path to consumer project root
 * @returns {Map<string, {paths: string[], content: string, checksum: string}>}
 */
export function loadClaudeFiles(consumerCwd) {
  const map = new Map();
  const claudeDir = join(consumerCwd, '.claude');

  const layouts = [
    ['skill', 'skills', 'SKILL.md'],
    ['agent', 'agents', 'AGENT.md'],
    ['template', '_templates', 'TEMPLATE.md'],
  ];

  for (const [kind, subdir, bodyFilename] of layouts) {
    const dir = join(claudeDir, subdir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Folder layout: .claude/{subdir}/{id}/{BODY}.md
      if (entry.isDirectory()) {
        const bodyPath = join(dir, entry.name, bodyFilename);
        if (!existsSync(bodyPath)) continue;
        const content = readFileSync(bodyPath, 'utf8');
        map.set(`${kind}:${entry.name}`, claudeEntry([bodyPath], content));
        continue;
      }
      // Legacy flat layout: .claude/{subdir}/{id}.md (pre-v1.2.0).
      // Still recognized so `update` / `sync` can three-way merge against existing installs
      // before they are migrated by the next `install`.
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const id = entry.name.replace(/\.md$/, '');
        const fullPath = join(dir, entry.name);
        const content = readFileSync(fullPath, 'utf8');
        map.set(`${kind}:${id}`, claudeEntry([fullPath], content));
      }
    }
  }

  collectClaudeRules(join(claudeDir, 'rules'), map);

  return map;
}

/**
 * Walks .claude/rules/ recursively and registers each .md file under
 * `rule:<id>`, where the id is the relative path with '/' separators and no
 * extension — the same id shape collectRules() produces, so lock entries and
 * on-disk files line up.
 *
 * Unlike skills and agents, rules carry no YAML frontmatter and therefore no
 * `x-spovishun` provenance marker: the checksum is taken over the RAW body
 * (the claude adapter writes rules without markBody) and `hasMarker` is always
 * false. Ownership of a rule can only ever be decided by checksum equality.
 */
function collectClaudeRules(rulesDir, map, baseDir = rulesDir) {
  if (!existsSync(rulesDir)) return;
  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(rulesDir, entry.name);
    if (entry.isDirectory()) {
      collectClaudeRules(fullPath, map, baseDir);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const id = relative(baseDir, fullPath).split(/[\\/]/).join('/').replace(/\.md$/, '');
    const content = readFileSync(fullPath, 'utf8');
    map.set(`rule:${id}`, { paths: [fullPath], content, checksum: sha256(content), hasMarker: false });
  }
}

/**
 * Builds a loader entry for a Claude artifact. The checksum is taken over the
 * marker-stripped body so it stays invariant to provenance-marker presence —
 * this is what lets pre-marker installs match their lockfile checksum and be
 * recognised as owned. `hasMarker` records the raw signal for the ownership
 * predicate; `content` stays raw so update's three-way merge preserves the
 * marker carried on the "ours" side.
 */
function claudeEntry(paths, content) {
  return { paths, content, checksum: sha256(stripMarker(content)), hasMarker: hasMarker(content) };
}

export function loadWindsurfFiles(consumerCwd) {
  const map = new Map();
  const rulesDir = join(consumerCwd, '.windsurf', 'rules');
  if (!existsSync(rulesDir)) return map;

  // Collect all .md files grouped by base id.
  // Files:  <id>.md  or  <id>-part-N.md
  const partPattern = /^(.+)-part-(\d+)\.md$/;
  const wholePattern = /^(.+)\.md$/;

  const groups = new Map(); // id → { whole: path|null, parts: [{n, path}] }

  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fullPath = join(rulesDir, entry.name);

    const partMatch = partPattern.exec(entry.name);
    if (partMatch) {
      const id = partMatch[1];
      const n = parseInt(partMatch[2], 10);
      if (!groups.has(id)) groups.set(id, { whole: null, parts: [] });
      groups.get(id).parts.push({ n, path: fullPath });
      continue;
    }

    const wholeMatch = wholePattern.exec(entry.name);
    if (wholeMatch) {
      const id = wholeMatch[1];
      if (!groups.has(id)) groups.set(id, { whole: null, parts: [] });
      groups.get(id).whole = fullPath;
    }
  }

  for (const [id, group] of groups) {
    let content;
    let paths;

    if (group.parts.length > 0) {
      // Chunked file — concatenate in part order
      const sorted = group.parts.sort((a, b) => a.n - b.n);
      paths = sorted.map((p) => p.path);
      content = sorted.map((p) => readFileSync(p.path, 'utf8')).join('');
    } else {
      paths = [group.whole];
      content = readFileSync(group.whole, 'utf8');
    }

    // Templates are written with a `templates--` filename prefix (see
    // adapters/windsurf/index.js) but locked under kind 'template' with the
    // bare id — restore that keying here so update can match them.
    // Rules never reach this map's consumers: update skips `rule:` lock
    // entries entirely (rules are regenerated by install/sync).
    const key = id.startsWith('templates--')
      ? `template:${id.slice('templates--'.length)}`
      : `skill:${id}`;
    map.set(key, { paths, content, checksum: sha256(content) });
  }

  return map;
}

export function loadCodexFiles(consumerCwd) {
  const map = new Map();
  const agentsMd = join(consumerCwd, 'AGENTS.md');
  if (!existsSync(agentsMd)) return map;
  const content = readFileSync(agentsMd, 'utf8');
  map.set('file:AGENTS.md', { paths: [agentsMd], content, checksum: sha256(content) });
  return map;
}
