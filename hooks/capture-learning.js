#!/usr/bin/env node
/**
 * UserPromptSubmit hook — detects correction patterns in user prompts and queues them for /reflect.
 *
 * Matches Ukrainian and English correction signals via regex (no LLM calls).
 * Appends matched entries to .claude/learnings-queue.json.
 * Emits a systemMessage only on match; exits silently on miss.
 * Always exits with exit(0) — never blocks the prompt.
 */

const fs = require('fs');
const path = require('path');

// \b does not work with Cyrillic (Unicode chars are \W in JS regex), so use an explicit anchor
const UA_PATTERN = /(?:^|[\s,;!?.])(ні[,\s]|не\s|стоп|зачекай|почекай|насправді|правильніше|краще|давай\s+по-іншому|переробимо|не\s+так)/i;
const EN_PATTERN = /\b(no[,\s]|wait|actually|stop|let'?s\s+redo|that'?s\s+wrong|instead)\b/i;

const QUEUE_FILE = path.join(process.cwd(), '.claude', 'learnings-queue.json');
const ERROR_LOG = path.join(process.cwd(), '.claude', 'learnings-queue.errors.log');
const MAX_ENTRIES = 500;
const MAX_PROMPT_LENGTH = 2000;

function output(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function logError(err) {
  try {
    fs.appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${err.message}\n`);
  } catch (_) { /* last resort — ignore */ }
}

function detectMatch(prompt) {
  const uaMatch = UA_PATTERN.exec(prompt);
  if (uaMatch) return uaMatch[1].trim();
  const enMatch = EN_PATTERN.exec(prompt);
  if (enMatch) return enMatch[1].trim();
  return null;
}

function readQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}

function writeQueue(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

try {
  const chunks = [];
  process.stdin.on('data', chunk => chunks.push(chunk));
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const prompt = (input.prompt || '').trim();
      if (!prompt) process.exit(0);

      const matchedPattern = detectMatch(prompt);
      if (!matchedPattern) process.exit(0);

      const queue = readQueue();

      const entry = {
        timestamp: new Date().toISOString(),
        sessionId: input.session_id || null,
        matchedPattern,
        prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
        previousAssistantTurnHash: null,
      };

      const updated = [...queue, entry];
      if (updated.length > MAX_ENTRIES) {
        updated.splice(0, updated.length - MAX_ENTRIES);
      }

      writeQueue(updated);

      output({ systemMessage: `Learning captured for /reflect (queue: ${updated.length})` });
    } catch (err) {
      logError(err);
      process.exit(0);
    }
  });
} catch (err) {
  logError(err);
  process.exit(0);
}
