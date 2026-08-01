import { renderTemplate } from './template-renderer.js';
import { sha256 } from './checksum.js';
import { markBody } from './skill-frontmatter.js';
import { stripMarker } from './marker.js';

/**
 * The declared placeholder keys of an artifact's manifest.
 *
 * Keys listed here are OPTIONAL: renderTemplate resolves a missing one to an
 * empty string instead of failing the install. Every caller that renders an
 * artifact body — or one of its supporting files — needs this list, which is why
 * it is exported separately from renderArtifact.
 *
 * @param {object|undefined} manifest
 * @returns {string[]}
 */
export function manifestPlaceholderKeys(manifest) {
  return (manifest?.placeholders ?? []).map((p) => p.key);
}

/**
 * Renders one artifact body and takes its lockfile checksum — the triplet that
 * used to be copy-pasted into both install adapters, the AGENTS.md builder and
 * `update`, where a change to any one of them silently desynchronised the
 * checksums the lockfile compares.
 *
 * The checksum is ALWAYS taken over the marker-stripped body. For unmarked
 * targets that is the identity (stripMarker is a no-op without a marker), so
 * codex and windsurf checksums are unchanged; for marked bodies it is what keeps
 * the checksum invariant to marker presence and lets pre-marker installs match
 * their lockfile entry.
 *
 * @param {object} artifact — as returned by loadArtifacts()
 * @param {Map<string, string>} configMap — from buildPlaceholderMap(config)
 * @param {object} [opts]
 * @param {boolean} [opts.mark]     — stamp the x-spovishun provenance marker (marker-ownership targets)
 * @param {string}  [opts.bodyText] — render this instead of artifact.bodyText, for callers
 *                                    that preprocess the body first (codex strips frontmatter)
 * @returns {{rendered: string, checksum: string}}
 */
export function renderArtifact(artifact, configMap, { mark = false, bodyText } = {}) {
  const body = renderTemplate(bodyText ?? artifact.bodyText, {
    configMap,
    manifestPlaceholders: manifestPlaceholderKeys(artifact.manifest),
  });
  const rendered = mark
    ? markBody({ body, kind: artifact.kind, manifest: artifact.manifest })
    : body;
  return { rendered, checksum: sha256(stripMarker(rendered)) };
}
