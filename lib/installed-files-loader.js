import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './checksum.js';

/**
 * Reads currently-installed artifact files from disk for the given target.
 *
 * Returns a Map keyed by "<kind>:<id>" with:
 *   { paths: string[], content: string, checksum: string }
 *
 * - claude:   scans .claude/skills/*.md and .claude/agents/*.md
 * - windsurf: scans .windsurf/rules/*.md, groups part files by id,
 *             concatenates chunks to restore full content
 * - codex:    reads AGENTS.md as a whole (key "file:AGENTS.md")
 *
 * @param {string} consumerCwd  — absolute path to consumer project root
 * @param {string} target       — "claude" | "windsurf" | "codex"
 * @returns {Map<string, {paths: string[], content: string, checksum: string}>}
 */
export function loadInstalledFiles(consumerCwd, target) {
  if (target === 'claude') return loadClaude(consumerCwd);
  if (target === 'windsurf') return loadWindsurf(consumerCwd);
  if (target === 'codex') return loadCodex(consumerCwd);
  return new Map();
}

function loadClaude(consumerCwd) {
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
        map.set(`${kind}:${entry.name}`, { paths: [bodyPath], content, checksum: sha256(content) });
        continue;
      }
      // Legacy flat layout: .claude/{subdir}/{id}.md (pre-v1.2.0).
      // Still recognized so `update` / `sync` can three-way merge against existing installs
      // before they are migrated by the next `install`.
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const id = entry.name.replace(/\.md$/, '');
        const fullPath = join(dir, entry.name);
        const content = readFileSync(fullPath, 'utf8');
        map.set(`${kind}:${id}`, { paths: [fullPath], content, checksum: sha256(content) });
      }
    }
  }

  return map;
}

function loadWindsurf(consumerCwd) {
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

    // Windsurf only installs 'skill' kind artifacts via the installWindsurf adapter.
    // Rules are installed as flat files without a lockfile entry keyed by kind:id;
    // the updater handles rules separately, so we skip them here.
    map.set(`skill:${id}`, { paths, content, checksum: sha256(content) });
  }

  return map;
}

function loadCodex(consumerCwd) {
  const map = new Map();
  const agentsMd = join(consumerCwd, 'AGENTS.md');
  if (!existsSync(agentsMd)) return map;
  const content = readFileSync(agentsMd, 'utf8');
  map.set('file:AGENTS.md', { paths: [agentsMd], content, checksum: sha256(content) });
  return map;
}
