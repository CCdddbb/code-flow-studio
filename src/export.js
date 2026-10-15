import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertModel } from './model.js';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export async function standalone(model) {
  assertModel(model);
  const [html, css, simulation, app] = await Promise.all(['index.html', 'style.css', 'simulation.js', 'app.js'].map(name => readFile(path.join(ROOT, 'public', name), 'utf8')));
  const bundle = `${simulation.replace(/^export /gm, '')}\n${app.replace(/^import .*?;\s*\n/, '')}`.replace(/<\/script/gi, '<\\/script');
  const json = JSON.stringify(model).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return html.replace('<link rel="stylesheet" href="./style.css">', `<style>${css}</style>`)
    .replace('<script type="module" src="./app.js"></script>', `<script id="embedded-model" type="application/json">${json}</script>\n<script>\n(function(){\n${bundle}\n})();\n</script>`);
}
export async function exportProject(model, output) {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'index.html'), await standalone(model));
  await writeFile(path.join(output, 'analysis.json'), JSON.stringify(model, null, 2) + '\n');
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ schemaVersion: model.schemaVersion, sourceSnapshot: model.sourceSnapshot.id, ...model.report, diagnostics: model.diagnostics }, null, 2) + '\n');
}
