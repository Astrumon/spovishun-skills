import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Buffer } from 'node:buffer';
import { filterByStack } from '../../lib/stack-filter.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { sha256 } from '../../lib/checksum.js';
import { buildAgentsMd } from './build-agents-md.js';

export const AGENTS_MD_FILENAME = 'AGENTS.md';
export const SIZE_LIMIT_BYTES = 32 * 1024;

const CODEX_KINDS = new Set(['skill', 'agent', 'template']);

/**
 * Generates AGENTS.md for Codex at the consumer project root.
 *
 * Skips hooks and other Claude-only artifacts. Renders Mustache placeholders
 * the same way the Claude adapter does. If the resulting file exceeds the
 * 32 KiB AGENTS.md soft limit, emits a stderr warning but still writes the file.
 *
 * @param {object} opts
 * @param {string}   opts.consumerCwd    — absolute path to consumer project root
 * @param {string}   opts.pkgRoot        — absolute path to the spovishun-skills package root (for rules/)
 * @param {object}   opts.config         — validated consumer config
 * @param {Array}    opts.artifacts      — all loaded artifacts from loadArtifacts()
 * @param {string}   opts.pluginVersion  — version string for the AGENTS.md header
 * @param {object}   [opts.warn]         — writable stream for warnings (default: process.stderr)
 * @returns {Array<{kind, id, version, checksum}>} — lockfile entries for included artifacts
 */
export async function installCodex({
  consumerCwd,
  pkgRoot,
  config,
  artifacts,
  pluginVersion,
  warn = process.stderr,
}) {
  const stackFiltered = filterByStack(artifacts, config.stack ?? {});
  const included = stackFiltered.filter((a) => CODEX_KINDS.has(a.kind));
  const rules = collectRules(pkgRoot);
  const configMap = buildPlaceholderMap(config);

  const content = buildAgentsMd({
    artifacts: included,
    rules,
    config,
    configMap,
    pluginVersion,
    warn,
  });

  const outPath = join(consumerCwd, AGENTS_MD_FILENAME);
  writeFileSync(outPath, content, 'utf8');

  const byteSize = Buffer.byteLength(content, 'utf8');
  if (byteSize > SIZE_LIMIT_BYTES) {
    const kib = (byteSize / 1024).toFixed(1);
    warn.write(
      `Warning: AGENTS.md is ${kib} KiB (>32 KiB Codex soft limit). Codex may truncate. ` +
        `Consider splitting universal/global instructions into ~/.codex/AGENTS.md and ` +
        `keeping project-specific content in ./AGENTS.md.\n`
    );
  }

  const artifactEntries = included.map((artifact) => ({
    kind: artifact.kind,
    id: artifact.id,
    version: artifact.version,
    checksum: sha256(artifact.bodyText),
  }));

  const ruleEntries = rules.map((rule) => ({
    kind: 'rule',
    id: rule.id,
    version: '0.0.0',
    checksum: sha256(rule.body),
  }));

  return [...artifactEntries, ...ruleEntries];
}

/**
 * Walks pkgRoot/rules/ recursively and returns each .md file as a flat list.
 * Rules in this repo are data files (not artifact-loader entries), so we walk
 * them directly the same way installClaude does.
 */
function collectRules(pkgRoot) {
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
