import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
 * @param {object}   opts.config        — validated consumer config object
 * @param {Array}    opts.artifacts     — all loaded artifacts from loadArtifacts()
 * @returns {Array<{kind, id, version, checksum}>}  — lockfile entries for installed artifacts
 */
export async function installClaude({ consumerCwd, config, artifacts }) {
  const filtered = filterByStack(artifacts, config.stack ?? {});
  const configMap = buildPlaceholderMap(config);

  const claudeDir = join(consumerCwd, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(join(claudeDir, 'skills'), { recursive: true });
  mkdirSync(join(claudeDir, 'agents'), { recursive: true });
  mkdirSync(join(claudeDir, 'hooks'), { recursive: true });

  const lockEntries = [];
  const hookEntries = {};

  for (const artifact of filtered) {
    const rendered = renderTemplate(artifact.bodyText, { configMap });
    const checksum = sha256(rendered);

    if (artifact.kind === 'skill') {
      const outPath = join(claudeDir, 'skills', `${artifact.id}.md`);
      writeFileSync(outPath, rendered, 'utf8');
    } else if (artifact.kind === 'agent') {
      const outPath = join(claudeDir, 'agents', `${artifact.id}.md`);
      writeFileSync(outPath, rendered, 'utf8');
    } else if (artifact.kind === 'hook') {
      // hooks go into .claude/hooks/ and also get registered in settings.json
      const outPath = join(claudeDir, 'hooks', `${artifact.id}`);
      writeFileSync(outPath, rendered, 'utf8');

      const triggers = artifact.manifest.triggers ?? {};
      for (const event of Object.keys(triggers)) {
        if (!hookEntries[event]) hookEntries[event] = [];
        hookEntries[event].push({ matcher: '.*', hooks: [{ type: 'command', command: outPath }] });
      }
    }

    lockEntries.push({ kind: artifact.kind, id: artifact.id, version: artifact.version, checksum });
  }

  patchSettings(claudeDir, hookEntries);

  return lockEntries;
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
