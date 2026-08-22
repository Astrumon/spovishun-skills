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
// get-claude-md.js print it, and section-parser.js indexes it. It moved on
// exactly one fixture, the pipe escape, and that line says why.
//
// The `hook` column did move. It feeds .dev-context/<branch>/task.json, a
// regenerated cache, and seven of its behaviours were simply behind the CLI
// renderer rather than deliberately compact. Every one of those is marked
// CHANGED on the fixture it belongs to, with what was wrong with the old
// output. What stayed different is the two real options — no blank line before
// a heading, no separators around standalone blocks.

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
    // CHANGED by 188: an empty heading used to render as a bare `## `. It now
    // drops out, as it always did on the CLI side.
    hook: '# One\n## Two\n### Three',
    // The two surviving options are visible here and in `divider` below: the
    // CLI puts a blank line before every heading, the hook does not.
  },
  'paragraph-multiline-and-children': {
    cli: 'first line\nsecond line\n  nested',
    // CHANGED by 188: the hook dropped a paragraph's children entirely.
    hook: 'first line\nsecond line\n  nested',
  },
  'bulleted-multiline-nested': {
    cli: '- parent line one\n  parent line two\n  - child',
    // CHANGED by 188: `- ${text}` put the second line at column 0, which reads
    // as a new paragraph and breaks the list.
    hook: '- parent line one\n  parent line two\n  - child',
  },
  'numbered-run-restarts': {
    cli: '1. alpha\n2. beta\n   continued\n3. gamma\n  note\ninterruption\n1. delta',
    // CHANGED by 188: every item used to be `1.`, and a run's ordinals now
    // restart after a non-numbered sibling the way Notion scopes them.
    hook: '1. alpha\n2. beta\n   continued\n3. gamma\n  note\ninterruption\n1. delta',
  },
  'to-do': {
    cli: '- [x] done it\n- [ ] not yet\n      with a second line\n  why',
    // CHANGED by 188: same column-0 continuation as the bulleted case, plus the
    // hook rendered no children at all under a to_do.
    hook: '- [x] done it\n- [ ] not yet\n      with a second line\n  why',
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
    // CHANGED by 188: the hook emitted a bare fence, losing the language.
    hook: '```kotlin\nval x = 1\n```\n```\necho hi\n```\n```\nbare\n```',
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
    // CHANGED by 188: without the separator row this is not a markdown table at
    // all — every row read as one paragraph.
    hook: '| A | B |\n| --- | --- |\n| 1 | 2 |',
  },
  'table-headerless-and-escapes': {
    // CHANGED by 188 — the one deliberate CLI change in this task. The escape
    // was `.replace(/\|/g, '\|')`, and '\|' in JS is just '|': a cell holding a
    // literal pipe split into two columns. marked's GFM table parser (which
    // markdown-to-blocks.js drives) expects `\|`, so this is the round trip
    // being fixed, not broken.
    cli: '|  |  |\n| --- | --- |\n| a\\|b | multi line |',
    // CHANGED by 188: a headerless Notion table lost its empty header row and
    // its separator.
    hook: '|  |  |\n| --- | --- |\n| a\\|b | multi line |',
  },
  'table-empty': { cli: '', hook: '' },
  'empty-and-unknown': { cli: 'a bookmark caption', hook: 'a bookmark caption' },
  'adjacent-standalone-blocks': {
    cli: '---\n\n```kotlin\nx\n```\n\n| T |\n| --- |\n\n## After',
    // CHANGED by 188 (fence language + table separator). The `standalone`
    // option is what still separates the two columns: the hook packs these four
    // blocks with no blank lines between them.
    hook: '---\n```kotlin\nx\n```\n| T |\n| --- |\n## After',
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

// The claim the two columns above encode: they are one engine under two option
// sets, not two renderers that happen to agree. Bind the hook's own
// createRenderer with the CLI's options and the CLI column comes back.
test('the two columns are one engine — options are the whole difference', () => {
  const asCli = hook.createRenderer({ headingLead: '\n', standalone: true });
  const asHook = cli.createRenderer({ headingLead: '', standalone: false });
  for (const [name, blocks] of Object.entries(FIXTURES)) {
    assert.equal(asCli.extractBlocks(blocks), BASELINE[name].cli, name);
    assert.equal(asHook.extractBlocks(blocks), BASELINE[name].hook, name);
  }
});

test('createRenderer defaults to the CLI binding', () => {
  const { extractBlocks } = cli.createRenderer();
  assert.equal(extractBlocks(FIXTURES.divider), BASELINE.divider.cli);
});

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
