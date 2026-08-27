import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml, CORE_SCHEMA } from 'js-yaml';

/**
 * Upstream provenance for artifacts adapted from third-party repositories.
 *
 * Two registries record the same facts: the `source:` block in each derived
 * `manifest.yaml` (machine-readable, drift-checkable) and the table in
 * NOTICE.md (what a human reading the repo actually finds). Neither is
 * generated from the other, so they are compared instead — see `diffPins`.
 */

const ARTIFACT_DIRS = ['skills', 'agents', 'templates'];

/** Table rows shaped `| `<artifact>` | `<upstream path>` | `<40-hex sha>` |`. */
const NOTICE_ROW = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{40})`\s*\|\s*$/;

/**
 * Reads every manifest that declares `source:` and flattens it to pins.
 *
 * One artifact may be adapted from more than one upstream repo, so `source:`
 * is either a single entry or an array of them; both normalise to the
 * `sources` array here. Each entry keeps its own `repo`, which is what lets
 * scripts/check-upstream-drift.js query the right repository per pin.
 *
 * @param {string} repoRoot
 * @returns {Map<string, {sources: Array<{repo: string, ref?: string, pins: Set<string>}>}>}
 *   keyed by artifact path (e.g. `skills/koin-kmp`); each pin is `path\0sha`.
 */
export function collectSourcePins(repoRoot) {
  const out = new Map();

  for (const artifactDir of ARTIFACT_DIRS) {
    const baseDir = join(repoRoot, artifactDir);
    if (!existsSync(baseDir)) continue;

    for (const name of readdirSync(baseDir)) {
      const dir = join(baseDir, name);
      if (!statSync(dir).isDirectory()) continue;

      const manifestPath = join(dir, 'manifest.yaml');
      if (!existsSync(manifestPath)) continue;

      const manifest = parseYaml(readFileSync(manifestPath, 'utf8'), { schema: CORE_SCHEMA });
      const source = manifest?.source;
      if (!source) continue;

      out.set(`${artifactDir}/${name}`, {
        sources: (Array.isArray(source) ? source : [source]).map((entry) => ({
          repo: entry.repo,
          ref: entry.ref,
          pins: new Set((entry.files ?? []).map((f) => pin(f.path, f.sha))),
        })),
      });
    }
  }

  return out;
}

/**
 * Parses the attribution tables in NOTICE.md.
 *
 * @param {string} repoRoot
 * @returns {Map<string, Set<string>>} artifact path → set of `path\0sha` pins
 */
export function readNoticePins(repoRoot) {
  const out = new Map();
  const noticePath = join(repoRoot, 'NOTICE.md');
  if (!existsSync(noticePath)) return out;

  for (const line of readFileSync(noticePath, 'utf8').split(/\r?\n/)) {
    const match = NOTICE_ROW.exec(line);
    if (!match) continue;
    const [, artifact, path, sha] = match;
    if (!out.has(artifact)) out.set(artifact, new Set());
    out.get(artifact).add(pin(path, sha));
  }

  return out;
}

/**
 * Compares the two registries and returns one human-readable line per problem.
 * An empty array means they agree exactly.
 *
 * NOTICE.md keys its rows by artifact, not by upstream repo — an artifact
 * adapted from two repos has one section per repo but a single set of rows
 * here. The manifest side is unioned across sources before comparing.
 *
 * @param {Map<string, {sources: Array<{pins: Set<string>}>}>} sourcePins  from `collectSourcePins`
 * @param {Map<string, Set<string>>} noticePins  from `readNoticePins`
 * @returns {string[]}
 */
export function diffPins(sourcePins, noticePins) {
  const problems = [];

  for (const [artifact, { sources }] of sourcePins) {
    const pins = new Set(sources.flatMap((source) => [...source.pins]));
    const listed = noticePins.get(artifact);
    if (!listed) {
      problems.push(`${artifact}: declares source: but has no row in NOTICE.md`);
      continue;
    }
    for (const p of pins) {
      if (!listed.has(p)) problems.push(`${artifact}: NOTICE.md is missing ${describe(p)}`);
    }
    for (const p of listed) {
      if (!pins.has(p)) problems.push(`${artifact}: NOTICE.md lists ${describe(p)}, absent from source:`);
    }
  }

  for (const artifact of noticePins.keys()) {
    if (!sourcePins.has(artifact)) {
      problems.push(`${artifact}: listed in NOTICE.md but its manifest declares no source:`);
    }
  }

  return problems;
}

const pin = (path, sha) => `${path}\0${sha}`;
const describe = (p) => {
  const [path, sha] = p.split('\0');
  return `${path} @ ${sha}`;
};
