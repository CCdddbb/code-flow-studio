import { readFile, mkdir, writeFile, readdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertModel } from './model.js';
import { prepareExport, manifestFor, assertSharedModel } from './sharing.js';
import { qualitySummary } from '../public/quality.js';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export async function renderStandalone(payload) {
  if (payload.schemaVersion === 'share-1.0.0') assertSharedModel(payload); else assertModel(payload);
  const [html, css, simulation, quality, app] = await Promise.all(['index.html', 'style.css', 'simulation.js', 'quality.js', 'app.js'].map(name => readFile(path.join(ROOT, 'public', name), 'utf8')));
  const bundle = `${simulation.replace(/^export /gm, '')}\n${quality.replace(/^export /gm, '')}\n${app.replace(/^import .*?;\s*\n/gm, '')}`.replace(/<\/script/gi, '<\\/script');
  const json = JSON.stringify(payload).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return html.replace('<link rel="stylesheet" href="./style.css">', `<style>${css}</style>`)
    .replace('<script type="module" src="./app.js"></script>', `<script id="embedded-model" type="application/json">${json}</script>\n<script>\n(function(){\n${bundle}\n})();\n</script>`);
}
export async function standalone(model, { mode = 'review' } = {}) {
  return renderStandalone(prepareExport(model, mode));
}
export async function exportProject(model, output, { mode = 'review', acknowledgeRisk = false } = {}) {
  const manifest = manifestFor(mode);
  if (mode === 'internal' && !acknowledgeRisk) throw new Error('Internal export contains source. Pass --acknowledge-risk after reviewing the manifest.');
  const payload = prepareExport(model, mode);
  const html = await renderStandalone(payload);
  await mkdir(output, { recursive: true });
  const lockPath = path.join(output, '.export.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another export is in progress (or a stale .export.lock exists); use a new output directory'); throw error; }
  try {
    // Refuse mixed-policy leftovers and serialize concurrent writers to the same directory.
    if ((await readdir(output)).some(name => name !== '.export.lock')) throw new Error('Output directory must be empty; use a new directory to avoid leaking previous exports');
    await writeFile(path.join(output, 'index.html'), html);
    await writeFile(path.join(output, 'analysis.json'), JSON.stringify(payload, null, 2) + '\n');
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ mode, quality: qualitySummary(payload), limitations: payload.report.limitations }, null, 2) + '\n');
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  } finally { await lock.close(); await unlink(lockPath); }
}
