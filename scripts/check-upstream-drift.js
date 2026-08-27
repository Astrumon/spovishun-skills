#!/usr/bin/env node
// Reports whether the upstream files this repo's derived artifacts were adapted
// from have moved since adaptation. Every derived manifest.yaml carries a
// `source:` block pinning each upstream path to its blob SHA; this script asks
// the GitHub API for the current SHA of the same paths and prints the diff.
//
// Report-only by design: it ALWAYS exits 0, including on network failure or an
// API rate limit. Drift is information for a human, not a reason to fail a
// build — and this must never gate `npm run lint`, which `release.yml` runs
// before publishing to npm.
//
// Set GITHUB_TOKEN (or GH_TOKEN) to lift the 60 requests/hour anonymous limit.
//
//   node scripts/check-upstream-drift.js
//   npm run check:drift

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourcePins } from '../lib/attribution.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'spovishun-skills-drift-check',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

/**
 * Current blob SHA of one upstream path.
 * @returns {{ok: true, sha: string} | {ok: false, reason: string}}
 */
async function currentSha(repo, path, ref) {
  const url =
    `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : '');

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (err) {
    return { ok: false, reason: `network error: ${err.message}` };
  }

  if (response.status === 403 || response.status === 429) {
    return { ok: false, reason: 'rate limited by the GitHub API (set GITHUB_TOKEN to raise the limit)' };
  }
  if (response.status === 404) {
    return { ok: false, reason: 'not found upstream — the file was moved or deleted' };
  }
  if (!response.ok) {
    return { ok: false, reason: `HTTP ${response.status}` };
  }

  const body = await response.json();
  if (typeof body?.sha !== 'string') {
    return { ok: false, reason: 'unexpected API response (no sha field)' };
  }
  return { ok: true, sha: body.sha };
}

const artifacts = collectSourcePins(repoRoot);

if (artifacts.size === 0) {
  process.stdout.write('No derived artifacts declare a source: block — nothing to check.\n');
  process.exit(0);
}

if (!token) {
  process.stdout.write('No GITHUB_TOKEN/GH_TOKEN set — using the anonymous GitHub API (60 req/h).\n');
}

let checked = 0;
let drifted = 0;
let unknown = 0;

// One artifact may be adapted from several upstream repos, so each source is
// queried against its own repository.
for (const [artifact, { sources }] of artifacts) {
  for (const { repo, ref, pins } of sources) {
    for (const entry of pins) {
      const [path, pinnedSha] = entry.split('\0');
      checked++;

      // `ref` records where the SHAs were read; drift means "has the file moved
      // on the default branch since", so the query deliberately omits it.
      const result = await currentSha(repo, path, undefined);

      if (!result.ok) {
        unknown++;
        process.stdout.write(`SKIP ${artifact}  ${repo}/${path}\n     ${result.reason}\n`);
        continue;
      }
      if (result.sha === pinnedSha) {
        process.stdout.write(`OK   ${artifact}  ${repo}/${path}\n`);
        continue;
      }
      drifted++;
      process.stdout.write(
        `DRIFT ${artifact}  ${repo}/${path}\n` +
          `      pinned:  ${pinnedSha}${ref ? ` (at ${ref})` : ''}\n` +
          `      current: ${result.sha}\n`
      );
    }
  }
}

process.stdout.write(
  `\n${checked} pinned file(s) checked — ${drifted} drifted, ${unknown} unknown.\n`
);
if (drifted > 0) {
  process.stdout.write(
    'Re-read the upstream files, fold in anything worth keeping, then update the\n' +
      'source: SHAs and the NOTICE.md rows in the same change.\n'
  );
}

// Always 0 — see the header comment.
process.exit(0);
