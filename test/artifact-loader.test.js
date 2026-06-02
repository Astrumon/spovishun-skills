import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadArtifacts } from '../lib/artifact-loader.js';
import { ConfigError } from '../lib/errors.js';

function makePkgRoot() {
  const root = mkdtempSync(join(tmpdir(), 'al-test-'));
  return root;
}

function makeSkill(pkgRoot, id, opts = {}) {
  const dir = join(pkgRoot, 'skills', id);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    id,
    version: opts.version ?? '1.0.0',
    category: opts.category ?? 'universal',
    description: opts.description ?? 'A test skill for unit tests.',
    ...(opts.requires ? { requires: opts.requires } : {}),
    ...(opts.placeholders ? { placeholders: opts.placeholders } : {}),
  };
  const yaml = Object.entries(manifest)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}:\n${v.map((i) => `  - ${JSON.stringify(i)}`).join('\n')}`;
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');
  writeFileSync(join(dir, 'manifest.yaml'), yaml, 'utf8');
  writeFileSync(join(dir, 'SKILL.md'), opts.body ?? `# ${id}\nStub.`, 'utf8');
}

test('loads a single universal skill', () => {
  const root = makePkgRoot();
  makeSkill(root, 'hello');
  const artifacts = loadArtifacts(root);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'skill');
  assert.equal(artifacts[0].id, 'hello');
  assert.equal(artifacts[0].version, '1.0.0');
  assert.ok(artifacts[0].bodyText.includes('hello'));
});

test('loads multiple skills from skills/ dir', () => {
  const root = makePkgRoot();
  makeSkill(root, 'alpha');
  makeSkill(root, 'beta');
  const artifacts = loadArtifacts(root);
  assert.equal(artifacts.length, 2);
  const ids = artifacts.map((a) => a.id).sort();
  assert.deepEqual(ids, ['alpha', 'beta']);
});

test('skips non-directory entries in skills/', () => {
  const root = makePkgRoot();
  mkdirSync(join(root, 'skills'), { recursive: true });
  writeFileSync(join(root, 'skills', 'not-a-dir.txt'), 'ignore me', 'utf8');
  makeSkill(root, 'real');
  const artifacts = loadArtifacts(root);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].id, 'real');
});

test('returns empty array when skills/ dir is absent', () => {
  const root = makePkgRoot();
  const artifacts = loadArtifacts(root);
  assert.equal(artifacts.length, 0);
});

test('throws ConfigError MISSING_REQUIRED when manifest.yaml is absent', () => {
  const root = makePkgRoot();
  mkdirSync(join(root, 'skills', 'broken'), { recursive: true });
  writeFileSync(join(root, 'skills', 'broken', 'SKILL.md'), 'body', 'utf8');
  assert.throws(
    () => loadArtifacts(root),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 'MISSING_REQUIRED');
      return true;
    }
  );
});

test('throws ConfigError INVALID_YAML for malformed manifest', () => {
  const root = makePkgRoot();
  mkdirSync(join(root, 'skills', 'broken'), { recursive: true });
  writeFileSync(join(root, 'skills', 'broken', 'manifest.yaml'), ': bad: yaml: :', 'utf8');
  writeFileSync(join(root, 'skills', 'broken', 'SKILL.md'), 'body', 'utf8');
  assert.throws(
    () => loadArtifacts(root),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 'INVALID_YAML');
      return true;
    }
  );
});

test('throws ConfigError SCHEMA_VIOLATION when manifest id mismatches dir name', () => {
  const root = makePkgRoot();
  const dir = join(root, 'skills', 'my-skill');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manifest.yaml'),
    'id: wrong-id\nversion: "1.0.0"\ncategory: universal\ndescription: "Long enough description here."',
    'utf8'
  );
  writeFileSync(join(dir, 'SKILL.md'), 'body', 'utf8');
  assert.throws(
    () => loadArtifacts(root),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 'SCHEMA_VIOLATION');
      assert.ok(err.message.includes('wrong-id'));
      return true;
    }
  );
});

test('throws ConfigError MISSING_REQUIRED when SKILL.md is absent', () => {
  const root = makePkgRoot();
  const dir = join(root, 'skills', 'no-body');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manifest.yaml'),
    'id: no-body\nversion: "1.0.0"\ncategory: universal\ndescription: "Long enough description here."',
    'utf8'
  );
  assert.throws(
    () => loadArtifacts(root),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.equal(err.code, 'MISSING_REQUIRED');
      return true;
    }
  );
});

test('manifest object is attached to the artifact', () => {
  const root = makePkgRoot();
  makeSkill(root, 'with-requires', { category: 'stack-specific', requires: ['notion'] });
  const artifacts = loadArtifacts(root);
  assert.equal(artifacts[0].manifest.category, 'stack-specific');
  assert.deepEqual(artifacts[0].manifest.requires, ['notion']);
});

test('artifact carries artifactDir and supporting files', () => {
  const root = makePkgRoot();
  const skillDir = join(root, 'skills', 'multi');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'manifest.yaml'),
    'id: multi\nversion: "1.0.0"\ncategory: universal\ndescription: "Multi-file test fixture."\n',
    'utf8'
  );
  writeFileSync(join(skillDir, 'SKILL.md'), '# main', 'utf8');
  mkdirSync(join(skillDir, 'references'), { recursive: true });
  writeFileSync(join(skillDir, 'references', 'note.md'), '# note', 'utf8');
  mkdirSync(join(skillDir, 'assets'), { recursive: true });
  writeFileSync(join(skillDir, 'assets', 'pic.bin'), Buffer.from([1, 2, 3, 4]));

  const artifacts = loadArtifacts(root);
  const skill = artifacts.find((a) => a.id === 'multi');
  assert.equal(skill.artifactDir, skillDir);
  assert.equal(skill.files.length, 2);
  const note = skill.files.find((f) => f.relPath === 'references/note.md');
  assert.equal(note.encoding, 'utf8');
  assert.ok(note.contents.includes('# note'));
  const pic = skill.files.find((f) => f.relPath === 'assets/pic.bin');
  assert.equal(pic.encoding, 'base64');
  assert.equal(pic.contents, Buffer.from([1, 2, 3, 4]).toString('base64'));
});

test('loads template kind from templates/ directory', () => {
  const root = makePkgRoot();
  const tmplDir = join(root, 'templates', 'sample');
  mkdirSync(tmplDir, { recursive: true });
  writeFileSync(
    join(tmplDir, 'manifest.yaml'),
    'id: sample\nversion: "1.0.0"\ncategory: universal\ndescription: "Sample template fixture."\n',
    'utf8'
  );
  writeFileSync(join(tmplDir, 'TEMPLATE.md'), '# Sample template\n{{PROJECT_NAME}}', 'utf8');
  const artifacts = loadArtifacts(root);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'template');
  assert.equal(artifacts[0].id, 'sample');
  assert.ok(artifacts[0].bodyText.includes('Sample template'));
});
