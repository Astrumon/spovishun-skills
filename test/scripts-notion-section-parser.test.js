import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { buildSectionIndex, extractSection } = require(
  join(here, '..', 'scripts', 'notion', 'lib', 'section-parser.js')
);

// Only the match paths are exercised: the no-match and ambiguous branches call
// process.exit(1) by design, and a CLI that exits is not a unit under test.

const PAGE = [
  '# CLAUDE.md',
  'intro line',
  '',
  '## Commands',
  '```bash',
  '# install deps — a comment, not a heading',
  'npm ci',
  '## not a heading either',
  '```',
  'after the fence',
  '',
  '## Testing',
  'run npm test',
].join('\n');

test('buildSectionIndex ignores headings that are really code-fence content', () => {
  assert.deepEqual(
    buildSectionIndex(PAGE).map(h => h.text),
    ['CLAUDE.md', 'Commands', 'Testing']
  );
});

// format-task.js now renders `code` blocks as fences, so a shell snippet whose
// first line is a `#` comment would otherwise cut --section short right there.
test('extractSection keeps the whole fenced block inside its section', () => {
  const out = extractSection(PAGE, 'commands');
  assert.ok(out.startsWith('## Commands'));
  assert.ok(out.includes('npm ci'), 'fence body must survive');
  assert.ok(out.includes('after the fence'), 'section must not end at the comment line');
  assert.ok(!out.includes('run npm test'), 'section must stop at the next real heading');
});

test('extractSection stops at a heading of the same or shallower level', () => {
  const md = '# Top\na\n\n## One\nb\n\n### Deep\nc\n\n## Two\nd';
  assert.equal(extractSection(md, 'One'), '## One\nb\n\n### Deep\nc');
});

test('a section that runs to the end of the page is returned whole', () => {
  assert.equal(extractSection(PAGE, 'testing'), '## Testing\nrun npm test');
});
