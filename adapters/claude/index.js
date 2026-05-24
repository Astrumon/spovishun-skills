import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { filterByStack } from '../../lib/stack-filter.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import { buildPlaceholderMap } from '../../lib/placeholder-map.js';
import { sha256 } from '../../lib/checksum.js';
import { mergeSettings } from '../../lib/settings-merger.js';

/**
 * Installs filtered artifacts into the consumer's .claude/ directory.
 *
 * @param {object} opts
 * @param {string}   opts.consumerCwd   — absolute path to consumer project root
 * @param {string}   opts.pkgRoot       — absolute path to this package's root (for hooks/ and rules/)
 * @param {object}   opts.config        — validated consumer config object
 * @param {Array}    opts.artifacts     — all loaded artifacts from loadArtifacts()
 * @returns {Array<{kind, id, version, checksum}>}  — lockfile entries for installed artifacts
 */
export async function installClaude({ consumerCwd, pkgRoot, config, artifacts }) {
  const filtered = filterByStack(artifacts, config.stack ?? {});
  const configMap = buildPlaceholderMap(config);

  const claudeDir = join(consumerCwd, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(join(claudeDir, 'skills'), { recursive: true });
  mkdirSync(join(claudeDir, 'agents'), { recursive: true });
  mkdirSync(join(claudeDir, 'hooks'), { recursive: true });
  mkdirSync(join(claudeDir, 'rules'), { recursive: true });

  const lockEntries = [];

  for (const artifact of filtered) {
    const rendered = renderTemplate(artifact.bodyText, { configMap });
    const checksum = sha256(rendered);

    if (artifact.kind === 'skill') {
      const outPath = join(claudeDir, 'skills', `${artifact.id}.md`);
      writeFileSync(outPath, rendered, 'utf8');
    } else if (artifact.kind === 'agent') {
      const outPath = join(claudeDir, 'agents', `${artifact.id}.md`);
      writeFileSync(outPath, rendered, 'utf8');
    }

    lockEntries.push({ kind: artifact.kind, id: artifact.id, version: artifact.version, checksum });
  }

  // Always ensure settings.json exists, even with no plugin hooks
  patchSettings(claudeDir, {});
  installHooks(pkgRoot, claudeDir);
  installRules(pkgRoot, claudeDir);

  return lockEntries;
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
 * Copies all .md rule files from rules/ into .claude/rules/, preserving subdirectory structure.
 */
function installRules(pkgRoot, claudeDir) {
  const rulesDir = join(pkgRoot, 'rules');
  if (!existsSync(rulesDir)) return;

  copyRulesRecursive(rulesDir, rulesDir, claudeDir);
}

function copyRulesRecursive(baseDir, currentDir, claudeDir) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const srcPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      copyRulesRecursive(baseDir, srcPath, claudeDir);
    } else if (entry.name.endsWith('.md')) {
      const rel = relative(baseDir, srcPath);
      const destPath = join(claudeDir, 'rules', rel);
      mkdirSync(join(destPath, '..'), { recursive: true });
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
