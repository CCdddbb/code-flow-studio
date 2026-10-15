import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { analyze } from '../src/analyzer.js';
import { verifyEvidence } from '../src/evidence.js';
import { validateModel } from '../src/model.js';

test('evidence verification differentiates valid, stale and missing without rewriting the model', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'flow-evidence-'));
  const files = [{ name: 'a.ts', content: 'export function run() { return 1; }' }];
  const model = analyze(files), before = JSON.stringify(model);
  try {
    await writeFile(path.join(temp, 'a.ts'), files[0].content);
    assert.equal((await verifyEvidence(model, temp)).valid, true);
    await writeFile(path.join(temp, 'a.ts'), files[0].content.replace('1', '2'));
    assert.equal((await verifyEvidence(model, temp)).files[0].status, 'stale');
    await rm(path.join(temp, 'a.ts'));
    assert.equal((await verifyEvidence(model, temp)).files[0].status, 'missing');
    assert.equal(JSON.stringify(model), before);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('validation checks source paths, snapshot fingerprints and ranges', () => {
  const model = analyze([{ name: 'a.ts', content: 'export function run() { return 1; }' }]);
  const badHash = structuredClone(model); badHash.evidence[0].fileHash = 'a'.repeat(64); assert.equal(validateModel(badHash).valid, false);
  const badPath = structuredClone(model); badPath.sourceSnapshot.files[0].name = '../x.ts'; assert.equal(validateModel(badPath).valid, false);
});
