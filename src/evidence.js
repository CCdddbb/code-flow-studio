import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeName, hash } from './safety.js';
import { assertModel } from './model.js';

export async function verifyEvidence(model, directory) {
  assertModel(model);
  const root = await realpath(directory), results = [];
  for (const file of model.sourceSnapshot.files) {
    safeName(file.name);
    try {
      const resolved = await realpath(path.join(root, file.name));
      if (!resolved.startsWith(root + path.sep)) throw new Error('Source path escapes root');
      const content = await readFile(resolved, 'utf8');
      const valid = hash(content) === file.hash;
      const evidenceValid = model.evidence.filter(e => e.file === file.name).every(e => hash(content.split('\n').slice(e.startLine - 1, e.endLine).join('\n')) === e.excerptHash);
      results.push({ file: file.name, status: valid && evidenceValid ? 'valid' : 'stale' });
    } catch (error) { results.push({ file: file.name, status: 'missing', reason: error.code === 'ENOENT' ? 'Source missing' : 'Source unreadable or outside allowed root' }); }
  }
  return { valid: results.every(r => r.status === 'valid'), files: results };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  (async () => {
    const [directory, modelFile] = process.argv.slice(2);
    if (!directory || !modelFile) throw new Error('Usage: npm run evidence -- <source-directory> <analysis.json>');
    const model = JSON.parse(await readFile(modelFile, 'utf8'));
    const report = await verifyEvidence(model, directory);
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
