/**
 * Whole-file three-way merge with git-style conflict markers.
 *
 * V1 limitation: when `base` is not provided the merge degrades to a 2-way
 * comparison (ours vs theirs). The classifier already handles the cases where
 * only one side changed, so degradation only affects the CONFLICT action where
 * both sides differ — a 2-way conflict is still correct and actionable.
 *
 * @param {object} opts
 * @param {string}  opts.ours       — current on-disk content
 * @param {string}  opts.theirs     — upstream content
 * @param {string}  [opts.base]     — common ancestor (lockfile-installed content; optional)
 * @param {string}  [opts.oursLabel]   — label shown in conflict marker (e.g. file path)
 * @param {string}  [opts.theirsLabel] — label shown in conflict marker (e.g. "spovishun-skills@1.2.3")
 * @returns {{ conflict: boolean, content: string }}
 */
export function threeWayMerge({ ours, theirs, base, oursLabel = 'ours', theirsLabel = 'theirs' }) {
  if (ours === theirs) return { conflict: false, content: ours };

  if (base !== undefined) {
    if (ours === base) return { conflict: false, content: theirs };
    if (theirs === base) return { conflict: false, content: ours };
  }

  const content =
    `<<<<<<< ${oursLabel}\n` +
    ours +
    `\n=======\n` +
    theirs +
    `\n>>>>>>> ${theirsLabel}\n`;

  return { conflict: true, content };
}
