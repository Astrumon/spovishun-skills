import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { threeWayMerge } from '../../lib/three-way-merge.js';
import { writeChunked, RULES_DIR } from './index.js';

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

  if (!conflict) {
    writeChunked(rulesDir, artifact.id, rendered);
    return;
  }

  const ours = installedEntry ? installedEntry.content : rendered;
  const { content } = threeWayMerge({ ours, theirs: rendered, oursLabel, theirsLabel });
  writeChunked(rulesDir, artifact.id, content);
}
