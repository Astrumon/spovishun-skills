import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasFrontmatter,
  composeSkillDescription,
  buildSkillFrontmatter,
  ensureSkillFrontmatter,
} from '../lib/skill-frontmatter.js';

test('hasFrontmatter detects LF and CRLF opening fences', () => {
  assert.equal(hasFrontmatter('---\nname: x\n---\n# body\n'), true);
  assert.equal(hasFrontmatter('---\r\nname: x\r\n---\r\n'), true);
  assert.equal(hasFrontmatter('# body\n---\n'), false, 'fence not at the very start');
  assert.equal(hasFrontmatter(''), false);
  assert.equal(hasFrontmatter(null), false);
  assert.equal(hasFrontmatter(undefined), false);
});

test('composeSkillDescription appends a Triggers: clause built from en + uk', () => {
  const desc = composeSkillDescription({
    description: 'Reviews pull requests for quality.',
    triggers: { en: ['review this PR', 'code review'], uk: ['переглянь код'] },
  });
  assert.ok(desc.includes('Reviews pull requests for quality.'));
  assert.ok(desc.includes('Triggers: review this PR, code review, переглянь код.'));
});

test('composeSkillDescription returns the bare description when no triggers exist', () => {
  const desc = composeSkillDescription({ description: 'Bare summary.' });
  assert.equal(desc, 'Bare summary.');
});

test('composeSkillDescription deduplicates and drops blank trigger entries', () => {
  const desc = composeSkillDescription({
    description: 'X',
    triggers: { en: ['a', 'a', ''], uk: ['a', 'b'] },
  });
  assert.equal(desc, 'X. Triggers: a, b.');
});

test('buildSkillFrontmatter emits a JSON-quoted description', () => {
  const block = buildSkillFrontmatter({
    id: 'my-skill',
    description: 'Uses "quotes" and: colons.',
  });
  assert.match(block, /^---\nname: my-skill\ndescription: "Uses \\"quotes\\" and: colons\."\n---\n$/);
});

test('buildSkillFrontmatter emits user_invocable: false when manifest opts out', () => {
  const block = buildSkillFrontmatter({ id: 's', description: 'D', user_invocable: false });
  assert.match(block, /\nuser_invocable: false\n/);
});

test('buildSkillFrontmatter emits disable-model-invocation: true when set', () => {
  const block = buildSkillFrontmatter({ id: 's', description: 'D', 'disable-model-invocation': true });
  assert.match(block, /\ndisable-model-invocation: true\n/);
});

test('buildSkillFrontmatter omits invocation flags at their defaults', () => {
  const block = buildSkillFrontmatter({
    id: 's',
    description: 'D',
    user_invocable: true,
    'disable-model-invocation': false,
  });
  assert.doesNotMatch(block, /user_invocable/);
  assert.doesNotMatch(block, /disable-model-invocation/);
});

test('ensureSkillFrontmatter prepends a block when missing', () => {
  const body = '# Title\n\nBody.\n';
  const out = ensureSkillFrontmatter(body, {
    id: 'demo',
    description: 'Demo skill.',
    triggers: { en: ['demo'] },
  });
  assert.match(out, /^---\nname: demo\n/);
  assert.ok(out.includes('# Title'), 'original body must remain intact');
});

test('ensureSkillFrontmatter never double-wraps an inline-frontmatter body', () => {
  const inline = '---\nname: x\ndescription: y\n---\n# Body\n';
  const out = ensureSkillFrontmatter(inline, { id: 'x', description: 'ignored' });
  assert.equal(out, inline);
});
