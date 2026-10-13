'use strict';

// Splits a task page — the markdown format-task.js renders — into the sections
// of task format v2 (templates/task-page/TEMPLATE.md), and still reads the
// legacy five-section format with its English prompt toggle.
//
// Sections are keyed by the heading's EMOJI, not its words: v2 headings are in
// the project language ("🎯 Навіщо") while legacy ones are English ("🎯 Goal"),
// and both share 🎯 / 🌿 / 📋 / ✅. One table therefore reads both formats in
// any language.
//
// Pure: markdown in, plain object out. get-task.js attaches the result as
// `sections`; notion-task-to-code builds its prompt from it.

const { buildSectionIndex } = require('./section-parser');

const SECTION_EMOJI = [
  ['why', '🎯'],
  ['dod', '✅'],
  ['branch', '🌿'],
  ['context', '📍'],
  ['steps', '📋'],
  ['boundaries', '🧭'],
  ['pitfalls', '🕳'],
  ['outOfScope', '🚫'],
  ['result', '🔎'],
  ['prompt', '🤖'],
];

// The renderer emits a toggle as <details><summary>…</summary> … </details>.
const DETAILS_RE = /<details>\s*<summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/g;
const STEP_RE = /^(\d+)\.\s+(.*)$/;
// Notion-flavoured markdown (MCP fetch) escapes the brackets; the API text does not.
const MARKER_RE = /^\\?\[(agent|manual)\\?\]\s*/i;
const CHECKBOX_RE = /^[-*]\s+\[([ xX])\]\s+(.*)$/;
const BOUNDARY_TIERS = [
  // A lookahead, not \b: \b is ASCII-only and never fires after a Cyrillic word.
  ['always', /^(✅|always(?=[\s:])|завжди(?=[\s:]))/i],
  ['ask', /^(⚠️|⚠|ask(?:\s+first)?(?=[\s:])|спитай(?=[\s:]))/i],
  ['never', /^(🚫|never(?=[\s:])|ніколи(?=[\s:]))/i],
];
// "✅ Завжди: …" — the word after the emoji is a label, not content.
const TIER_LABEL_RE = /^(always|ask(\s+first)?|never|завжди|спитай|ніколи)?\s*:\s*/i;

function sectionKey(headingText) {
  for (const [key, emoji] of SECTION_EMOJI) {
    if (headingText.startsWith(emoji)) return key;
  }
  return null;
}

function stripFence(text) {
  const m = text.trim().match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  return m ? m[1] : text.trim();
}

/** Cuts the 🤖 prompt toggle out of the markdown; returns [rest, promptText|null]. */
function takePromptToggle(markdown) {
  let prompt = null;
  const rest = markdown.replace(DETAILS_RE, (whole, summary, body) => {
    if (prompt === null && summary.trim().startsWith('🤖')) {
      prompt = stripFence(body);
      return '';
    }
    return whole;
  });
  return [rest, prompt];
}

function splitSections(markdown) {
  const lines = markdown.split('\n');
  const index = buildSectionIndex(markdown);
  const raw = {};
  index.forEach((h, i) => {
    const key = sectionKey(h.text);
    if (!key || raw[key] !== undefined) return;
    let end = lines.length;
    for (let j = i + 1; j < index.length; j++) {
      if (index[j].level <= h.level) { end = index[j].line; break; }
    }
    // Legacy pages separate sections with dividers; a trailing `---` belongs to
    // the layout, not to the section (it would otherwise join the last step).
    raw[key] = lines.slice(h.line + 1, end).join('\n').trim().replace(/\n+---$/, '').trim();
  });
  return raw;
}

function parseDod(text) {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const boxes = lines.map(l => l.match(CHECKBOX_RE)).filter(Boolean);
  if (boxes.length > 0) {
    return boxes.map(m => ({ text: m[2].trim(), checked: m[1].toLowerCase() === 'x' }));
  }
  // Legacy prose / quote / plain-list DoD: one unchecked item per line.
  return lines
    .map(l => l.replace(/^>\s?/, '').replace(/^[-*]\s+/, '').trim())
    .filter(l => l && l !== '---')
    .map(l => ({ text: l, checked: false }));
}

function parseSteps(text) {
  if (!text) return [];
  const steps = [];
  for (const line of text.split('\n')) {
    const m = line.match(STEP_RE);
    if (m) {
      const marker = m[2].match(MARKER_RE);
      steps.push({
        n: parseInt(m[1], 10),
        marker: marker ? marker[1].toLowerCase() : null,
        text: m[2].replace(MARKER_RE, '').trim(),
      });
    } else if (steps.length > 0 && line.trim()) {
      // A wrapped or nested line belongs to the step above it.
      steps[steps.length - 1].text += `\n${line.trim()}`;
    }
  }
  return steps;
}

function parseBoundaries(text) {
  const out = { always: [], ask: [], never: [] };
  if (!text) return out;
  for (const line of text.split('\n')) {
    const item = line.trim().replace(/^[-*]\s+/, '');
    for (const [tier, re] of BOUNDARY_TIERS) {
      if (re.test(item)) {
        out[tier].push(item.replace(re, '').trim().replace(TIER_LABEL_RE, '').trim());
        break;
      }
    }
  }
  return out;
}

function parseBranch(text) {
  if (!text) return null;
  const line = text.split('\n').map(l => l.trim().replace(/^`|`$/g, '')).find(l => l.startsWith('feature/'));
  return line || null;
}

/**
 * @param {string} markdown task page body as rendered by format-task.js
 * @returns {{format: 'v2'|'legacy', why: string|null, dod: {text: string, checked: boolean}[],
 *   branch: string|null, context: string|null, steps: {n: number, marker: 'agent'|'manual'|null, text: string}[],
 *   boundaries: {always: string[], ask: string[], never: string[]}, pitfalls: string|null,
 *   outOfScope: string|null, legacyPrompt: string|null}}
 */
function parseTaskSections(markdown) {
  const [body, togglePrompt] = takePromptToggle(markdown || '');
  const raw = splitSections(body);
  // Some legacy tasks keep the prompt under a "## 🤖 …" heading instead of a toggle.
  const legacyPrompt = togglePrompt ?? (raw.prompt ? stripFence(raw.prompt) : null);
  const steps = parseSteps(raw.steps);
  const isV2 = legacyPrompt === null
    && (raw.boundaries !== undefined || steps.some(s => s.marker !== null));

  return {
    format: isV2 ? 'v2' : 'legacy',
    why: raw.why ?? null,
    dod: parseDod(raw.dod),
    branch: parseBranch(raw.branch),
    context: raw.context ?? null,
    steps,
    boundaries: parseBoundaries(raw.boundaries),
    pitfalls: raw.pitfalls ?? null,
    outOfScope: raw.outOfScope ?? null,
    legacyPrompt,
  };
}

module.exports = { parseTaskSections };
