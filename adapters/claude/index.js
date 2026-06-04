import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { Buffer } from 'node:buffer';
import { filterByStack } from '../../lib/stack-filter.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { sha256 } from '../../lib/checksum.js';
import { mergeSettings } from '../../lib/settings-merger.js';
import { readLockfile, LOCKFILE_NAME } from '../../lib/lockfile.js';
import { ensureSkillFrontmatter } from '../../lib/skill-frontmatter.js';

const KIND_LAYOUT = {
  skill: { subdir: 'skills', bodyFilename: 'SKILL.md' },
  agent: { subdir: 'agents', bodyFilename: 'AGENT.md' },
  template: { subdir: '_templates', bodyFilename: 'TEMPLATE.md' },
};

/**
 * Installs filtered artifacts into the consumer's .claude/ directory.
 *
 * @param {object} opts
 * @param {string}   opts.consumerCwd   — absolute path to consumer project root
 * @param {string}   opts.pkgRoot       — absolute path to this package's root (for hooks/ and rules/)
 * @param {object}   opts.config        — validated consumer config object
 * @param {Array}    opts.artifacts     — all loaded artifacts from loadArtifacts()
 * @param {object}   [opts.warn]        — writable stream for warnings (default: process.stderr)
 * @returns {Array<{kind, id, version, checksum}>}  — lockfile entries for installed artifacts
 */
export async function installClaude({ consumerCwd, pkgRoot, config, artifacts, warn = process.stderr }) {
  const filtered = filterByStack(artifacts, config.stack ?? {});
  const configMap = buildPlaceholderMap(config);

  const claudeDir = join(consumerCwd, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(join(claudeDir, 'skills'), { recursive: true });
  mkdirSync(join(claudeDir, 'agents'), { recursive: true });
  mkdirSync(join(claudeDir, '_templates'), { recursive: true });
  mkdirSync(join(claudeDir, 'hooks'), { recursive: true });
  mkdirSync(join(claudeDir, 'rules'), { recursive: true });

  reconcileLegacyArtifacts(consumerCwd, claudeDir, filtered, warn);

  const lockEntries = [];

  for (const artifact of filtered) {
    const layout = KIND_LAYOUT[artifact.kind];
    if (!layout) continue;

    const manifestPlaceholders = (artifact.manifest?.placeholders ?? []).map((p) => p.key);
    const renderedBody = renderTemplate(artifact.bodyText, { configMap, manifestPlaceholders });
    const bodyToWrite = artifact.kind === 'skill'
      ? ensureSkillFrontmatter(renderedBody, artifact.manifest)
      : renderedBody;
    const checksum = sha256(bodyToWrite);

    const artifactDir = join(claudeDir, layout.subdir, artifact.id);
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, layout.bodyFilename), bodyToWrite, 'utf8');

    for (const file of artifact.files ?? []) {
      const destPath = join(artifactDir, file.relPath);
      mkdirSync(dirname(destPath), { recursive: true });
      if (file.encoding === 'utf8') {
        const rendered = renderTemplate(file.contents, { configMap, manifestPlaceholders });
        writeFileSync(destPath, rendered, 'utf8');
      } else {
        writeFileSync(destPath, Buffer.from(file.contents, 'base64'));
      }
    }

    lockEntries.push({ kind: artifact.kind, id: artifact.id, version: artifact.version, checksum });
  }

  // Always ensure settings.json exists, even with no plugin hooks
  patchSettings(claudeDir, {});
  installHooks(pkgRoot, claudeDir);
  installRules(pkgRoot, claudeDir, configMap);
  installScripts(pkgRoot, claudeDir, config, warn);

  return lockEntries;
}

/**
 * Removes stale artifact files from prior plugin layouts:
 *
 *   1. Flat `.claude/{subdir}/{id}.md` files from pre-v1.2.0 installs (always
 *      stale: every artifact now uses the folder layout).
 *   2. `.claude/{subdir}/{id}/` folders for ids that were in the prior lockfile
 *      but are no longer in the filtered artifact set (e.g. removed skill,
 *      stack-flag toggled off).
 *
 * Reads the prior lockfile to drive (2); skips silently if absent.
 */
function reconcileLegacyArtifacts(consumerCwd, claudeDir, filteredArtifacts, warn) {
  const wantById = new Map();
  for (const artifact of filteredArtifacts) {
    wantById.set(`${artifact.kind}:${artifact.id}`, true);
  }

  for (const [kind, layout] of Object.entries(KIND_LAYOUT)) {
    const subdirPath = join(claudeDir, layout.subdir);
    // Drop flat {id}.md files (legacy layout).
    if (existsSync(subdirPath)) {
      for (const entry of readdirSync(subdirPath, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const flatPath = join(subdirPath, entry.name);
          rmSync(flatPath, { force: true });
          warn.write(`Removed legacy flat file: ${relative(consumerCwd, flatPath)}\n`);
        }
      }
    }
  }

  const lockPath = join(consumerCwd, LOCKFILE_NAME);
  const lock = readLockfile(lockPath);
  if (!lock || !Array.isArray(lock.artifacts)) return;

  for (const entry of lock.artifacts) {
    const layout = KIND_LAYOUT[entry.kind];
    if (!layout) continue;
    if (wantById.has(`${entry.kind}:${entry.id}`)) continue;
    const stalePath = join(claudeDir, layout.subdir, entry.id);
    if (existsSync(stalePath)) {
      rmSync(stalePath, { recursive: true, force: true });
      warn.write(`Removed stale artifact folder: ${relative(consumerCwd, stalePath)}\n`);
    }
  }
}

/**
 * Copies all hook scripts from hooks/ to .claude/hooks/ and merges hooks.json
 * event mappings into .claude/settings.json.
 */
function installHooks(pkgRoot, claudeDir) {
  const hooksDir = join(pkgRoot, 'hooks');
  if (!existsSync(hooksDir)) return;

  const hooksJsonPath = join(hooksDir, 'hooks.json');
  if (!existsSync(hooksJsonPath)) return;

  let hooksJson;
  try {
    hooksJson = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
  } catch {
    return;
  }

  // Copy all .js scripts verbatim
  const scripts = readdirSync(hooksDir).filter((f) => f.endsWith('.js'));
  for (const script of scripts) {
    copyFileSync(join(hooksDir, script), join(claudeDir, 'hooks', script));
  }

  // Merge event entries from hooks.json into settings.json
  const pluginHooks = hooksJson.hooks ?? {};
  patchSettings(claudeDir, pluginHooks);
}

/**
 * Renders all .md rule files from rules/ into .claude/rules/, preserving subdirectory
 * structure. Rule bodies support Mustache placeholders (resolved from the consumer config),
 * mirroring the codex and windsurf adapters — never copied verbatim.
 */
function installRules(pkgRoot, claudeDir, configMap) {
  const rulesDir = join(pkgRoot, 'rules');
  if (!existsSync(rulesDir)) return;

  copyRulesRecursive(rulesDir, rulesDir, claudeDir, configMap);
}

function copyRulesRecursive(baseDir, currentDir, claudeDir, configMap) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      copyRulesRecursive(baseDir, srcPath, claudeDir, configMap);
    } else if (entry.name.endsWith('.md')) {
      const rel = relative(baseDir, srcPath);
      const destPath = join(claudeDir, 'rules', rel);
      mkdirSync(join(destPath, '..'), { recursive: true });
      // Rules carry no manifest, so every UPPER_SNAKE_CASE token must resolve from config.
      const rendered = renderTemplate(readFileSync(srcPath, 'utf8'), { configMap, manifestPlaceholders: [] });
      writeFileSync(destPath, rendered, 'utf8');
    }
  }
}

/**
 * Copies CLI scripts that skill bodies invoke (e.g. `node .claude/scripts/notion/get-board.js`)
 * into the consumer's `.claude/scripts/` tree. The whole `scripts/` subtree is
 * mirrored recursively, preserving subdirectories. Each `notion/` script is
 * gated on `stack.notion` — if the consumer is not running Notion, no scripts
 * are copied at all.
 *
 * Codex / Windsurf adapters do not call this — those targets surface skills
 * as inline text where shell-script delivery makes no sense.
 */
function installScripts(pkgRoot, claudeDir, config, warn) {
  const scriptsRoot = join(pkgRoot, 'scripts');
  if (!existsSync(scriptsRoot)) return;

  const notionDir = join(scriptsRoot, 'notion');
  if (existsSync(notionDir)) {
    if (!config.stack?.notion) return;
    const dest = join(claudeDir, 'scripts', 'notion');
    mkdirSync(dest, { recursive: true });
    copyDirRecursive(notionDir, dest);
  }
}

function copyDirRecursive(srcDir, destDir) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      copyFileSync(srcPath, destPath);
    }
  }
}

function patchSettings(claudeDir, pluginHooks) {
  const settingsPath = join(claudeDir, 'settings.json');
  let existing = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
      existing = {};
    }
  }

  const merged = mergeSettings(existing, pluginHooks);
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}
