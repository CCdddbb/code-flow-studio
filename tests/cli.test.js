import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const exec = promisify(execFile);
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/typescript', import.meta.url));
test('CLI generates standalone HTML, analysis and report outside read-only source', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'flow-cli-'));
  try {
    const { stdout } = await exec(process.execPath, [cli, fixture, '--out', temp, '--entry', 'toEnvelope']);
    assert.match(stdout, /Generated/);
    assert.match(await readFile(path.join(temp, 'index.html'), 'utf8'), /embedded-model/);
    assert.equal(JSON.parse(await readFile(path.join(temp, 'analysis.json'), 'utf8')).steps[0].label, 'toEnvelope');
    assert.equal(JSON.parse(await readFile(path.join(temp, 'report.json'), 'utf8')).outlinedFunctions, 1);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('CLI prevents output inside source, including symlinked output ancestors', async () => {
  await assert.rejects(exec(process.execPath, [cli, fixture, '--out', path.join(fixture, 'generated')]), /read-only/);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'flow-cli-link-'));
  try {
    await symlink(fixture, path.join(temp, 'redirect'));
    await assert.rejects(exec(process.execPath, [cli, fixture, '--out', path.join(temp, 'redirect', 'generated')]), /read-only/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('CLI help and unknown option behavior', async () => {
  assert.match((await exec(process.execPath, [cli, '--help'])).stdout, /Usage/);
  await assert.rejects(exec(process.execPath, [cli, fixture, '--oops', 'x']), /Invalid option/);
});
