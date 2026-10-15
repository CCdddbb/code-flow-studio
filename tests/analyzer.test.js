import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/analyzer.js';
import { validateModel } from '../src/model.js';
import { hash, scanDirectory } from '../src/safety.js';
import { sampleInput, project, mappings } from '../public/simulation.js';

const files = [{ name: 'map.ts', content: 'interface Input { name: string; amount: number; }\nexport function entry(input: Input) { return map(input); }\nfunction map(input: Input) { const value = { title: input.name, total: input.amount, state: "READY" }; return value; }' }];
test('AST extracts input contracts and resolves same-file calls', () => {
  const model = analyze(files);
  assert.equal(model.steps.length, 2); assert.equal(model.flows[0].resolution, 'static-local');
  assert.deepEqual(model.contracts[0].fields.map(f => f.name), ['name', 'amount']);
  assert.equal(validateModel(model).valid, true);
});
test('pure projection copies, renames and adds literal fields', () => {
  const model = analyze(files), step = model.steps.find(s => s.label === 'map');
  const input = sampleInput(step, model.contracts); input.input.name = 'Ada'; input.input.amount = 450;
  const result = project(step, input);
  assert.deepEqual(result.output.$return, { title: 'Ada', total: 450, state: 'READY' });
  const bindings = Object.fromEntries(step.transforms.map(t => [t.target, t.expression]));
  assert.equal(mappings(bindings.$return, '', bindings)[0].source, 'input.name');
});
test('calls are unknown values rather than fabricated successful output', () => {
  const model = analyze(files), step = model.steps[0];
  assert.ok(project(step, { input: {} }).output.$return.$unknown);
});
test('repeat generation is deterministic including IDs and evidence', () => assert.deepEqual(analyze(files), analyze(files)));
test('unique entry ID disambiguates equal names', () => {
  const input = [{ name: 'a.ts', content: 'export function run() { return 1; }' }, { name: 'b.ts', content: 'export function run() { return 2; }' }];
  assert.throws(() => analyze(input, { entry: 'run' }), /ambiguous/);
  const model = analyze(input); assert.equal(analyze(input, { entry: model.entries[1].id }).steps[0].file, 'b.ts');
});
test('relative aliased import resolves declaration, but arbitrary name matches do not', () => {
  const input = [{ name: 'a.ts', content: 'import { map as convert } from "./b.js"; export function run(x: string) { return convert(x); }' }, { name: 'b.ts', content: 'export function map(x: string) { return x; }' }];
  assert.equal(analyze(input).steps.length, 2);
  input[0].content = 'export function run(x: string) { return map(x); }';
  assert.equal(analyze(input).steps.length, 1); assert.equal(analyze(input).report.unresolvedCalls, 1);
});
test('recursive call graphs terminate and retain cycle edges', () => {
  const model = analyze([{ name: 'cycle.ts', content: 'export function a() { return b(); } function b() { return a(); }' }]);
  assert.equal(model.steps.length, 2); assert.equal(model.flows.length, 2);
});
test('mutating statements and control flow disable subsequent projections', () => {
  const model = analyze([{ name: 'mutation.ts', content: 'export function mutate(input: Input) { input.name = "changed"; return { name: input.name }; }' }]);
  assert.equal(model.steps[0].transforms.length, 0);
  const guarded = analyze([{ name: 'guard.ts', content: 'export function run(input: Input) { if (!input) { throw new Error("missing"); } return input; }' }]);
  assert.equal(guarded.steps[0].transforms.length, 0); assert.equal(guarded.steps[0].guards[0].effect, 'throw');
});
test('side-effecting initializers block subsequent copy projections', () => {
  const model = analyze([{ name: 'effect.ts', content: 'export function run(input: Input) { const sideEffect = mutate(input); return input; }' }]);
  assert.equal(model.steps[0].transforms.length, 1);
  assert.ok(!model.steps[0].transforms.some(t => t.target === '$return'));
});
test('nested functions are not resolved outside their lexical scope', () => {
  const model = analyze([{ name: 'scope.ts', content: 'export function entry() { return hidden(); } function container() { function hidden() { return 1; } return hidden(); }' }]);
  assert.equal(model.steps.length, 1);
  assert.equal(model.flows[0].resolution, 'unresolved');
  const shadowed = analyze([{ name: 'shadow.ts', content: 'function helper() { return 1; } export function entry(helper: Function) { return helper(); }' }], { entry: 'entry' });
  assert.equal(shadowed.flows[0].resolution, 'unresolved');
});
test('Java fixture resolves declared field type, not runtime injection', async () => {
  const { files: java } = await scanDirectory(fileURLToPath(new URL('../fixtures/java/', import.meta.url)));
  const model = analyze(java);
  assert.equal(model.steps.length, 2); assert.equal(model.report.functions, 2);
  assert.ok(model.flows.some(f => f.resolution === 'static-declared-reference'));
  assert.ok(model.steps.find(s => s.label === 'DraftService.submit').transaction);
  assert.ok(model.steps.every(s => !s.transforms.length));
  assert.ok(model.diagnostics.some(d => d.code === 'JAVA_LEXICAL'));
});
test('Java comments and string literals never invent call expressions', () => {
  const model = analyze([{ name: 'A.java', content: 'public class A { public String run() { // db.delete();\n String s = "repository.save()"; return s; } }' }]);
  assert.equal(model.flows.length, 0);
  const annotation = analyze([{ name: 'A.java', content: 'public class A { /* @Transactional */ public String run() { return "ok"; } }' }]);
  assert.equal(annotation.steps[0].transaction, null);
});
test('evidence hashes use original source and original line ranges', () => {
  const model = analyze(files);
  for (const ev of model.evidence) {
    assert.equal(ev.fileHash, hash(files[0].content));
    assert.equal(ev.excerptHash, hash(files[0].content.split('\n').slice(ev.startLine - 1, ev.endLine).join('\n')));
  }
});
test('redaction also protects generated expressions, not just evidence excerpts', () => {
  const secret = 'do-not-publish-this-value';
  const model = analyze([{ name: 'secret-demo.ts', content: `export function run() { const apiKey = "${secret}"; return { key: apiKey }; }` }]);
  assert.ok(!JSON.stringify(model).includes(secret));
  assert.ok(model.evidence.some(e => e.redacted));
});
test('changed source produces a different snapshot', () => assert.notEqual(analyze(files).sourceSnapshot.id, analyze([{ ...files[0], content: files[0].content + '\n// changed' }]).sourceSnapshot.id));
test('schema rejects observed mode, invalid references, executable expressions and duplicate IDs', () => {
  for (const mutate of [m => { m.dataMode = 'observed'; }, m => { m.flows[0].to = 'missing'; }, m => { m.steps[0].transforms[0].expression = { op: 'eval', code: 'process.exit()' }; }, m => { m.entities.push(m.entities[0]); }]) {
    const model = analyze(files); mutate(model); assert.equal(validateModel(model).valid, false);
  }
});
test('renderer is generic: no business-name branches or hardcoded storage tables', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(!/draft_records|flow_baoxiao|DraftSubmissionCoordinator|DraftService/.test(app));
});
test('unsupported/empty inputs fail explicitly', () => {
  assert.throws(() => analyze([]), /Upload/);
  assert.throws(() => analyze([{ name: 'a.ts', content: '// no function' }]), /No supported/);
  assert.throws(() => analyze(files, { entry: 'missing' }), /not found/);
});
