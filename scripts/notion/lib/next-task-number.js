'use strict';

// The next task number, derived from task titles. Pure — the caller fetches the
// titles (get-board.js --next-number reads the newest tasks by created_time).
//
// Both title forms count: the canonical `feature/<prefix>-<N>: …` and the bare
// `<prefix>-<N>: …` that hand-made tasks drift into. The number
// is the MAX over every match, not the first match in creation order — one
// task created out of sequence must not send numbering backwards.

const { projectPrefix } = require('./project-prefix');

function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string[]} titles
 * @param {string} [prefix] defaults to the consumer's projectPrefix()
 * @returns {number|null} max N + 1; 1 for an empty board; null when there are
 *   titles but none carries a task number — the caller must stop, not guess.
 */
function nextTaskNumber(titles, prefix = projectPrefix()) {
  if (!titles || titles.length === 0) return 1;
  const re = new RegExp(`^(?:feature\\/)?${escapeForRegex(prefix)}-(\\d+)\\b`, 'i');
  let max = null;
  for (const title of titles) {
    const m = (title || '').trim().match(re);
    if (m) max = Math.max(max ?? 0, parseInt(m[1], 10));
  }
  return max === null ? null : max + 1;
}

module.exports = { nextTaskNumber };
