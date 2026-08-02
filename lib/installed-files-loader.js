import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sha256 } from './checksum.js';
import { stripMarker, hasMarker } from './marker.js';
import { readLockfile, LOCKFILE_NAME } from './lockfile.js';
import { readWindsurfManifest } from './windsurf-manifest.js';

/**
 * Reads currently-installed artifact files from disk, one reader per target.
 *
 * Every reader returns a Map keyed by "<kind>:<id>" with:
 *   { paths: string[], content: string, checksum: string }
 *
 * - claude:   scans .claude/skills/*.md, .claude/agents/*.md and .claude/rules/**.md
 * - windsurf: reads .windsurf/rules/.spovishun-manifest.json for the
 *             filename → {kind, id} attribution, concatenating chunks to
 *             restore full content; falls back to filename parsing
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

/**
 * Reads `.windsurf/rules/` back into lockfile-shaped keys.
 *
 * `.windsurf/rules/` is flat, so the adapter flattens three id namespaces into
 * one filename space and the mapping is lossy (see lib/windsurf-manifest.js).
 * The manifest the adapter emits is therefore the source of truth here; the
 * filename-parsing branch below exists only for installs made before the
 * manifest existed and can be dropped one minor release after 1.21.0.
 */
export function loadWindsurfFiles(consumerCwd) {
  const rulesDir = join(consumerCwd, '.windsurf', 'rules');
  if (!existsSync(rulesDir)) return new Map();

  const manifest = readWindsurfManifest(rulesDir);
  return manifest
    ? fromWindsurfManifest(rulesDir, manifest)
    : fromWindsurfFilenames(rulesDir, lockedWindsurfBaseIds(consumerCwd));
}

/**
 * Groups the files the manifest attributes to us by `<kind>:<id>`, restoring
 * chunked bodies by concatenating in `part` order.
 *
 * Supporting files are deliberately dropped: they carry no lock entry of their
 * own on any target — the claude adapter writes them alongside the body and
 * only when the body is written — so surfacing them as separate ids would
 * invent ownership keys nothing else in the pipeline knows about.
 */
function fromWindsurfManifest(rulesDir, manifest) {
  const groups = new Map(); // "<kind>:<id>" → [{part, path}]

  for (const [filename, entry] of Object.entries(manifest)) {
    if (entry.role !== 'body') continue;
    const fullPath = join(rulesDir, filename);
    // A file listed in the manifest but gone from disk is a real state
    // (MISSING_ON_DISK), so leave the gap rather than inventing content.
    if (!existsSync(fullPath)) continue;
    const key = `${entry.kind}:${entry.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ part: entry.part ?? 1, path: fullPath });
  }

  return buildWindsurfEntries(groups);
}

/**
 * Legacy reader for installs predating the manifest.
 *
 * `known` maps a flattened base name back to its lockfile identity, which is
 * what resolves the one genuine ambiguity in the naming scheme: `foo-part-1.md`
 * is chunk 1 of `foo` unless `foo-part-1` is itself a locked id. The old reader
 * had no such tiebreaker and always chose the chunk reading, so an artifact
 * literally named `foo-part-1` was swallowed by `foo`.
 *
 * With no lockfile at all (`known` empty) this degrades to exactly the previous
 * greedy behaviour — the best guess available.
 */
function fromWindsurfFilenames(rulesDir, known) {
  const partPattern = /^(.+)-part-(\d+)\.md$/;
  const groups = new Map(); // "<kind>:<id>" → [{part, path}]

  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const fullPath = join(rulesDir, entry.name);

    const wholeBase = entry.name.slice(0, -'.md'.length);
    const partMatch = partPattern.exec(entry.name);
    const chunked = partMatch != null && !known.has(wholeBase);

    const base = chunked ? partMatch[1] : wholeBase;
    const part = chunked ? parseInt(partMatch[2], 10) : 1;

    const key = known.get(base) ?? guessWindsurfKey(base);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ part, path: fullPath });
  }

  return buildWindsurfEntries(groups);
}

function buildWindsurfEntries(groups) {
  const map = new Map();
  for (const [key, files] of groups) {
    const sorted = files.sort((a, b) => a.part - b.part);
    const paths = sorted.map((f) => f.path);
    const content = paths.map((p) => readFileSync(p, 'utf8')).join('');
    // Windsurf bodies carry no provenance marker (nothing is written with
    // `mark`), so ownership for this target is decided by checksum alone.
    map.set(key, { paths, content, checksum: sha256(content), hasMarker: false });
  }
  return map;
}

/**
 * Reverse index from the flattened base name the adapter writes back to the
 * `<kind>:<id>` the lockfile records. Empty when there is no lockfile yet.
 */
function lockedWindsurfBaseIds(consumerCwd) {
  const lock = readLockfile(join(consumerCwd, LOCKFILE_NAME));
  const known = new Map();
  for (const entry of lock?.artifacts ?? []) {
    const base =
      entry.kind === 'template' ? `templates--${entry.id}` : entry.id.replace(/\//g, '--');
    known.set(base, `${entry.kind}:${entry.id}`);
  }
  return known;
}

/**
 * Last resort when neither the manifest nor the lockfile can name a file: the
 * pre-1.21.0 guess. Wrong for rules and supporting files, which is precisely
 * why the manifest exists — but it is only reachable on an install that has
 * neither artefact.
 */
function guessWindsurfKey(base) {
  return base.startsWith('templates--')
    ? `template:${base.slice('templates--'.length)}`
    : `skill:${base}`;
}

export function loadCodexFiles(consumerCwd) {
  const map = new Map();
  const agentsMd = join(consumerCwd, 'AGENTS.md');
  if (!existsSync(agentsMd)) return map;
  const content = readFileSync(agentsMd, 'utf8');
  map.set('file:AGENTS.md', { paths: [agentsMd], content, checksum: sha256(content) });
  return map;
}
