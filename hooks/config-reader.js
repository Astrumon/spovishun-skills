'use strict';

// THE config reader for spovishun-skills.config.yaml on the consumer side —
// used by the hooks and, through a re-export, by every scripts/notion/ CLI.
// There used to be two hand-written copies of this scanner; they drifted (the
// BOM fix landed in only one), so the same file answered differently depending
// on who asked. Keep it a single file: hooks/ is installed unconditionally
// while scripts/notion/ ships only when stack.notion=true, so scripts may
// depend on hooks and never the reverse.
//
// Deliberately dependency-free: consumer projects get .claude/hooks/ and
// .claude/scripts/ without a node_modules, so `require('js-yaml')` here would
// be MODULE_NOT_FOUND on every install. This reader only has to resolve a
// handful of scalars — it supports 1-level (`section`, `key`) and 2-level
// dotted (`section`, `'sub.key'`) lookups and nothing else.

const fs = require('fs');
const path = require('path');

const CONFIG_FILENAME = 'spovishun-skills.config.yaml';

// Resolved per call, never cached: hooks and scripts are invoked from the
// consumer root, and the tests chdir between cases.
function configPath() {
  return path.join(process.cwd(), CONFIG_FILENAME);
}

function configExists() {
  return fs.existsSync(configPath());
}

// Returns '' when the section/key is absent so callers can chain
// `env || readConfigValue(...) || fallback`.
function readConfigValue(section, keyPath) {
  const configFile = configPath();
  if (!fs.existsSync(configFile)) return '';
  let raw = fs.readFileSync(configFile, 'utf8');
  // Strip a UTF-8 BOM if present — js-yaml does this transparently; the manual
  // line-by-line scanner below would otherwise miss the first top-level key.
  // JS counts ﻿ as \s, so a BOM'd `project:` fails the section regex and
  // every lookup silently returns ''. Windows editors add the BOM on their own.
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

// Same lookup, but a value we cannot resolve *while a config file is sitting
// right there* is a broken config, not a legitimate default — say so instead of
// quietly handing back the placeholder. This is what keeps PROJECT_PREFIX from
// degrading to the literal "project" and sending the hook off to query the
// board with the wrong prefix.
//
// A missing config file stays silent: consumers who drive everything through
// env vars are a supported setup.
function readConfigValueOrWarn(section, keyPath, options) {
  const { fallback = '', label = 'spovishun-skills', stream = process.stderr } = options || {};
  const value = readConfigValue(section, keyPath);
  if (value) return value;
  if (!configExists()) return fallback;
  stream.write(
    `[${label}] ${CONFIG_FILENAME} exists but ${section}.${keyPath} is unreadable — ` +
    `falling back to "${fallback}". Fix the config; results will be wrong until you do.\n`
  );
  return fallback;
}

// Config scalars become branch prefixes and folder names, so the slug rule has
// to be one rule. Lives here next to the reader because every caller slugifies
// something it just read.
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = {
  CONFIG_FILENAME,
  configPath,
  configExists,
  readConfigValue,
  readConfigValueOrWarn,
  slugify,
};
