#!/usr/bin/env node
/**
 * PreCompact hook — backs up the learnings queue before context compaction.
 *
 * Copies learnings-queue.json to learnings-queue.backup.json if the queue is non-empty.
 * Always exits with exit(0) — never blocks compaction.
 */

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(process.cwd(), '.claude', 'learnings-queue.json');
const BACKUP_FILE = path.join(process.cwd(), '.claude', 'learnings-queue.backup.json');

try {
  if (!fs.existsSync(QUEUE_FILE)) process.exit(0);
  const content = fs.readFileSync(QUEUE_FILE, 'utf8');
  const queue = JSON.parse(content);
  if (Array.isArray(queue) && queue.length > 0) {
    fs.copyFileSync(QUEUE_FILE, BACKUP_FILE);
  }
} catch (_) {
  // Silent — don't block compaction
}

process.exit(0);
