'use strict';

// Notion page ids travel in two shapes: compact (32 hex chars, what the picker
// prints and .dev-context stores) and dashed (what /v1/pages/{id} wants).
//
// Canonical home for both conversions; scripts/notion/lib/page-id.js re-exports
// this file. The relative hop resolves in the repo (scripts/notion/lib → hooks/)
// and in an installed tree (.claude/scripts/notion/lib → .claude/hooks) alike.

function toDashed(id) {
  if (!id || typeof id !== 'string') return id;
  const compact = id.replace(/-/g, '');
  // Anything that is not a 32-char id is passed through untouched: slicing it
  // into 8-4-4-4-12 would fabricate a plausible-looking id and turn a clear
  // "not found" from Notion into a confusing one.
  if (compact.length !== 32) return id;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function toCompact(id) {
  if (!id || typeof id !== 'string') return id;
  return id.replace(/-/g, '');
}

module.exports = { toDashed, toCompact };
