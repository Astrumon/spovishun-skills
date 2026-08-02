import { mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { filterByStack } from '../../lib/stack-filter.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { collectRules, renderRule, ruleLockEntry } from '../../lib/rules-loader.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import { renderArtifact, manifestPlaceholderKeys } from '../../lib/render-artifact.js';
import { readLockfile, LOCKFILE_NAME } from '../../lib/lockfile.js';
import { writeWindsurfManifest } from '../../lib/windsurf-manifest.js';

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
 * Every filename written is attributed in `.windsurf/rules/.spovishun-manifest.json`
 * so the reader never has to guess kind and id back out of a flattened name —
 * see lib/windsurf-manifest.js for why that guessing was unfixable.
 *
 * Takes the uniform installer argument object (see adapters/registry.js) and
 * destructures the fields it uses. `pluginVersion` and `force` are not among
 * them: nothing in .windsurf/rules/ carries a version header, and the ownership
 * model this target would need for --force is still open (spovishun-162).
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
  const manifest = {};
  const attribute = attributor(manifest, warn);

  for (const artifact of included) {
    // No marker: windsurf bodies carry no x-spovishun frontmatter, so ownership
    // is decided by checksum alone. stripMarker is a no-op on an unmarked body,
    // which keeps this checksum equal to the claude one for the same content.
    const { rendered, checksum } = renderArtifact(artifact, configMap);

    const ruleBaseId = artifact.kind === 'template' ? `templates--${artifact.id}` : artifact.id;
    attribute(writeChunked(rulesDir, ruleBaseId, rendered), {
      kind: artifact.kind,
      id: artifact.id,
      role: 'body',
    });

    for (const file of artifact.files ?? []) {
      if (file.encoding !== 'utf8') {
        warn.write(
          `Warning: skipping binary supporting file ${artifact.id}/${file.relPath} ` +
            `(Windsurf rules are markdown-only).\n`
        );
        continue;
      }
      const fileRendered = renderTemplate(file.contents, {
        configMap,
        manifestPlaceholders: manifestPlaceholderKeys(artifact.manifest),
      });
      const fileRuleId = `${ruleBaseId}--${file.relPath.replace(/\//g, '--').replace(/\.md$/, '')}`;
      attribute(writeChunked(rulesDir, fileRuleId, fileRendered), {
        kind: artifact.kind,
        id: artifact.id,
        role: 'support',
        path: file.relPath,
      });
    }

    lockEntries.push({ kind: artifact.kind, id: artifact.id, version: artifact.version, checksum });
  }

  for (const rule of rules) {
    const ruleId = rule.id.replace(/\//g, '--');
    const rendered = renderRule(rule, configMap);
    attribute(writeChunked(rulesDir, ruleId, rendered), { kind: 'rule', id: rule.id, role: 'body' });
    lockEntries.push(ruleLockEntry(rule, rendered));
  }

  writeWindsurfManifest(rulesDir, manifest);
  reconcileStaleFiles(consumerCwd, rulesDir, new Set(Object.keys(manifest)), warn);

  return lockEntries;
}

/**
 * Records which artifact produced which filename, building the manifest as a
 * side effect of writing. `part` is stamped only on genuinely chunked output so
 * a single-file artifact stays trivially readable.
 *
 * Flattening `/` to `--` is not injective: the rule `common/git-workflow` and a
 * skill `common` carrying `references/git-workflow.md` both land on
 * `common--git-workflow.md`. Whichever writes second wins on disk — silently,
 * before this warning existed. Last write also wins in the manifest, so the
 * manifest keeps describing what is actually there.
 *
 * @param {object} manifest — accumulator, filename → {kind, id, role, part?, path?}
 * @param {object} warn — writable stream
 * @returns {(names: string[], owner: object) => void}
 */
function attributor(manifest, warn) {
  return (names, owner) => {
    const chunked = names.length > 1;
    names.forEach((name, index) => {
      const prev = manifest[name];
      if (prev) {
        warn.write(
          `Warning: ${owner.kind}:${owner.id} and ${prev.kind}:${prev.id} both write ${name} — ` +
            `the '--' filename encoding cannot tell them apart and the first is lost. ` +
            `Rename one of the two.\n`
        );
      }
      manifest[name] = { ...owner, ...(chunked && { part: index + 1 }) };
    });
  };
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
 *
 * @returns {string[]} the filenames written, in part order — the caller needs
 *   them to attribute each one in the manifest and to reconcile stale files.
 */
export function writeChunked(rulesDir, id, content) {
  if (content.length <= CHAR_LIMIT) {
    writeFileSync(join(rulesDir, `${id}.md`), content, 'utf8');
    return [`${id}.md`];
  }

  return splitIntoChunks(content, CHAR_LIMIT).map((chunk, i) => {
    const name = `${id}-part-${i + 1}.md`;
    writeFileSync(join(rulesDir, name), chunk, 'utf8');
    return name;
  });
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

