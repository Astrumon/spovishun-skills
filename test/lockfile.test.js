import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load as parseYaml, CORE_SCHEMA } from 'js-yaml';
import { writeLockfile, readLockfile, LOCKFILE_NAME } from '../lib/lockfile.js';

const FIXED_DATE = new Date('2025-01-01T00:00:00.000Z');
const fixedClock = () => FIXED_DATE;

const sampleArtifacts = [
  { kind: 'skill', id: 'beta', version: '1.0.0', checksum: 'sha256:aaa' },
  { kind: 'skill', id: 'alpha', version: '2.0.0', checksum: 'sha256:bbb' },
  { kind: 'agent', id: 'my-agent', version: '1.1.0', checksum: 'sha256:ccc' },
];

function tmpPath() {
  const dir = mkdtempSync(join(tmpdir(), 'lf-test-'));
  return join(dir, LOCKFILE_NAME);
}

test('writeLockfile creates file with correct header comment', () => {
  const path = tmpPath();
  writeLockfile(path, { pluginVersion: '0.1.0', target: 'claude', artifacts: sampleArtifacts, now: fixedClock });
  const content = readFileSync(path, 'utf8');
  assert.ok(content.startsWith('# spovishun-skills.lock.yaml'));
  assert.ok(content.includes('Auto-generated'));
  assert.ok(content.includes('Commit this file'));
});

test('writeLockfile YAML contains correct top-level fields', () => {
  const path = tmpPath();
  writeLockfile(path, { pluginVersion: '0.1.0', target: 'claude', artifacts: sampleArtifacts, now: fixedClock });
  const data = parseYaml(readFileSync(path, 'utf8'), { schema: CORE_SCHEMA });
  assert.equal(data.pluginVersion, '0.1.0');
  assert.equal(data.target, 'claude');
  assert.equal(data.generatedAt, '2025-01-01T00:00:00.000Z');
});

test('artifacts are sorted by kind then id', () => {
  const path = tmpPath();
  writeLockfile(path, { pluginVersion: '0.1.0', target: 'claude', artifacts: sampleArtifacts, now: fixedClock });
  const data = parseYaml(readFileSync(path, 'utf8'), { schema: CORE_SCHEMA });
  const ids = data.artifacts.map((a) => `${a.kind}/${a.id}`);
  assert.deepEqual(ids, ['agent/my-agent', 'skill/alpha', 'skill/beta']);
});

test('readLockfile returns parsed object', () => {
  const path = tmpPath();
  writeLockfile(path, { pluginVersion: '0.1.0', target: 'claude', artifacts: sampleArtifacts, now: fixedClock });
  const data = readLockfile(path);
  assert.ok(data);
  assert.equal(data.target, 'claude');
  assert.equal(data.artifacts.length, 3);
});

test('readLockfile returns null for nonexistent file', () => {
  const result = readLockfile('/no/such/file.yaml');
  assert.equal(result, null);
});

test('LOCKFILE_NAME constant is correct', () => {
  assert.equal(LOCKFILE_NAME, 'spovishun-skills.lock.yaml');
});
