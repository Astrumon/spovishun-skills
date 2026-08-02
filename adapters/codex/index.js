import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { filterByStack } from '../../lib/stack-filter.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { collectRules, renderRule, ruleLockEntry } from '../../lib/rules-loader.js';
import { renderArtifact } from '../../lib/render-artifact.js';
// Imported straight from lib/, never via adapters/registry.js — the registry
// imports this adapter, so reaching back for it would close a cycle.
import { loadCodexFiles } from '../../lib/installed-files-loader.js';
import { buildAgentsMd } from './build-agents-md.js';

export const AGENTS_MD_FILENAME = 'AGENTS.md';
export const SIZE_LIMIT_BYTES = 32 * 1024;

const CODEX_KINDS = new Set(['skill', 'agent', 'template']);

/**
 * Generates AGENTS.md for Codex at the consumer project root.
 *
 * Skips hooks and other Claude-only artifacts. Renders {{KEY}} placeholders
 * the same way the Claude adapter does. If the resulting file exceeds the
 * 32 KiB AGENTS.md soft limit, emits a stderr warning but still writes the file.
 *
 * Codex is the one target with `ownership: 'none'` — AGENTS.md inlines every
 * body, so there is no per-artifact file to own, classify or merge, and no
 * meaning for `--force` (which is why it is not destructured). That is a real
 * limitation rather than an oversight, so it is stated out loud: a regeneration
 * that would discard local content warns instead of overwriting silently.
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
  const rules = collectRules(pkgRoot, config.stack ?? {});
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
  warnOnOverwrite(consumerCwd, content, warn);
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

  // Checksums cover the RENDERED body (placeholders resolved) — same semantics
  // as the claude and windsurf adapters, so lock entries mean the same thing
  // regardless of target.
  const artifactEntries = included.map((artifact) => {
    // No marker: codex inlines every body into AGENTS.md, so there is no
    // per-artifact file to stamp. stripMarker is a no-op on an unmarked body,
    // which keeps this checksum identical to the pre-registry one.
    const { checksum } = renderArtifact(artifact, configMap);
    return {
      kind: artifact.kind,
      id: artifact.id,
      version: artifact.version,
      checksum,
    };
  });

  const ruleEntries = rules.map((rule) => ruleLockEntry(rule, renderRule(rule, configMap)));

  return [...artifactEntries, ...ruleEntries];
}

/**
 * Says out loud that this install is about to discard content.
 *
 * Deliberately conditional on the content actually DIFFERING, not merely on the
 * file existing: an idempotent re-install is the common case, and a warning that
 * fires every time is a warning nobody reads. So this only speaks when there is
 * genuinely something to lose — which is also the only time it can be acted on.
 */
function warnOnOverwrite(consumerCwd, content, warn) {
  const existing = loadCodexFiles(consumerCwd).get(`file:${AGENTS_MD_FILENAME}`);
  if (!existing || existing.content === content) return;

  warn.write(
    `Warning: ${AGENTS_MD_FILENAME} already exists and differs — regenerated wholesale. ` +
      `Codex has no per-artifact ownership model (every body is inlined into this one file), ` +
      `so local edits to it cannot be preserved or merged. ` +
      `Edit the canonical bodies under skills/ or rules/ instead.\n`
  );
}

