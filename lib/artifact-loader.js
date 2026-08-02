import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load as parseYaml, CORE_SCHEMA } from 'js-yaml';
import { validateManifest } from './manifest-validator.js';
import { ConfigError } from './errors.js';

/**
 * Directory → artifact kind. An artifact is a directory holding a manifest.yaml
 * plus one canonical body file.
 *
 * `hooks/` and `rules/` are deliberately absent — neither holds artifacts:
 *   - hooks/ is flat .js (executable hooks plus the modules they compose) and
 *     hooks.json, copied verbatim by installHooks() in adapters/claude/index.js.
 *     It never had a manifest, so the `hook` kind this map used to declare was
 *     unreachable: loadArtifacts only descends into subdirectories and hooks/
 *     has none — which is also why the hook's modules stay flat.
 *   - rules/ is flat .md data (no per-artifact manifest), collected by
 *     lib/rules-loader.js and inlined or copied by each adapter.
 * Do not "restore" either one here; both ship through their own path.
 */
const KIND_MAP = {
  skills: 'skill',
  agents: 'agent',
  templates: 'template',
};

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.html']);

/**
 * Loads all artifacts from the given package root directory.
 * Each artifact directory must contain manifest.yaml and SKILL.md / AGENT.md /
 * TEMPLATE.md. Hooks and rules are not artifacts — see KIND_MAP above.
 *
 * @param {string} pkgRoot  — absolute path to the spovishun-skills package root
 * @returns {Array<{kind: string, id: string, version: string, manifest: object, bodyText: string, artifactDir: string, files: Array<{relPath: string, contents: string, encoding: 'utf8'|'base64'}>}>}
 */
export function loadArtifacts(pkgRoot) {
  const results = [];

  for (const [dirName, kind] of Object.entries(KIND_MAP)) {
    const baseDir = join(pkgRoot, dirName);
    if (!existsSync(baseDir)) continue;

    let entries;
    try {
      entries = readdirSync(baseDir, { withFileTypes: true });
    } catch (err) {
      throw new ConfigError(
        'MISSING_REQUIRED',
        `Cannot read ${dirName} directory at ${baseDir}: ${err.message}`,
        `Ensure the ${dirName}/ directory exists and is readable.`
      );
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const artifactDir = join(baseDir, entry.name);
      const artifact = loadArtifact(artifactDir, kind, entry.name);
      results.push(artifact);
    }
  }

  return results;
}

function loadArtifact(artifactDir, kind, dirName) {
  const manifestPath = join(artifactDir, 'manifest.yaml');

  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      `Cannot read manifest at ${manifestPath}: ${err.message}`,
      `Every ${kind} directory must contain a manifest.yaml file.`
    );
  }

  let manifest;
  try {
    manifest = parseYaml(raw, { schema: CORE_SCHEMA });
  } catch (err) {
    throw new ConfigError(
      'INVALID_YAML',
      `Cannot parse manifest at ${manifestPath}: ${err.message}`,
      `Fix the YAML syntax error in ${manifestPath}.`
    );
  }

  const result = validateManifest(manifest);
  if (!result.ok) {
    const summary = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n');
    throw new ConfigError(
      'SCHEMA_VIOLATION',
      `Invalid manifest at ${manifestPath}:\n${summary}`,
      `Fix the manifest fields listed above.`
    );
  }

  if (manifest.id !== dirName) {
    throw new ConfigError(
      'SCHEMA_VIOLATION',
      `Manifest id "${manifest.id}" does not match directory name "${dirName}" in ${manifestPath}.`,
      `Rename the directory to match the manifest id, or update the id field.`
    );
  }

  const bodyFilename = BODY_FILES[kind];
  const bodyText = readBodyText(artifactDir, kind, bodyFilename);
  const files = collectSupportingFiles(artifactDir, bodyFilename);

  return { kind, id: manifest.id, version: manifest.version, manifest, bodyText, artifactDir, files };
}

const BODY_FILES = {
  skill: 'SKILL.md',
  agent: 'AGENT.md',
  template: 'TEMPLATE.md',
};

/**
 * Walks artifactDir recursively and returns supporting files (everything except
 * manifest.yaml, the canonical body file, and hidden entries). Text files
 * (extensions in TEXT_EXTENSIONS) are read as utf8; everything else is read as
 * base64 so adapters can copy binary assets verbatim.
 */
function collectSupportingFiles(artifactDir, bodyFilename) {
  const out = [];
  walkSupporting(artifactDir, artifactDir, bodyFilename, out);
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

function walkSupporting(baseDir, currentDir, bodyFilename, out) {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkSupporting(baseDir, fullPath, bodyFilename, out);
      continue;
    }
    // Top-level manifest.yaml and the canonical body file are not "supporting".
    if (currentDir === baseDir && (entry.name === 'manifest.yaml' || entry.name === bodyFilename)) {
      continue;
    }
    const relPath = relative(baseDir, fullPath).split(sep).join('/');
    const dotIdx = entry.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? entry.name.slice(dotIdx).toLowerCase() : '';
    if (TEXT_EXTENSIONS.has(ext)) {
      out.push({ relPath, contents: readFileSync(fullPath, 'utf8'), encoding: 'utf8' });
    } else {
      out.push({ relPath, contents: readFileSync(fullPath).toString('base64'), encoding: 'base64' });
    }
  }
}

function readBodyText(artifactDir, kind, filename) {
  const bodyPath = join(artifactDir, filename);
  try {
    return readFileSync(bodyPath, 'utf8');
  } catch (err) {
    throw new ConfigError(
      'MISSING_REQUIRED',
      `Cannot read body file at ${bodyPath}: ${err.message}`,
      `Every ${kind} directory must contain a ${filename} file.`
    );
  }
}
