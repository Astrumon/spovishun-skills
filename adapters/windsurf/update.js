import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { threeWayMerge } from '../../lib/three-way-merge.js';
import { readWindsurfManifest, writeWindsurfManifest } from '../../lib/windsurf-manifest.js';
import { writeChunked, RULES_DIR, windsurfBaseId } from './index.js';

/**
 * Writes or merges a single artifact for the windsurf target.
 *
 * - AUTO_APPLY / NEW  (conflict=false): deletes old chunk files, re-writes via writeChunked
 * - CONFLICT          (conflict=true):  writes conflict markers, re-chunks the merged content
 *
 * @param {object} opts
 * @param {string}  opts.consumerCwd     — consumer project root
 * @param {object}  opts.upstreamEntry   — { artifact: {kind, id}, rendered: string }
 * @param {object}  [opts.installedEntry] — { content: string, paths: string[] } or null
 * @param {boolean} opts.conflict
 * @param {string}  [opts.oursLabel]
 * @param {string}  [opts.theirsLabel]
 */
export async function updateWindsurf({
  consumerCwd,
  upstreamEntry,
  installedEntry = null,
  conflict,
  oursLabel = 'ours',
  theirsLabel = 'theirs',
}) {
  const { artifact, rendered } = upstreamEntry;
  const rulesDir = join(consumerCwd, RULES_DIR);

  // Remove stale chunk files before re-writing
  if (installedEntry) {
    for (const p of installedEntry.paths) {
      if (existsSync(p)) unlinkSync(p);
    }
  }

  let content = rendered;
  if (conflict) {
    const ours = installedEntry ? installedEntry.content : rendered;
    ({ content } = threeWayMerge({ ours, theirs: rendered, oursLabel, theirsLabel }));
  }

  const names = writeChunked(rulesDir, windsurfBaseId(artifact), content);
  reattribute(rulesDir, artifact, names);
}

/**
 * Points the manifest at the filenames this update just wrote.
 *
 * Without this the manifest would still name the PREVIOUS chunking, so the next
 * `install` would find no files for the id, call it MISSING_ON_DISK and rewrite
 * it — silently discarding a conflict resolution the consumer was in the middle
 * of. Supporting-file entries are left alone: `update` never rewrites them.
 *
 * A tree with no manifest keeps having none; writing a partial one would claim
 * ids this function knows nothing about.
 */
function reattribute(rulesDir, artifact, names) {
  const manifest = readWindsurfManifest(rulesDir);
  if (!manifest) return;

  const key = `${artifact.kind}:${artifact.id}`;
  for (const [name, entry] of Object.entries(manifest)) {
    if (entry.role === 'body' && `${entry.kind}:${entry.id}` === key) delete manifest[name];
  }

  const chunked = names.length > 1;
  names.forEach((name, index) => {
    manifest[name] = {
      kind: artifact.kind,
      id: artifact.id,
      role: 'body',
      ...(chunked && { part: index + 1 }),
    };
  });

  writeWindsurfManifest(rulesDir, manifest);
}
