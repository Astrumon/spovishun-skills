import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { threeWayMerge } from '../../lib/three-way-merge.js';

/**
 * Writes or merges a single artifact for the claude target.
 *
 * - AUTO_APPLY / NEW  (conflict=false): overwrites <kind>s/<id>.md with upstream content
 * - CONFLICT          (conflict=true):  writes conflict markers into the file
 *
 * @param {object} opts
 * @param {string}  opts.consumerCwd    — consumer project root
 * @param {object}  opts.upstreamEntry  — { artifact: {kind, id}, rendered: string }
 * @param {object}  [opts.installedEntry] — { content: string, paths: string[] } or null
 * @param {boolean} opts.conflict
 * @param {string}  [opts.oursLabel]
 * @param {string}  [opts.theirsLabel]
 */
export async function updateClaude({
  consumerCwd,
  upstreamEntry,
  installedEntry = null,
  conflict,
  oursLabel = 'ours',
  theirsLabel = 'theirs',
}) {
  const { artifact, rendered } = upstreamEntry;
  const subdir = artifact.kind === 'skill' ? 'skills' : 'agents';
  const outDir = join(consumerCwd, '.claude', subdir);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${artifact.id}.md`);

  if (!conflict) {
    writeFileSync(outPath, rendered, 'utf8');
    return;
  }

  const ours = installedEntry ? installedEntry.content : rendered;
  const { content } = threeWayMerge({ ours, theirs: rendered, oursLabel, theirsLabel });
  writeFileSync(outPath, content, 'utf8');
}
