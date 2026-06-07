import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const require = createRequire(import.meta.url);

// scripts/notion/bootstrap-config.js is CommonJS. It only runs main() under the
// `require.main === module` guard, exporting the pure helpers below for testing.
// These cases are network-free: they cover id parsing, block-title matching, and
// the line-based YAML patcher that fills the consumer's config.
const bootstrap = require(join(PKG_ROOT, 'scripts', 'notion', 'bootstrap-config.js'));

test('parsePageId: extracts the trailing 32-hex id from a Notion URL', () => {
  const { parsePageId } = bootstrap;
  assert.equal(
    parsePageId('https://app.notion.com/p/3783462f68a98135bd4bf2fa128f0ba3'),
    '3783462f-68a9-8135-bd4b-f2fa128f0ba3'
  );
  // slugged title + query string must not interfere
  assert.equal(
    parsePageId('https://www.notion.so/My-Project-3783462f68a98135bd4bf2fa128f0ba3?pvs=4'),
    '3783462f-68a9-8135-bd4b-f2fa128f0ba3'
  );
});

test('parsePageId: accepts bare compact and dashed ids; rejects junk', () => {
  const { parsePageId } = bootstrap;
  assert.equal(parsePageId('3783462f68a98135bd4bf2fa128f0ba3'), '3783462f-68a9-8135-bd4b-f2fa128f0ba3');
  assert.equal(parsePageId('3783462f-68a9-8135-bd4b-f2fa128f0ba3'), '3783462f-68a9-8135-bd4b-f2fa128f0ba3');
  assert.equal(parsePageId('not-an-id'), null);
  assert.equal(parsePageId(''), null);
  assert.equal(parsePageId(undefined), null);
});

test('titleOfBlock: reads child_page / child_database titles, ignores others', () => {
  const { titleOfBlock } = bootstrap;
  assert.equal(titleOfBlock({ type: 'child_page', child_page: { title: 'Board' } }), 'Board');
  assert.equal(titleOfBlock({ type: 'child_database', child_database: { title: 'Tasks' } }), 'Tasks');
  assert.equal(titleOfBlock({ type: 'paragraph', paragraph: {} }), '');
  assert.equal(titleOfBlock(null), '');
});

test('pickChild: matches by type AND exact title', () => {
  const { pickChild } = bootstrap;
  const children = [
    { id: 'p1', type: 'child_page', child_page: { title: 'Board' } },
    { id: 'p2', type: 'child_page', child_page: { title: 'Documentation' } },
    { id: 'd1', type: 'child_database', child_database: { title: 'Board' } },
  ];
  assert.equal(pickChild(children, 'child_page', 'Board').id, 'p1');
  assert.equal(pickChild(children, 'child_database', 'Board').id, 'd1');
  assert.equal(pickChild(children, 'child_page', 'Missing'), null);
});

test('flattenAnchors: nests categories under dotted keys', () => {
  const { flattenAnchors } = bootstrap;
  const flat = flattenAnchors({
    root_page_id: 'r', database_id: 'd', docs_root_id: 'docs',
    claude_md_page_id: 'cm', epics_database_id: 'edb', epics_group_page_id: 'egp',
    categories: { architecture: 'a', database: 'db', testing: 't', cicd: 'ci', features: 'f', aitools: 'ai', epics: 'e' },
  });
  assert.equal(flat.database_id, 'd');
  assert.equal(flat['categories.architecture'], 'a');
  assert.equal(flat['categories.epics'], 'e');
});

test('patchConfigYaml: replaces notion + categories ids, preserves comments', () => {
  const { patchConfigYaml } = bootstrap;
  const input = [
    'project:',
    '  name: "Demo"',
    'notion:',
    '  token_env: "NOTION_TOKEN"',
    '  database_id: "00000000000000000000000000000000"        # task board',
    '  root_page_id: "00000000-0000-0000-0000-000000000000"',
    '  docs_root_id: "00000000000000000000000000000000"',
    '  claude_md_page_id: "00000000000000000000000000000000"',
    '  epics_database_id: "00000000000000000000000000000000"',
    '  epics_group_page_id: "00000000000000000000000000000000"',
    '  categories:',
    '    architecture: "00000000000000000000000000000000"',
    '    database: "00000000000000000000000000000000"',
    '    testing: "00000000000000000000000000000000"',
    '    cicd: "00000000000000000000000000000000"',
    '    features: "00000000000000000000000000000000"',
    '    aitools: "00000000000000000000000000000000"',
    '    epics: "00000000000000000000000000000000"',
    '',
  ].join('\n');

  const values = {
    database_id: 'DB', root_page_id: 'ROOT', docs_root_id: 'DOCS',
    claude_md_page_id: 'CM', epics_database_id: 'EDB', epics_group_page_id: 'EGP',
    'categories.architecture': 'ARCH', 'categories.database': 'DBASE',
    'categories.testing': 'TEST', 'categories.cicd': 'CICD',
    'categories.features': 'FEAT', 'categories.aitools': 'AITOOLS',
    'categories.epics': 'EPICS',
  };

  const { yaml, applied, missing } = patchConfigYaml(input, values);

  assert.equal(missing.length, 0, 'every key should be applied');
  assert.equal(applied.length, 13);
  assert.match(yaml, /database_id: "DB"\s+# task board/, 'preserves inline comment');
  assert.match(yaml, /root_page_id: "ROOT"/);
  assert.match(yaml, /architecture: "ARCH"/);
  assert.match(yaml, /epics: "EPICS"/);
  // token_env must be left untouched
  assert.match(yaml, /token_env: "NOTION_TOKEN"/);
  // project.name must not be touched even though it is a key=value line
  assert.match(yaml, /name: "Demo"/);
});

test('patchConfigYaml: reports keys absent from the config as missing', () => {
  const { patchConfigYaml } = bootstrap;
  const input = [
    'notion:',
    '  database_id: "x"',
    '',
  ].join('\n');
  const { applied, missing } = patchConfigYaml(input, {
    database_id: 'DB',
    root_page_id: 'ROOT',
  });
  assert.deepEqual(applied, ['database_id']);
  assert.ok(missing.includes('root_page_id'));
});

test('patchConfigYaml: does not touch a categories key outside the notion section', () => {
  const { patchConfigYaml } = bootstrap;
  const input = [
    'other:',
    '  categories:',
    '    architecture: "leave-me"',
    'notion:',
    '  categories:',
    '    architecture: "00000000000000000000000000000000"',
    '',
  ].join('\n');
  const { yaml } = patchConfigYaml(input, { 'categories.architecture': 'ARCH' });
  assert.match(yaml, /architecture: "leave-me"/, 'foreign section untouched');
  assert.match(yaml, /architecture: "ARCH"/, 'notion section patched');
});

test('renderYaml: emits a notion block with all 6 anchors + 7 categories', () => {
  const { renderYaml } = bootstrap;
  const out = renderYaml({
    root_page_id: 'r', database_id: 'd', docs_root_id: 'docs',
    claude_md_page_id: 'cm', epics_database_id: 'edb', epics_group_page_id: 'egp',
    categories: { architecture: 'a', database: 'db', testing: 't', cicd: 'ci', features: 'f', aitools: 'ai', epics: 'e' },
  });
  assert.match(out, /^notion:/);
  assert.match(out, /database_id: "d"/);
  assert.match(out, /epics_group_page_id: "egp"/);
  assert.match(out, /aitools: "ai"/);
});
