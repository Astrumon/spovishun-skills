import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderArtifact, manifestPlaceholderKeys } from '../lib/render-artifact.js';
import { hasMarker } from '../lib/marker.js';

const configMap = new Map([['PROJECT_NAME', 'FixtureProject']]);

function skill({ id = 'demo', body, placeholders } = {}) {
  return {
    kind: 'skill',
    id,
    version: '1.0.0',
    bodyText: body ?? `---\nname: ${id}\ndescription: d\n---\n\n# {{PROJECT_NAME}}\n`,
    manifest: { id, version: '1.0.0', ...(placeholders && { placeholders }) },
  };
}

test('manifestPlaceholderKeys returns the declared keys, or [] when absent', () => {
  assert.deepEqual(manifestPlaceholderKeys({ placeholders: [{ key: 'A' }, { key: 'B' }] }), ['A', 'B']);
  assert.deepEqual(manifestPlaceholderKeys({}), []);
  assert.deepEqual(manifestPlaceholderKeys(undefined), []);
});

test('renders placeholders from the config map', () => {
  const { rendered } = renderArtifact(skill(), configMap);
  assert.match(rendered, /# FixtureProject/);
  assert.ok(!rendered.includes('{{'), 'no unrendered placeholder should remain');
});

// The whole point of hashing the marker-stripped body: a marked and an unmarked
// render of the same artifact must lock to the same checksum, otherwise every
// pre-marker install would look modified and every target would disagree about
// what the lockfile means.
test('mark: true and mark: false produce the same checksum', () => {
  const artifact = skill();
  const marked = renderArtifact(artifact, configMap, { mark: true });
  const plain = renderArtifact(artifact, configMap);

  assert.equal(marked.checksum, plain.checksum);
  assert.ok(hasMarker(marked.rendered), 'mark: true must stamp the provenance marker');
  assert.ok(!hasMarker(plain.rendered), 'mark: false must leave the body unmarked');
  assert.notEqual(marked.rendered, plain.rendered);
});

test('bodyText overrides artifact.bodyText but keeps the placeholder plumbing', () => {
  const artifact = skill();
  const { rendered } = renderArtifact(artifact, configMap, {
    bodyText: 'preprocessed {{PROJECT_NAME}}',
  });
  assert.equal(rendered, 'preprocessed FixtureProject');
});

// Keys declared in the manifest are optional: a consumer config that does not
// set them renders an empty string instead of failing the whole install.
test('manifest-declared placeholders resolve to an empty string when unset', () => {
  const artifact = skill({
    body: 'branch={{GIT_BRANCH_PREFIX}}!',
    placeholders: [{ key: 'GIT_BRANCH_PREFIX' }],
  });
  const { rendered } = renderArtifact(artifact, configMap);
  assert.equal(rendered, 'branch=!');
});

test('an undeclared unknown placeholder still throws', () => {
  const artifact = skill({ body: '{{NOT_IN_CONFIG}}' });
  assert.throws(() => renderArtifact(artifact, configMap), /NOT_IN_CONFIG/);
});
