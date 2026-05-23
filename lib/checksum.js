import { createHash } from 'node:crypto';

/**
 * Returns "sha256:<hex>" for the given UTF-8 string.
 * @param {string} text
 * @returns {string}
 */
export function sha256(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}
