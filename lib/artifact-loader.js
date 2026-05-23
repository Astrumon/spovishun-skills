import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml, CORE_SCHEMA } from 'js-yaml';
import { validateManifest } from './manifest-validator.js';
import { ConfigError } from './errors.js';

const KIND_MAP = {
  skills: 'skill',
  agents: 'agent',
  hooks: 'hook',
};

/**
 * Loads all artifacts from the given package root directory.
 * Each artifact directory must contain manifest.yaml and SKILL.md / AGENT.md / (hook executable).
 *
 * @param {string} pkgRoot  — absolute path to the spovishun-skills package root
 * @returns {Array<{kind: string, id: string, version: string, manifest: object, bodyText: string}>}
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

  const bodyText = readBodyText(artifactDir, kind);

  return { kind, id: manifest.id, version: manifest.version, manifest, bodyText };
}

const BODY_FILES = {
  skill: 'SKILL.md',
  agent: 'AGENT.md',
  hook: null,
};

function readBodyText(artifactDir, kind) {
  const filename = BODY_FILES[kind];
  if (filename === null) {
    // hooks: read whichever executable file exists (non-yaml, non-hidden)
    const files = readdirSync(artifactDir).filter(
      (f) => f !== 'manifest.yaml' && !f.startsWith('.')
    );
    if (files.length === 0) {
      throw new ConfigError(
        'MISSING_REQUIRED',
        `Hook directory ${artifactDir} has no body file besides manifest.yaml.`,
        `Add the hook executable or script file to the directory.`
      );
    }
    return readFileSync(join(artifactDir, files[0]), 'utf8');
  }

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
