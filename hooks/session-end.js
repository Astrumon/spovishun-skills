#!/usr/bin/env node
/**
 * Stop hook — detects changes in architectural files and reminds to update documentation.
 *
 * Runs after each Claude response (Stop event).
 * Reads SPOVISHUN_TRIGGER_PATTERNS env var (comma-separated regex strings) to customize which
 * files trigger the doc-sync reminder. Falls back to a generic set if not set.
 * Always exits with exit(0) — errors do not block work.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TRIGGER_PATTERNS = [
  /db\/migration.*\.sql$/i,
  /migration.*\.sql$/i,
  /schema\.(sql|kt|ts|py|rb)$/i,
  /module\.(kt|ts|py|rb|go)$/i,
  /Application\.(kt|ts|py|rb|go)$/i,
  /CLAUDE\.md$/,
  /build\.(gradle|gradle\.kts|xml|json)$/i,
];

function loadPatterns() {
  const env = process.env.SPOVISHUN_TRIGGER_PATTERNS;
  if (!env) return DEFAULT_TRIGGER_PATTERNS;
  try {
    return env.split(',').map(s => new RegExp(s.trim(), 'i'));
  } catch {
    return DEFAULT_TRIGGER_PATTERNS;
  }
}

function getChangedFiles() {
  try {
    const output = execSync('git diff --name-only HEAD', { encoding: 'utf8', timeout: 10000 });
    return output.trim().split('\n').filter(Boolean);
  } catch (err) {
    process.stderr.write(`[session-end] git unavailable: ${err.message}\n`);
    return [];
  }
}

try {
  const patterns = loadPatterns();
  const changedFiles = getChangedFiles();
  const triggered = changedFiles.filter(f => patterns.some(p => p.test(f)));

  if (triggered.length > 0) {
    const fileList = triggered.map(f => `  - ${f}`).join('\n');
    const message = `Doc-sync: architectural files changed:\n${fileList}\n\nRun /update-doc-full to sync documentation.`;
    process.stdout.write(JSON.stringify({ systemMessage: message }) + '\n');
  }

  const stateFile = path.join(process.cwd(), '.claude', 'session-state.json');
  const state = {
    lastSession: new Date().toISOString(),
    changedFiles,
    docSyncNeeded: triggered.length > 0,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
} catch (err) {
  process.stderr.write(`[session-end] Warning: ${err.message}\n`);
}

process.exit(0);
