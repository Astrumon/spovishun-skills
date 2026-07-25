import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { filterByStack } from '../../lib/stack-filter.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { collectRules } from '../../lib/rules-loader.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import { sha256 } from '../../lib/checksum.js';
import { readLockfile, LOCKFILE_NAME } from '../../lib/lockfile.js';

export const RULES_DIR = '.windsurf/rules';
export const CHAR_LIMIT = 6000;

const WINDSURF_KINDS = new Set(['skill', 'template']);

/**
 * Generates .windsurf/rules/*.md for Windsurf from stack-filtered skills, templates, and rules.
 *
 * Each skill, template, and rule gets its own .md file. Skills/templates with
 * supporting `references/` or `assets/` files generate additional rule files
 * named `{id}--{relpath-with-double-dash}.md`. Templates are prefixed with
 * `templates--` to keep them visually grouped. If a rendered file exceeds
 * CHAR_LIMIT characters it is split into `<id>-part-1.md`, `<id>-part-2.md`, ...
 * Agent and hook artifacts are skipped (Windsurf has no agent concept). Binary
 * supporting files are skipped with a stderr warning.
 *
 * @param {object} opts
 * @param {string}   opts.consumerCwd   — absolute path to consumer project root
 * @param {string}   opts.pkgRoot       — absolute path to the spovishun-skills package root (for rules/)
 * @param {object}   opts.config        — validated consumer config
 * @param {Array}    opts.artifacts     — all loaded artifacts from loadArtifacts()
 * @param {object}   [opts.warn]        — writable stream for warnings (default: process.stderr)
 * @returns {Array<{kind, id, version, checksum}>} — lockfile entries for installed artifacts
 */
export async function installWindsurf({ consumerCwd, pkgRoot, config, artifacts, warn = process.stderr }) {
  const stackFiltered = filterByStack(artifacts, config.stack ?? {});
  const included = stackFiltered.filter((a) => WINDSURF_KINDS.has(a.kind));
  const rules = collectRules(pkgRoot, config.stack ?? {});
  const configMap = buildPlaceholderMap(config);

  const rulesDir = join(consumerCwd, RULES_DIR);
  mkdirSync(rulesDir, { recursive: true });

  const lockEntries = [];
  const written = new Set();

  for (const artifact of included) {
    const manifestPlaceholders = (artifact.manifest?.placeholders ?? []).map((p) => p.key);
    const rendered = renderTemplate(artifact.bodyText, { configMap, manifestPlaceholders });
    const checksum = sha256(rendered);

    const ruleBaseId = artifact.kind === 'template' ? `templates--${artifact.id}` : artifact.id;
    writeChunked(rulesDir, ruleBaseId, rendered, written);

    for (const file of artifact.files ?? []) {
      if (file.encoding !== 'utf8') {
        warn.write(
          `Warning: skipping binary supporting file ${artifact.id}/${file.relPath} ` +
            `(Windsurf rules are markdown-only).\n`
        );
        continue;
      }
      const fileRendered = renderTemplate(file.contents, { configMap, manifestPlaceholders });
      const fileRuleId = `${ruleBaseId}--${file.relPath.replace(/\//g, '--').replace(/\.md$/, '')}`;
      writeChunked(rulesDir, fileRuleId, fileRendered, written);
    }

    lockEntries.push({ kind: artifact.kind, id: artifact.id, version: artifact.version, checksum });
  }

  for (const rule of rules) {
    const rendered = renderTemplate(rule.body, { configMap });
    const checksum = sha256(rendered);
    const ruleId = rule.id.replace(/\//g, '--');

    writeChunked(rulesDir, ruleId, rendered, written);
    lockEntries.push({ kind: 'rule', id: rule.id, version: '0.0.0', checksum });
  }

  reconcileStaleFiles(consumerCwd, rulesDir, written, warn);

  return lockEntries;
}

/**
 * Removes plugin-generated files that this run did not (re)write:
 * removed/filtered-out artifacts and leftover `-part-N.md` chunks after
 * content shrank below CHAR_LIMIT. Only filenames derivable from the PRIOR
 * lockfile are candidates — user-authored files in .windsurf/rules/ that the
 * plugin never installed are left untouched.
 */
function reconcileStaleFiles(consumerCwd, rulesDir, written, warn) {
  const lock = readLockfile(join(consumerCwd, LOCKFILE_NAME));
  if (!lock || !Array.isArray(lock.artifacts) || lock.target !== 'windsurf') return;

  const baseIds = lock.artifacts.map((e) =>
    e.kind === 'template' ? `templates--${e.id}` : e.id.replace(/\//g, '--')
  );

  const isPluginFile = (name) => {
    if (!name.endsWith('.md')) return false;
    return baseIds.some(
      (base) =>
        name === `${base}.md` ||
        name.startsWith(`${base}-part-`) ||
        name.startsWith(`${base}--`)
    );
  };

  if (!existsSync(rulesDir)) return;
  for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
    if (!entry.isFile() || written.has(entry.name) || !isPluginFile(entry.name)) continue;
    const stalePath = join(rulesDir, entry.name);
    rmSync(stalePath, { force: true });
    warn.write(`Removed stale rule file: ${relative(consumerCwd, stalePath)}\n`);
  }
}

/**
 * Writes content as one or more files under rulesDir.
 * If content.length <= CHAR_LIMIT → single file: <id>.md
 * Otherwise → <id>-part-1.md, <id>-part-2.md, ...
 * Filenames are recorded into `written` (when provided) so the caller can
 * reconcile stale files afterwards. Returns the number of files written.
 */
export function writeChunked(rulesDir, id, content, written) {
  const record = (name) => { if (written) written.add(name); };

  if (content.length <= CHAR_LIMIT) {
    writeFileSync(join(rulesDir, `${id}.md`), content, 'utf8');
    record(`${id}.md`);
    return 1;
  }

  const chunks = splitIntoChunks(content, CHAR_LIMIT);
  for (let i = 0; i < chunks.length; i++) {
    const name = `${id}-part-${i + 1}.md`;
    writeFileSync(join(rulesDir, name), chunks[i], 'utf8');
    record(name);
  }
  return chunks.length;
}

/**
 * Splits text into chunks of at most maxChars characters.
 * Prefers breaking at the last newline within the window (at or after the
 * halfway mark) to keep chunks reasonably sized. Falls back to a hard cut
 * if no such newline exists.
 */
export function splitIntoChunks(text, maxChars) {
  const chunks = [];
  let pos = 0;
  while (pos < text.length) {
    if (pos + maxChars >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }
    const window = text.slice(pos, pos + maxChars);
    const nlIdx = window.lastIndexOf('\n');
    // Only use the newline break if it is past the halfway point so that chunks
    // don't become tiny (e.g. first line is very short).
    const minCut = Math.floor(maxChars / 2);
    const cutAt = nlIdx >= minCut ? nlIdx + 1 : maxChars;
    chunks.push(text.slice(pos, pos + cutAt));
    pos += cutAt;
  }
  return chunks;
}

