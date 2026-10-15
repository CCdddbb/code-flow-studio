import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeName, validateFiles, scanDirectory, redact } from '../src/safety.js';
import { evaluate, differences, sampleInput, sampleValue, project } from '../public/simulation.js';

test('source paths reject traversal, absolute paths, hidden/config files and unsupported formats', () => {
  for (const name of ['../x.ts', '/tmp/x.ts', 'C:/x.ts', 'a\\b.ts', '.env', '.git/a.ts', 'a/../b.ts', 'a//b.ts', 'config.yaml', 'credentials.ts']) assert.throws(() => safeName(name));
  assert.equal(safeName('src/业务.ts'), 'src/业务.ts');
});
test('input has byte, duplicate and binary limits', () => {
  assert.throws(() => validateFiles([{ name: 'a.ts', content: 'x'.repeat(200001) }]), /large/);
  assert.throws(() => validateFiles([{ name: 'a.ts', content: '\0' }]), /binary/);
  assert.throws(() => validateFiles([{ name: 'a.ts', content: '' }, { name: 'a.ts', content: '' }]), /Duplicate/);
  assert.throws(() => validateFiles(Array.from({ length: 121 }, (_, i) => ({ name: `${i}.ts`, content: '' }))), /Upload/);
});
test('scanner skips symlinks and generated directories, leaving source unchanged', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'flow-safe-'));
  try {
    await writeFile(path.join(dir, 'a.ts'), 'export function run() { return 1; }');
    await mkdir(path.join(dir, 'node_modules')); await writeFile(path.join(dir, 'node_modules', 'b.ts'), 'excluded');
    await symlink(path.join(dir, 'a.ts'), path.join(dir, 'linked.ts'));
    const result = await scanDirectory(dir); assert.deepEqual(result.files.map(f => f.name), ['a.ts']); assert.equal(result.skipped.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('redaction covers assignment secrets, tokens, connections and private key line counts', () => {
  assert.ok(!redact('const password = "do-not-show";').includes('do-not-show'));
  assert.ok(!redact('mongodb://user:pass@host/db').includes('user:pass'));
  assert.ok(!redact('ghp_' + 'a'.repeat(30)).includes('a'.repeat(30)));
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nabc\ndef\n-----END RSA PRIVATE KEY-----';
  assert.equal(redact(pem).split('\n').length, pem.split('\n').length);
});
test('pure evaluator does not execute unknown operations or access prototypes', () => {
  assert.ok(evaluate({ op: 'eval', code: 'globalThis.pwned=true' }, {}).$unknown);
  assert.equal(globalThis.pwned, undefined);
  assert.ok(evaluate({ op: 'ref', path: ['x', 'constructor'] }, { x: {} }).$unknown);
  assert.ok(evaluate({ op: 'object', fields: [{ key: '__proto__', expression: { op: 'literal', value: 'x' } }] }, {}).$unknown);
  assert.equal({}.polluted, undefined);
});
test('missing inputs remain unknown, arrays compare as a whole and JSON pointer escapes are correct', () => {
  assert.ok(evaluate({ op: 'ref', path: ['input', 'missing'] }, { input: {} }).$unknown);
  assert.deepEqual(differences({ a: [1] }, { a: [2] }), [{ path: '/a', kind: 'changed', before: [1], after: [2] }]);
  assert.equal(differences({ 'a/b~c': 1 }, { 'a/b~c': 2 })[0].path, '/a~1b~0c');
});
test('sample generation bounds recursive contracts and projection rejects non-object inputs', () => {
  assert.ok(sampleValue('Node', [{ name: 'Node', fields: [{ name: 'next', type: 'Node' }] }]).next.$unknown);
  assert.throws(() => project({ transforms: [] }, []), /JSON/);
  assert.deepEqual(sampleInput({ parameters: [{ name: '__proto__', type: 'string' }] }, []), {});
});
