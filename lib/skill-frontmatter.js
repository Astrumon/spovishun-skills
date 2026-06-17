/**
 * Helpers for synthesizing the YAML frontmatter block that Claude Code expects
 * at the top of every `.claude/skills/<id>/SKILL.md` file.
 *
 * Claude Code parses `name` and `description` from the frontmatter to drive
 * skill triggering. A SKILL.md without it falls back to the body's first H1,
 * which silently degrades trigger quality. Most manifests carry their
 * metadata only in `manifest.yaml`, so the Claude adapter must synthesize the
 * block from the manifest at install time.
 */

import { injectMarker } from './marker.js';

const FRONTMATTER_FENCE = '---';

/**
 * Detects a leading YAML frontmatter block. Accepts both `\n` and `\r\n`
 * line endings on the opening fence.
 */
export function hasFrontmatter(text) {
  if (typeof text !== 'string' || text.length < 4) return false;
  return text.startsWith(`${FRONTMATTER_FENCE}\n`) || text.startsWith(`${FRONTMATTER_FENCE}\r\n`);
}

/**
 * Builds a minimal but trigger-rich `description:` value for the synthesized
 * frontmatter. Starts from `manifest.description` and appends a
 * `Triggers: <terms>.` sentence built from `manifest.triggers.en` and
 * `manifest.triggers.uk` so triggering matches the convention used by
 * skills with hand-authored inline frontmatter (e.g. code-reviewer).
 *
 * Returns an empty string if neither piece is available — the caller decides
 * whether that is an error worth surfacing.
 */
export function composeSkillDescription(manifest) {
  const base = typeof manifest?.description === 'string' ? manifest.description.trim() : '';
  const triggers = collectTriggers(manifest);
  if (triggers.length === 0) return base;
  const suffix = `Triggers: ${triggers.join(', ')}.`;
  if (!base) return suffix;
  const needsPeriod = !/[.!?]$/.test(base);
  return needsPeriod ? `${base}. ${suffix}` : `${base} ${suffix}`;
}

function collectTriggers(manifest) {
  const en = Array.isArray(manifest?.triggers?.en) ? manifest.triggers.en : [];
  const uk = Array.isArray(manifest?.triggers?.uk) ? manifest.triggers.uk : [];
  const seen = new Set();
  const out = [];
  for (const t of [...en, ...uk]) {
    if (typeof t !== 'string') continue;
    const trimmed = t.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Builds the `---\nname: ...\ndescription: ...\n---\n` block for the given
 * manifest. `description` values are emitted as JSON-encoded strings to
 * survive embedded quotes, colons, and trailing punctuation without
 * hand-rolled escaping.
 */
export function buildSkillFrontmatter(manifest) {
  const name = manifest?.id ?? '';
  const description = composeSkillDescription(manifest);
  const lines = [FRONTMATTER_FENCE, `name: ${name}`];
  if (description) {
    lines.push(`description: ${JSON.stringify(description)}`);
  }
  // Invocation flags are emitted only when they diverge from Claude Code's
  // defaults (user_invocable: true, disable-model-invocation: false), so the
  // synthesized block stays minimal for the common case.
  if (manifest?.user_invocable === false) {
    lines.push('user_invocable: false');
  }
  if (manifest?.['disable-model-invocation'] === true) {
    lines.push('disable-model-invocation: true');
  }
  lines.push(FRONTMATTER_FENCE, '');
  return lines.join('\n');
}

/**
 * Returns `renderedBody` unchanged if it already starts with a frontmatter
 * fence (hand-authored inline frontmatter wins — we never double-wrap).
 * Otherwise prepends a synthesized block built from `manifest`.
 *
 * Only call for `kind === 'skill'`. Agents intentionally ship richer
 * Claude-specific frontmatter (tools, model, maxTurns) and templates carry
 * no metadata Claude consumes.
 */
export function ensureSkillFrontmatter(renderedBody, manifest) {
  if (hasFrontmatter(renderedBody)) return renderedBody;
  return buildSkillFrontmatter(manifest) + renderedBody;
}

/**
 * Produces the final Claude-loadable body to write for a given artifact kind,
 * stamped with its provenance marker:
 *
 *   - skill: synthesize frontmatter if absent, then inject the marker
 *   - agent: inject the marker into the existing hand-authored frontmatter
 *   - everything else (templates, …): returned unchanged (lockfile-only owned)
 *
 * Idempotent — re-running over an already-marked body refreshes the marker in
 * place. The single choke point shared by the install adapter, the update
 * adapter, and the upstream-checksum render in `bin/update.js`, so the marker
 * is applied identically everywhere.
 */
export function markBody({ body, kind, manifest }) {
  const id = manifest?.id ?? '';
  if (kind === 'skill') return injectMarker(ensureSkillFrontmatter(body, manifest), id);
  if (kind === 'agent') return injectMarker(body, id);
  return body;
}
