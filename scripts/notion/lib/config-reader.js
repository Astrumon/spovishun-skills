'use strict';

// Minimal scalar reader for spovishun-skills.config.yaml shared by all CLI
// scripts. Mirrors the reader in hooks/notion-task-inject.js so the scripts
// can stay zero-dependency (no js-yaml). Supports 1-level (`section`, `key`)
// and 2-level dotted (`section`, `'sub.key'`) lookups. Returns '' when the
// section/key is absent so callers can chain `env || readConfigValue(...) || ''`.

const fs = require('fs');
const path = require('path');

function readConfigValue(section, keyPath) {
  const configFile = path.join(process.cwd(), 'spovishun-skills.config.yaml');
  if (!fs.existsSync(configFile)) return '';
  let raw = fs.readFileSync(configFile, 'utf8');
  // Strip a UTF-8 BOM if present — js-yaml does this transparently; the manual
  // line-by-line scanner below would otherwise miss the first top-level key.
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const lines = raw.split('\n');
  const segments = keyPath.split('.');

  let inSection = false;
  let subIndent = -1;
  let inSubsection = false;

  for (const rawLine of lines) {
    if (/^[A-Za-z0-9_]+:/.test(rawLine)) {
      inSection = rawLine.startsWith(`${section}:`);
      subIndent = -1;
      inSubsection = false;
      continue;
    }
    if (!inSection) continue;

    const indentMatch = rawLine.match(/^(\s+)/);
    const indent = indentMatch ? indentMatch[1].length : 0;
    if (indent === 0) continue;

    if (segments.length === 1) {
      const m = rawLine.match(/^\s+([A-Za-z0-9_]+):\s*(.+?)\s*$/);
      if (m && m[1] === segments[0]) return m[2].replace(/^["']|["']$/g, '');
      continue;
    }

    if (!inSubsection) {
      const mHeader = rawLine.match(/^(\s+)([A-Za-z0-9_]+):\s*$/);
      if (mHeader && mHeader[2] === segments[0]) {
        subIndent = mHeader[1].length;
        inSubsection = true;
      }
      continue;
    }

    if (indent <= subIndent) {
      inSubsection = false;
      const mHeader = rawLine.match(/^(\s+)([A-Za-z0-9_]+):\s*$/);
      if (mHeader && mHeader[2] === segments[0]) {
        subIndent = mHeader[1].length;
        inSubsection = true;
      }
      continue;
    }

    const mVal = rawLine.match(/^\s+([A-Za-z0-9_]+):\s*(.+?)\s*$/);
    if (mVal && mVal[1] === segments[1]) return mVal[2].replace(/^["']|["']$/g, '');
  }
  return '';
}

function projectSlug() {
  const name = readConfigValue('project', 'name');
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { readConfigValue, projectSlug };
