import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaceholderMap } from '../lib/placeholder-map.js';

const fullConfig = {
  project: { name: 'TestProject', language: 'uk' },
  stack: { kotlin: true, postgres: false, telegram: false, notion: true },
  notion: {
    token_env: 'NOTION_TOKEN',
    database_id: 'aabbccdd1122334455667788aabbccdd',
    epics_database_id: 'eeff00112233445566778899eeff0011',
    root_page_id: '11223344556677889900aabbccddeeff',
    docs_root_id: 'ffeeddccbbaa00998877665544332211',
    claude_md_page_id: '00112233445566778899aabbccddeeff',
    epics_group_page_id: 'aabbccddeeff00112233445566778899',
  },
  git: { branch_prefix: 'feature/test', main_branch: 'main', dev_branch: 'develop' },
};

const minimalConfig = {
  project: { name: 'MinimalProject', language: 'en' },
  stack: { kotlin: false, postgres: false, telegram: false, notion: false },
  git: { branch_prefix: 'feature/min', main_branch: 'main', dev_branch: 'develop' },
};

test('full config → all keys including NOTION_* are present', () => {
  const map = buildPlaceholderMap(fullConfig);

  assert.equal(map.get('PROJECT_NAME'), 'TestProject');
  assert.equal(map.get('PROJECT_LANGUAGE'), 'uk');
  assert.equal(map.get('GIT_BRANCH_PREFIX'), 'feature/test');
  assert.equal(map.get('BRANCH_PREFIX'), 'feature/test');
  assert.equal(map.get('GIT_MAIN_BRANCH'), 'main');
  assert.equal(map.get('GIT_DEV_BRANCH'), 'develop');
  assert.equal(map.get('NOTION_TOKEN_ENV'), 'NOTION_TOKEN');
  assert.equal(map.get('NOTION_DATABASE_ID'), 'aabbccdd1122334455667788aabbccdd');
  assert.equal(map.get('NOTION_EPICS_DATABASE_ID'), 'eeff00112233445566778899eeff0011');
});

test('no-notion config → no NOTION_* keys in map', () => {
  const map = buildPlaceholderMap(minimalConfig);

  assert.equal(map.has('NOTION_TOKEN_ENV'), false);
  assert.equal(map.has('NOTION_DATABASE_ID'), false);
  assert.equal(map.has('NOTION_EPICS_DATABASE_ID'), false);
  assert.equal(map.has('NOTION_ROOT_PAGE_ID'), false);
});

test('all values in map are strings', () => {
  const map = buildPlaceholderMap(fullConfig);
  for (const [key, value] of map) {
    assert.equal(typeof value, 'string', `Expected string for key ${key}, got ${typeof value}`);
  }
});

test('GIT_BRANCH_PREFIX and BRANCH_PREFIX share the same value', () => {
  const map = buildPlaceholderMap(fullConfig);
  assert.equal(map.get('GIT_BRANCH_PREFIX'), map.get('BRANCH_PREFIX'));
});

test('returns a Map instance', () => {
  const map = buildPlaceholderMap(minimalConfig);
  assert.ok(map instanceof Map);
});

test('PROJECT_PREFIX is derived from project.name as a lowercase kebab slug', () => {
  const map = buildPlaceholderMap({
    project: { name: 'My Test Project!', language: 'uk' },
    stack: { kotlin: false, postgres: false, telegram: false, notion: false },
    git: { branch_prefix: 'feature/', main_branch: 'main', dev_branch: 'develop' },
  });
  assert.equal(map.get('PROJECT_PREFIX'), 'my-test-project');
});

test('GIT_DEVELOP_BRANCH is an alias for git.dev_branch (back-compat)', () => {
  const map = buildPlaceholderMap(fullConfig);
  assert.equal(map.get('GIT_DEVELOP_BRANCH'), 'develop');
  assert.equal(map.get('GIT_DEVELOP_BRANCH'), map.get('GIT_DEV_BRANCH'));
});

test('notion.categories → NOTION_CATEGORY_<K>_ID and derived NOTION_ZONE_<K>_URL', () => {
  const map = buildPlaceholderMap({
    ...fullConfig,
    notion: {
      ...fullConfig.notion,
      categories: {
        architecture: '33c3462f68a9819894a4df73c3b7d9fe',
        cicd: '33c3462f68a98146bf26cc0e5f5c2799',
      },
    },
  });
  assert.equal(map.get('NOTION_CATEGORY_ARCHITECTURE_ID'), '33c3462f68a9819894a4df73c3b7d9fe');
  assert.equal(map.get('NOTION_CATEGORY_CICD_ID'), '33c3462f68a98146bf26cc0e5f5c2799');
  assert.equal(map.get('NOTION_ZONE_ARCHITECTURE_URL'), 'https://www.notion.so/33c3462f68a9819894a4df73c3b7d9fe');
  assert.equal(map.get('NOTION_ZONE_CICD_URL'), 'https://www.notion.so/33c3462f68a98146bf26cc0e5f5c2799');
});

test('no categories → no NOTION_CATEGORY_* keys', () => {
  const map = buildPlaceholderMap(fullConfig);
  assert.equal(map.has('NOTION_CATEGORY_ARCHITECTURE_ID'), false);
  assert.equal(map.has('NOTION_ZONE_ARCHITECTURE_URL'), false);
});
