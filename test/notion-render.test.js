import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');

// One fixture set, both renderers, every string pinned.
//
// spovishun-188 collapses scripts/notion/lib/format-task.js and
// hooks/notion-blocks.js onto a single engine. This file is the gate that makes
// "nothing changed" verifiable: it was written and made green BEFORE the
// collapse, over the output both renderers produced at the time.
//
// The `cli` column is a hard regression contract — get-task.js --format=md and
// get-claude-md.js print it, and section-parser.js indexes it. It must not move
// by a single character.

const cli = require(join(PKG_ROOT, 'scripts', 'notion', 'lib', 'format-task.js'));
const hook = require(join(PKG_ROOT, 'hooks', 'notion-blocks.js'));

const rt = (...parts) => parts.map((p) => ({ plain_text: p }));
const b = (type, content, children) => {
  const block = { type, [type]: content };
  if (children) block.children = children;
  return block;
};
const para = (text, children) => b('paragraph', { rich_text: rt(text) }, children);

const FIXTURES = {
  headings: [
    b('heading_1', { rich_text: rt('One') }),
    b('heading_2', { rich_text: rt('Two') }),
    b('heading_3', { rich_text: rt('Three') }),
    b('heading_2', { rich_text: [] }),
  ],
  'paragraph-multiline-and-children': [para('first line\nsecond line', [para('nested')])],
  'bulleted-multiline-nested': [
    b('bulleted_list_item', { rich_text: rt('parent line one\nparent line two') }, [
      b('bulleted_list_item', { rich_text: rt('child') }),
    ]),
  ],
  'numbered-run-restarts': [
    b('numbered_list_item', { rich_text: rt('alpha') }),
    b('numbered_list_item', { rich_text: rt('beta\ncontinued') }),
    b('numbered_list_item', { rich_text: rt('gamma') }, [para('note')]),
    para('interruption'),
    b('numbered_list_item', { rich_text: rt('delta') }),
  ],
  'to-do': [
    b('to_do', { rich_text: rt('done it'), checked: true }),
    b('to_do', { rich_text: rt('not yet\nwith a second line'), checked: false }, [para('why')]),
  ],
  quote: [b('quote', { rich_text: rt('quoted\nover two lines') }, [para('inside')])],
  callout: [
    b('callout', { rich_text: rt('Heads up'), icon: { type: 'emoji', emoji: '\u{1F50D}' } }, [para('detail')]),
    b('callout', { rich_text: rt('No icon'), icon: { type: 'external', external: {} } }),
  ],
  code: [
    b('code', { rich_text: rt('val x = 1'), language: 'kotlin' }),
    b('code', { rich_text: rt('echo hi'), language: 'plain text' }),
    b('code', { rich_text: rt('bare') }),
  ],
  divider: [para('before'), b('divider', {}), para('after')],
  toggle: [
    b('toggle', { rich_text: rt('\u{1F916} prompt') }, [
      para('Context.'),
      b('numbered_list_item', { rich_text: rt('Extend it.') }),
    ]),
  ],
  'table-with-header': [
    b('table', { table_width: 2, has_column_header: true }, [
      b('table_row', { cells: [rt('A'), rt('B')] }),
      b('table_row', { cells: [rt('1'), rt('2')] }),
    ]),
  ],
  'table-headerless-and-escapes': [
    b('table', { table_width: 2, has_column_header: false }, [
      b('table_row', { cells: [rt('a|b'), rt('multi\nline')] }),
    ]),
  ],
  'table-empty': [b('table', { table_width: 2, has_column_header: true }, [])],
  'empty-and-unknown': [
    { type: 'unsupported' },
    b('paragraph', { rich_text: [] }),
    b('bookmark', { rich_text: rt('a bookmark caption') }),
    {},
  ],
  'adjacent-standalone-blocks': [
    b('divider', {}),
    b('code', { rich_text: rt('x'), language: 'kotlin' }),
    b('table', { table_width: 1, has_column_header: true }, [b('table_row', { cells: [rt('T')] })]),
    b('heading_2', { rich_text: rt('After') }),
  ],
  'deep-nesting': [
    b('toggle', { rich_text: rt('outer') }, [
      b('bulleted_list_item', { rich_text: rt('level one') }, [
        b('quote', { rich_text: rt('level two') }, [para('level three')]),
      ]),
    ]),
  ],
};

const BASELINE = {
  headings: {
    cli: '# One\n\n## Two\n\n### Three',
    hook: '# One\n## Two\n### Three\n## ',
  },
  'paragraph-multiline-and-children': {
    cli: 'first line\nsecond line\n  nested',
    hook: 'first line\nsecond line',
  },
  'bulleted-multiline-nested': {
    cli: '- parent line one\n  parent line two\n  - child',
    hook: '- parent line one\nparent line two\n  - child',
  },
  'numbered-run-restarts': {
    cli: '1. alpha\n2. beta\n   continued\n3. gamma\n  note\ninterruption\n1. delta',
    hook: '1. alpha\n1. beta\ncontinued\n1. gamma\n  note\ninterruption\n1. delta',
  },
  'to-do': {
    cli: '- [x] done it\n- [ ] not yet\n      with a second line\n  why',
    hook: '- [x] done it\n- [ ] not yet\nwith a second line',
  },
  quote: {
    cli: '> quoted\n> over two lines\n> inside',
    hook: '> quoted\n> over two lines\n> inside',
  },
  callout: {
    cli: '> \u{1F50D} Heads up\n> detail\n> No icon',
    hook: '> \u{1F50D} Heads up\n> detail\n> No icon',
  },
  code: {
    cli: '```kotlin\nval x = 1\n```\n\n```\necho hi\n```\n\n```\nbare\n```',
    hook: '```\nval x = 1\n```\n```\necho hi\n```\n```\nbare\n```',
  },
  divider: {
    cli: 'before\n\n---\n\nafter',
    hook: 'before\n---\nafter',
  },
  toggle: {
    cli: '<details>\n<summary>\u{1F916} prompt</summary>\n\nContext.\n1. Extend it.\n\n</details>',
    hook: '<details>\n<summary>\u{1F916} prompt</summary>\n\nContext.\n1. Extend it.\n\n</details>',
  },
  'table-with-header': {
    cli: '| A | B |\n| --- | --- |\n| 1 | 2 |',
    hook: '| A | B |\n| 1 | 2 |',
  },
  'table-headerless-and-escapes': {
    cli: '|  |  |\n| --- | --- |\n| a|b | multi line |',
    hook: '| a\\|b | multi line |',
  },
  'table-empty': { cli: '', hook: '' },
  'empty-and-unknown': { cli: 'a bookmark caption', hook: 'a bookmark caption' },
  'adjacent-standalone-blocks': {
    cli: '---\n\n```kotlin\nx\n```\n\n| T |\n| --- |\n\n## After',
    hook: '---\n```\nx\n```\n| T |\n## After',
  },
  'deep-nesting': {
    cli: '<details>\n<summary>outer</summary>\n\n- level one\n  > level two\n  > level three\n\n</details>',
    hook: '<details>\n<summary>outer</summary>\n\n- level one\n  > level two\n  > level three\n\n</details>',
  },
};

test('every fixture is pinned on both renderers', () => {
  assert.deepEqual(Object.keys(BASELINE).sort(), Object.keys(FIXTURES).sort());
});

for (const [name, blocks] of Object.entries(FIXTURES)) {
  test(`cli renderer: ${name}`, () => {
    assert.equal(cli.extractBlocks(blocks), BASELINE[name].cli);
  });
  test(`hook renderer: ${name}`, () => {
    assert.equal(hook.extractBlocks(blocks), BASELINE[name].hook);
  });
}

// The two richText helpers stay separate on purpose and are NOT part of the
// renderer: the CLI one trims (it reads page titles and property values), the
// hook one does not (branch-name.js regex-matches raw paragraph text).
test('richText: the CLI variant trims, the hook variant does not', () => {
  const runs = [{ plain_text: '  feature/x-1 ' }];
  assert.equal(cli.richText(runs), 'feature/x-1');
  assert.equal(hook.richText(runs), '  feature/x-1 ');
  assert.equal(cli.richText(null), '');
  assert.equal(hook.richText(null), '');
});
