import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate } from '../lib/template-renderer.js';
import { ConfigError } from '../lib/errors.js';

const baseMap = new Map([
  ['PROJECT_NAME', 'TestProject'],
  ['GIT_BRANCH_PREFIX', 'feature/test'],
  ['NOTION_DATABASE_ID', 'aabbccdd-1122-3344-5566-7788aabbccdd'],
]);

test('renders known placeholder correctly', () => {
  const result = renderTemplate('Project: {{PROJECT_NAME}}', { configMap: baseMap });
  assert.equal(result, 'Project: TestProject');
});

test('UUID values are not HTML-escaped', () => {
  const result = renderTemplate('DB: {{NOTION_DATABASE_ID}}', { configMap: baseMap });
  assert.equal(result, 'DB: aabbccdd-1122-3344-5566-7788aabbccdd');
});

test('HTML-special characters in values are NOT escaped', () => {
  const map = new Map([['PROJECT_NAME', '<My & Project>']]);
  const result = renderTemplate('Name: {{PROJECT_NAME}}', { configMap: map });
  assert.equal(result, 'Name: <My & Project>');
});

test('template with no placeholders passes through unchanged', () => {
  const result = renderTemplate('No placeholders here.', { configMap: baseMap });
  assert.equal(result, 'No placeholders here.');
});

test('unknown placeholder throws ConfigError with UNKNOWN_PLACEHOLDER code', () => {
  assert.throws(
    () => renderTemplate('{{UNDEFINED_KEY}} value', { configMap: baseMap }),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 'UNKNOWN_PLACEHOLDER');
      assert.ok(err.message.includes('UNDEFINED_KEY'));
      return true;
    }
  );
});

test('triple-stache {{{KEY}}} also resolves without escaping', () => {
  const map = new Map([['PROJECT_NAME', '<bold>']]);
  const result = renderTemplate('{{{PROJECT_NAME}}}', { configMap: map });
  assert.equal(result, '<bold>');
});

test('multiple placeholders all rendered', () => {
  const result = renderTemplate(
    'Branch: {{GIT_BRANCH_PREFIX}} for {{PROJECT_NAME}}',
    { configMap: baseMap }
  );
  assert.equal(result, 'Branch: feature/test for TestProject');
});
