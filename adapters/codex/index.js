import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { filterByStack } from '../../lib/stack-filter.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { collectRules, ruleLockEntry } from '../../lib/rules-loader.js';
import { renderArtifact } from '../../lib/render-artifact.js';
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
 * Takes the uniform installer argument object (see adapters/registry.js) and
 * destructures the fields it uses; `force` is not among them — AGENTS.md is
 * regenerated wholesale on every install, so there is no per-artifact edit to
 * preserve or overwrite.
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

  const ruleEntries = rules.map((rule) => ruleLockEntry(rule, configMap));

  return [...artifactEntries, ...ruleEntries];
}

