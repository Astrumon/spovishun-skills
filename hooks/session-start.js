#!/usr/bin/env node
/**
 * SessionStart hook — reads session-state.json and reminds about pending doc sync.
 *
 * If docSyncNeeded is true from the previous session — outputs a systemMessage.
 * If session-state.json does not exist — exits silently.
 * Always exits with exit(0) — errors do not block session start.
 */

const fs = require('fs');
const path = require('path');

const stateFile = path.join(process.cwd(), '.claude', 'session-state.json');
const queueFile = path.join(process.cwd(), '.claude', 'learnings-queue.json');

try {
  const messages = [];

  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.docSyncNeeded) {
      messages.push('Last session left doc sync pending. Run doc-updater if still relevant.');
    }
  }

  if (fs.existsSync(queueFile)) {
    try {
      const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
      if (Array.isArray(queue) && queue.length > 5) {
        messages.push(`Learnings queue has ${queue.length} entries. Run /reflect to process.`);
      }
    } catch (_) { /* ignore malformed queue */ }
  }

  if (messages.length > 0) {
    process.stdout.write(JSON.stringify({ systemMessage: messages.join('\n') }) + '\n');
  }
} catch (err) {
  // Silent — don't block session start
}

process.exit(0);
