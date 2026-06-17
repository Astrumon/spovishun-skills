import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectMarker, stripMarker, readMarker, hasMarker, MARKER_KEY } from '../lib/marker.js';
import { sha256 } from '../lib/checksum.js';

const SKILL = '---\nname: demo\ndescription: "d"\n---\n# Body\n\ntext\n';

test('injectMarker inserts the marker right after the opening fence', () => {
  const out = injectMarker(SKILL, 'demo');
  assert.equal(out, `---\n${MARKER_KEY}: demo\nname: demo\ndescription: "d"\n---\n# Body\n\ntext\n`);
});

test('injectMarker is idempotent — never stacks duplicate markers', () => {
  const once = injectMarker(SKILL, 'demo');
  const twice = injectMarker(once, 'demo');
  assert.equal(twice, once);
});

test('injectMarker refreshes an existing marker with a new id', () => {
  const a = injectMarker(SKILL, 'old');
  const b = injectMarker(a, 'new');
  assert.equal(readMarker(b), 'new');
  assert.ok(!b.includes('old'));
});

test('injectMarker is a no-op without frontmatter or without an id', () => {
  assert.equal(injectMarker('# no frontmatter\n', 'x'), '# no frontmatter\n');
  assert.equal(injectMarker(SKILL, ''), SKILL);
});

test('stripMarker is the exact inverse of injectMarker', () => {
  assert.equal(stripMarker(injectMarker(SKILL, 'demo')), SKILL);
});

test('stripMarker is a no-op when there is no marker', () => {
  assert.equal(stripMarker(SKILL), SKILL);
});

test('checksum is invariant to marker presence', () => {
  const marked = injectMarker(SKILL, 'demo');
  assert.equal(sha256(stripMarker(marked)), sha256(SKILL));
});

test('readMarker / hasMarker report the marker id', () => {
  const marked = injectMarker(SKILL, 'demo');
  assert.equal(readMarker(marked), 'demo');
  assert.equal(hasMarker(marked), true);
  assert.equal(readMarker(SKILL), null);
  assert.equal(hasMarker(SKILL), false);
});

test('a body line that looks like a marker outside frontmatter is ignored', () => {
  const body = `---\nname: x\n---\n\n${MARKER_KEY}: not-a-marker\n`;
  assert.equal(hasMarker(body), false);
  assert.equal(stripMarker(body), body, 'body content must stay untouched');
});

test('CRLF frontmatter keeps its line endings', () => {
  const crlf = '---\r\nname: demo\r\n---\r\n# Body\r\n';
  const out = injectMarker(crlf, 'demo');
  assert.equal(out, `---\r\n${MARKER_KEY}: demo\r\nname: demo\r\n---\r\n# Body\r\n`);
  assert.equal(stripMarker(out), crlf);
});
