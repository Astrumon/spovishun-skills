import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { threeWayMerge } from '../../lib/three-way-merge.js';
import { markBody } from '../../lib/skill-frontmatter.js';

const KIND_LAYOUT = {
  skill: { subdir: 'skills', bodyFilename: 'SKILL.md' },
  agent: { subdir: 'agents', bodyFilename: 'AGENT.md' },
  template: { subdir: '_templates', bodyFilename: 'TEMPLATE.md' },
};

/**
 * Writes or merges a single artifact for the claude target.
 *
 * - AUTO_APPLY / NEW  (conflict=false): overwrites {subdir}/{id}/{BODY}.md with upstream content
 * - CONFLICT          (conflict=true):  writes conflict markers into the body file
 *
 * Supporting files are NOT carried by update — they are recreated by the next
 * `install` (3-way merge only operates on the canonical body).
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
  const layout = KIND_LAYOUT[artifact.kind] ?? KIND_LAYOUT.skill;
  const outDir = join(consumerCwd, '.claude', layout.subdir, artifact.id);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, layout.bodyFilename);

  // Defensive: callers in bin/update.js already produce a marked body via
  // markBody, which is idempotent — re-running here means a direct adapter
  // call with a raw rendered body still yields a Claude-loadable, marked file.
  const upstream = markBody({ body: rendered, kind: artifact.kind, manifest: artifact.manifest });

  if (!conflict) {
    writeFileSync(outPath, upstream, 'utf8');
    return;
  }

  const ours = installedEntry ? installedEntry.content : upstream;
  const { content } = threeWayMerge({ ours, theirs: upstream, oursLabel, theirsLabel });
  writeFileSync(outPath, content, 'utf8');
}
