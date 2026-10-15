import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../src/analyzer.js';
import { prepareExport, assertSharedModel, manifestFor } from '../src/sharing.js';
import { standalone, exportProject } from '../src/export.js';
import { qualitySummary, reviewAdvice } from '../public/quality.js';
import { verifyEvidence } from '../src/evidence.js';
const SENTINEL = 'PRIVATE_SOURCE_SENTINEL_625184';
const code = `interface Input { name: string; detail: "${SENTINEL}"; }\nexport function entry(input: Input) {\n  // ${SENTINEL}\n  const value = { name: input.name, location: "/Users/private/work/project", db: "jdbc:postgresql://host/private", token: "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };\n  if (input.name === "${SENTINEL}") { external.save(value); }\n  return value;\n}`;
const fixture = () => analyze([{ name: 'src/example.ts', content: code }], { name: SENTINEL });

test('quality counts are computed from graph, not self-reported coverage', () => {
  const model = fixture(); model.report.unresolvedCalls = 0; model.report.sourceStepsWithEvidence = 1000;
  const q = qualitySummary(model);
  assert.equal(q.staticMatches, 0); assert.equal(q.unknownRelations, 1); assert.equal(q.evidencedSteps, 1); assert.equal(q.confirmedNodes, 0);
  assert.match(reviewAdvice(q), /不适合作为完整/);
});
test('default review payload removes source across every source-bearing field', () => {
  const model = fixture(), original = JSON.stringify(model);
  model.diagnostics.push({ severity: 'warning', code: 'PRIVATE', message: SENTINEL + ' /home/private/repo' });
  const shared = prepareExport(model);
  const json = JSON.stringify(shared);
  for (const value of [SENTINEL, '/Users/private', '/home/private', 'jdbc:', 'ghp_']) assert.ok(!json.includes(value), value);
  assert.ok(shared.evidence.length); assert.ok(shared.evidence.every(e => !Object.hasOwn(e, 'excerpt')));
  assert.equal(shared.sourceSnapshot.files[0].name, 'src/example.ts');
  assert.ok(shared.steps.every(s => !s.transforms.length && !s.guards.length));
  assert.ok(JSON.stringify(model).includes(SENTINEL)); assert.ok(original.includes(SENTINEL));
  assertSharedModel(shared);
});
test('business payload removes file names, lines and all source fingerprints', () => {
  const model = fixture(), shared = prepareExport(model, 'business'), json = JSON.stringify(shared);
  for (const value of ['src/example.ts', model.sourceSnapshot.id, model.evidence[0].excerptHash, SENTINEL]) assert.ok(!json.includes(value));
  assert.equal(shared.sourceSnapshot, null); assert.equal(shared.evidence.length, 0);
  assert.equal(shared.steps[0].parameters[0].name, 'input');
  assert.equal(shared.contracts[0].fields[0].name, 'name'); assertSharedModel(shared);
});
test('internal payload preserves evidence and projections but does not mutate original', () => {
  const model = fixture(), result = prepareExport(model, 'internal');
  assert.deepEqual(result, model); result.steps[0].label = 'changed'; assert.notEqual(result.steps[0].label, model.steps[0].label);
});
test('schema rejects added source fields, expressions and business metadata', () => {
  for (const mutate of [m => { m.evidence[0].excerpt = SENTINEL; }, m => { m.steps[0].transforms = fixture().steps[0].transforms; }, m => { m.project.extra = SENTINEL; }]) {
    const model = prepareExport(fixture()); mutate(model); assert.throws(() => assertSharedModel(model));
  }
  const business = prepareExport(fixture(), 'business'); business.steps[0].file = 'secret.ts'; assert.throws(() => assertSharedModel(business), /Business export/);
});
test('exported shared data cannot be passed off as original internal analysis', () => {
  assert.throws(() => prepareExport(prepareExport(fixture()), 'internal'), /validation failed/);
  assert.throws(() => manifestFor('full-source'), /mode/);
});
test('IDs and unsafe display strings are reconstructed rather than leaked', () => {
  const model = fixture();
  const old = model.entities[0].id; model.entities[0].id = SENTINEL;
  model.steps[0].entityId = SENTINEL;
  for (const flow of model.flows) if (flow.from === old) flow.from = SENTINEL;
  model.entities[0].label = '/tmp/private/file';
  const json = JSON.stringify(prepareExport(model)); assert.ok(!json.includes(SENTINEL)); assert.ok(!json.includes('/tmp/private'));
});
test('each safe CLI output file is source-free, including report and embedded HTML JSON', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'studio-safe-'));
  try {
    const java = analyze([{ name: 'Demo.java', content: `public class Demo { public String submit(String input) { /* ${SENTINEL} /Users/private/project */ if (input == null) { throw new IllegalArgumentException("${SENTINEL}"); } return input; } }` }]);
    for (const [language, model] of [['typescript', fixture()], ['java', java]]) for (const mode of ['review', 'business']) {
      const folder = path.join(temp, `${language}-${mode}`); await exportProject(model, folder, { mode });
      assert.deepEqual((await readdir(folder)).sort(), ['analysis.json', 'index.html', 'manifest.json', 'report.json']);
      for (const file of await readdir(folder)) {
        const text = await readFile(path.join(folder, file), 'utf8');
        for (const value of [SENTINEL, '/Users/private', 'jdbc:postgresql://host/private', 'ghp_aaaaaaaa']) assert.ok(!text.includes(value), `${mode}/${file}: ${value}`);
      }
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('internal CLI export requires acknowledgement; nonempty folders are never downgraded in place', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'studio-mixed-'));
  try {
    await assert.rejects(exportProject(fixture(), temp, { mode: 'internal' }), /acknowledge/);
    await writeFile(path.join(temp, 'old-source.json'), SENTINEL);
    await assert.rejects(exportProject(fixture(), temp), /must be empty/);
    assert.equal(await readFile(path.join(temp, 'old-source.json'), 'utf8'), SENTINEL);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('concurrent exports cannot mix internal and review files in one output directory', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'studio-concurrent-'));
  try {
    const results = await Promise.allSettled([exportProject(fixture(), temp), exportProject(fixture(), temp, { mode: 'internal', acknowledgeRisk: true })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    const model = JSON.parse(await readFile(path.join(temp, 'analysis.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(temp, 'manifest.json'), 'utf8'));
    const html = await readFile(path.join(temp, 'index.html'), 'utf8');
    assert.equal(manifest.mode, model.sharing?.mode || 'internal');
    assert.equal(html.includes(SENTINEL), manifest.mode === 'internal');
    assert.ok(!(await readdir(temp)).includes('.export.lock'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('both safe standalone formats embed share schema and no source; internal still escapes HTML', async () => {
  for (const mode of ['review', 'business']) {
    const html = await standalone(fixture(), { mode }); assert.match(html, /share-1.0.0/); assert.ok(!html.includes(SENTINEL));
  }
  const model = analyze([{ name: 'x.ts', content: 'export function x() { return "</script>"; }' }]);
  assert.match(await standalone(model, { mode: 'internal' }), /\\u003c\/script/);
});
test('review metadata remains locally verifiable; business refuses false verification', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'studio-share-evidence-'));
  try {
    const model = analyze([{ name: 'a.ts', content: 'export function a() { return 1; }' }]);
    await writeFile(path.join(temp, 'a.ts'), 'export function a() { return 1; }');
    assert.equal((await verifyEvidence(prepareExport(model), temp)).valid, true);
    await assert.rejects(verifyEvidence(prepareExport(model, 'business'), temp), /no evidence/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
