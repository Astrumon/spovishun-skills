'use strict';

function toDashed(id) {
  if (!id || typeof id !== 'string') return id;
  const compact = id.replace(/-/g, '');
  if (compact.length !== 32) return id;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function toCompact(id) {
  if (!id || typeof id !== 'string') return id;
  return id.replace(/-/g, '');
}

module.exports = { toDashed, toCompact };
