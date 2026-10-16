import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_SCENARIOS, runScenario } from '../public/scenarios.js';
import { assertScenario, referenceScenarios } from '../src/scenarios.js';

const draft = () => structuredClone(REFERENCE_SCENARIOS[0]);
const last = list => list.at(-1);
test('two independent reference cases validate and cover four path kinds', () => {
  for (const model of referenceScenarios()) {
    assertScenario(model);
    assert.deepEqual(new Set(model.scenarios.map(path => path.kind)), new Set(['success', 'rejected', 'failure', 'recovery']));
    for (const path of model.scenarios) assert.ok(runScenario(model, path.id).length);
  }
});
test('successful submission increments revision, preserves prior snapshots and unsets temporary field', () => {
  const model = draft(), original = structuredClone(model);
  const frames = runScenario(model, 'submit-success');
  assert.equal(last(frames).toState, 'submitted');
  assert.equal(last(frames).after['draft-store'].revision, 4);
  assert.equal(Object.hasOwn(last(frames).after['draft-store'], 'temporaryNote'), false);
  assert.equal(frames[0].before['draft-store'].status, 'EDITABLE');
  assert.equal(frames[0].after['submission-store'].submission, null);
  assert.deepEqual(model, original);
  assert.deepEqual(runScenario(model, 'submit-success'), frames);
});
test('version conflict produces a terminal refusal without writing storage', () => {
  const frame = last(runScenario(draft(), 'version-conflict'));
  assert.equal(frame.toState, 'rejected');
  assert.deepEqual(frame.before, frame.after);
  assert.deepEqual(frame.mutations, []);
});
test('receipt timeout retains both a committed synthetic record and uncertainty, not invented rollback', () => {
  const frame = last(runScenario(draft(), 'receipt-timeout'));
  assert.equal(frame.toState, 'pending');
  assert.equal(frame.after['draft-store'].status, 'PENDING_CONFIRMATION');
  assert.equal(frame.after['submission-store'].submission, 'synthetic-submission');
});
test('recovery confirms an existing submission without duplicate business mutations', () => {
  const frames = runScenario(draft(), 'receipt-recovery');
  assert.equal(last(frames).toState, 'submitted');
  assert.equal(frames.flatMap(frame => frame.mutations).filter(m => m.storeId === 'submission-store').length, 1);
});
test('independent order case reuses the same runner and preserves the event key during retry', () => {
  const frames = runScenario(REFERENCE_SCENARIOS[1], 'dispatch-recovery');
  assert.equal(last(frames).toState, 'delivered');
  assert.equal(last(frames).after['order-store'].event, frames[0].after['order-store'].event);
});
test('invalid state order and terminal-state outgoing transitions are rejected', () => {
  const model = draft(); model.scenarios[0].steps[0].transitionId = 'complete';
  assert.throws(() => assertScenario(model), /Illegal/);
  const terminal = draft(); terminal.transitions.push({ id: 'illegal', from: 'submitted', to: 'editable', condition: 'not allowed' });
  assert.throws(() => assertScenario(terminal), /terminal/);
});
test('cross-store atomicity cannot be claimed by an authored reference', () => {
  const model = draft(); model.transactionRegions[0].atomicity = 'atomic';
  assert.throws(() => assertScenario(model), /schema/);
  for (const item of referenceScenarios()) assert.ok(item.transactionRegions.every(region => region.atomicity === 'unverified'));
});
test('duplicate identifiers, broken store references and unrecorded provenance are rejected', () => {
  const duplicate = draft(); duplicate.states.push(duplicate.states[0]);
  assert.throws(() => assertScenario(duplicate), /duplicate/);
  const missing = draft(); missing.transactionRegions[0].storeIds.push('missing');
  assert.throws(() => assertScenario(missing), /Transaction/);
  const provenance = draft(); provenance.assumptions[0].revision = 0;
  assert.throws(() => assertScenario(provenance), /schema/);
});
test('unsupported mutation, unknown targets and nonnumeric increment are rejected', () => {
  const invalid = draft(); invalid.scenarios[0].steps[0].mutations[0].op = 'execute';
  assert.throws(() => assertScenario(invalid), /schema/);
  const target = draft(); target.scenarios[0].steps[0].mutations[0].storeId = 'unknown';
  assert.throws(() => assertScenario(target), /target/);
  const increment = draft(); increment.stores[0].initial.revision = 'three';
  assert.throws(() => assertScenario(increment), /finite numbers/);
});
test('prototype fields and excessively deep data are rejected without polluting globals', () => {
  const model = draft(); model.scenarios[0].steps[0].mutations[0].field = '__proto__';
  assert.throws(() => assertScenario(model), /target/);
  const nested = draft(); nested.stores[0].initial = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => assertScenario(nested), /Unsafe/);
  assert.equal({}.polluted, undefined);
  const deep = draft(); let record = deep.stores[0].initial;
  for (let i = 0; i < 15; i++) record = record.child = {};
  assert.throws(() => assertScenario(deep), /deep/);
});
test('unknown fields, missing mutation values and unknown paths do not silently succeed', () => {
  const extra = draft(); extra.sourceProven = true;
  assert.throws(() => assertScenario(extra), /schema/);
  const value = draft(); delete value.scenarios[0].steps[0].mutations[0].value;
  assert.throws(() => assertScenario(value), /schema/);
  assert.throws(() => runScenario(draft(), 'missing'), /Unknown/);
});
test('public catalog is deeply frozen and returned reference copies are independent', () => {
  assert.throws(() => { REFERENCE_SCENARIOS[0].stores[0].initial.status = 'CHANGED'; }, TypeError);
  const copies = referenceScenarios(); copies[0].stores[0].initial.status = 'CHANGED';
  assert.equal(REFERENCE_SCENARIOS[0].stores[0].initial.status, 'EDITABLE');
});
