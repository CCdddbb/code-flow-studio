#!/usr/bin/env node
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { scanDirectory } from './safety.js';
import { analyze } from './analyzer.js';
import { exportProject } from './export.js';

async function main(args) {
  if (!args.length || args.includes('--help')) {
    console.log('Usage: npm run analyze -- <source-directory> [--entry <symbol-or-id>] [--out <directory>] [--name <title>]\nExample: npm run analyze -- fixtures/typescript --out artifacts/order'); return;
  }
  const source = args[0], options = {};
  for (let i = 1; i < args.length; i += 2) {
    if (!['--entry', '--out', '--name'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${args[i]}`);
    options[args[i].slice(2)] = args[i + 1];
  }
  const root = await realpath(source), output = path.resolve(options.out || 'artifacts/visualization');
  if (output === root || output.startsWith(root + path.sep)) throw new Error('Output must be outside the source directory; input is read-only');
  // Check the nearest existing output ancestor to prevent symlink redirection into source.
  let ancestor = output;
  while (true) {
    try {
      const actual = await realpath(ancestor);
      if (actual === root || actual.startsWith(root + path.sep)) throw new Error('Output resolves into the read-only source directory');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent;
    }
  }
  const { files, skipped } = await scanDirectory(root);
  const model = analyze(files, { name: options.name || path.basename(root), entry: options.entry });
  model.diagnostics.push(...skipped.map(message => ({ code: 'SKIPPED_FILE', severity: 'info', message })));
  await exportProject(model, output);
  console.log(`Generated: ${output}/index.html\nFiles: ${model.report.files} · Functions: ${model.report.functions} · Outline: ${model.steps.length} · Unresolved calls: ${model.report.unresolvedCalls}\nMock projections only. Review source excerpts before sharing.`);
}
main(process.argv.slice(2)).catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
