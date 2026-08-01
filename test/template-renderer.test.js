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

// ─────────────────────────────────────────────────────────────────────────────
// Regression: syntaxes the Mustache renderer silently destroyed.
//
// renderTemplate used Mustache with a custom `escapedValue` hook, which only
// intercepts interpolation. Sections, partials, comments and triple-stache
// routed around it and rendered as `$` or as nothing at all. No shipped artifact
// contained one, so the damage was latent — these cases pin it shut.
// ─────────────────────────────────────────────────────────────────────────────

const preserved = [
  ['${{{ runner.os }}}', 'a GitHub Actions expression in triple braces (was: "$")'],
  ['{{#SECTION}}body{{/SECTION}}', 'a Mustache section (was: "")'],
  ['{{^SECTION}}body{{/SECTION}}', 'a Mustache inverted section'],
  ['{{>partial}}', 'a Mustache partial (was: "")'],
  ['{{! a comment }}', 'a Mustache comment (was: "")'],
  ['{{lower.case}}', 'a non-UPPER_SNAKE_CASE token'],
];

for (const [source, what] of preserved) {
  test(`preserved verbatim: ${what}`, () => {
    assert.equal(renderTemplate(source, { configMap: baseMap }), source);
  });
}

test('a preserved token surrounded by real placeholders still renders the rest', () => {
  const result = renderTemplate('${{ runner.os }} builds {{PROJECT_NAME}}', { configMap: baseMap });
  assert.equal(result, '${{ runner.os }} builds TestProject');
});

test('whitespace inside the braces is tolerated', () => {
  assert.equal(renderTemplate('{{ PROJECT_NAME }}', { configMap: baseMap }), 'TestProject');
  assert.equal(renderTemplate('{{{ PROJECT_NAME }}}', { configMap: baseMap }), 'TestProject');
});

// Manifest-declared keys are optional by contract: a consumer that does not set
// one gets an empty string, not a failed install.
test('a manifest-declared placeholder missing from the config renders empty', () => {
  const result = renderTemplate('[{{OPTIONAL_KEY}}]', {
    configMap: baseMap,
    manifestPlaceholders: ['OPTIONAL_KEY'],
  });
  assert.equal(result, '[]');
});

test('nothing is written when a later token is unknown', () => {
  // Validation runs over the whole template first, so a half-rendered body can
  // never reach disk.
  assert.throws(
    () => renderTemplate('{{PROJECT_NAME}} and {{UNDEFINED_KEY}}', { configMap: baseMap }),
    /UNDEFINED_KEY/
  );
});

test('an unknown key in triple-stache is reported too', () => {
  assert.throws(() => renderTemplate('{{{UNDEFINED_KEY}}}', { configMap: baseMap }), /UNDEFINED_KEY/);
});
