import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../src/export.js';
let count = 0;
for (const dir of ['src', 'public', 'scripts', 'tests']) {
  for (const item of await readdir(path.join(ROOT, dir))) {
    if (!/\.(?:js|cjs)$/.test(item)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(ROOT, dir, item)], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); process.exit(1); } count++;
  }
}
for (const item of ['package.json', 'schema/analysis.schema.json', 'schema/share.schema.json']) JSON.parse(await readFile(path.join(ROOT, item), 'utf8'));
console.log(`Syntax checked: ${count} scripts + JSON schema/package`);
