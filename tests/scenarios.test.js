import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_SCENARIOS, runScenario, compareScenarioPaths } from '../public/scenarios.js';
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
test('path comparison exposes equal terminal states with different final storage', () => {
  const result = compareScenarioPaths(draft(), 'submit-success', 'receipt-recovery');
  assert.equal(result.basis, 'authored-assumption');
  assert.equal(result.sameFinalState, true); assert.equal(result.sameFinalRecords, false);
  assert.equal(result.changedFieldCount, 2);
  const changed = result.stores.flatMap(store => store.fields.filter(field => field.change !== 'same').map(field => [store.storeId, field.path]));
  assert.deepEqual(changed, [['draft-store', ['revision']], ['submission-store', ['outbox']]]);
  assert.equal(result.left.stepCount, 3); assert.equal(result.right.stepCount, 4);
  assert.match(result.limitations.join(' '), /不判断运行等价/);
});
test('same final records do not erase differing step counts or imply runtime equivalence', () => {
  const result = compareScenarioPaths(REFERENCE_SCENARIOS[1], 'dispatch-success', 'dispatch-recovery');
  assert.equal(result.sameFinalState, true); assert.equal(result.sameFinalRecords, true);
  assert.equal(result.changedFieldCount, 0); assert.notEqual(result.left.stepCount, result.right.stepCount);
  assert.equal(result.left.mutationCount, 3); assert.equal(result.right.mutationCount, 3);
  assert.match(result.limitations.join(' '), /不是数据库写入次数/);
});
test('self comparison is deterministic and does not change input or other comparison results', () => {
  const model = draft(), original = structuredClone(model);
  const result = compareScenarioPaths(model, 'receipt-timeout', 'receipt-timeout');
  assert.equal(result.sameFinalRecords, true); assert.equal(result.changedFieldCount, 0);
  assert.deepEqual(compareScenarioPaths(model, 'receipt-timeout', 'receipt-timeout'), result);
  result.stores[0].left.record.status = 'MUTATED';
  result.stores[0].left.mutations[0].value = 'MUTATED';
  assert.deepEqual(model, original);
  assert.equal(compareScenarioPaths(model, 'receipt-timeout', 'receipt-timeout').stores[0].left.record.status, 'PENDING_CONFIRMATION');
});
test('comparison preserves absent versus null and never labels absence as a null value', () => {
  const model = draft(); model.stores[0].initial.temporaryNote = null;
  const result = compareScenarioPaths(model, 'version-conflict', 'submit-success');
  const field = result.stores[0].fields.find(item => item.path[0] === 'temporaryNote');
  assert.equal(field.change, 'left-only');
  assert.deepEqual(field.left, { present: true, value: null });
  assert.deepEqual(field.right, { present: false });
});
test('nested keys compare structurally, with unambiguous key arrays and order-independent objects', () => {
  const model = draft();
  model.stores[0].initial.metadata = { 'a.b': { flag: true, count: 1 }, empty: {} };
  model.scenarios.find(path => path.id === 'version-conflict').steps[0].mutations.push({ storeId: 'draft-store', field: 'metadata', op: 'set', value: { empty: {}, 'a.b': { count: 1, flag: true } } });
  const equal = compareScenarioPaths(model, 'version-conflict', 'receipt-timeout');
  assert.ok(equal.stores[0].fields.filter(item => item.path[0] === 'metadata').every(item => item.change === 'same'));
  model.scenarios.find(path => path.id === 'version-conflict').steps[0].mutations[0].value['a.b'].count = 2;
  const changed = compareScenarioPaths(model, 'version-conflict', 'receipt-timeout');
  assert.deepEqual(changed.stores[0].fields.find(item => item.change === 'different' && item.path[0] === 'metadata').path, ['metadata', 'a.b', 'count']);
});
test('full-field comparison retains identical empty objects rather than omitting their keys', () => {
  const model = draft(); model.stores[0].initial.metadata = { empty: {} };
  const result = compareScenarioPaths(model, 'receipt-timeout', 'receipt-recovery');
  const field = result.stores[0].fields.find(item => item.path.join('/') === 'metadata/empty');
  assert.deepEqual(field, { path: ['metadata', 'empty'], change: 'same', left: { present: true, value: {} }, right: { present: true, value: {} } });
});
test('empty objects and primitive/object replacements remain visible', () => {
  const model = draft(); model.stores[0].initial.extra = {};
  model.scenarios.find(path => path.id === 'version-conflict').steps[0].mutations.push({ storeId: 'draft-store', field: 'extra', op: 'set', value: null });
  const field = compareScenarioPaths(model, 'version-conflict', 'receipt-timeout').stores[0].fields.find(item => item.path[0] === 'extra');
  assert.equal(field.change, 'different'); assert.equal(field.left.value, null); assert.deepEqual(field.right.value, {});
});
test('swapping paths reverses field sides while retaining store-scoped operation traces', () => {
  const model = draft(), a = compareScenarioPaths(model, 'version-conflict', 'submit-success'), b = compareScenarioPaths(model, 'submit-success', 'version-conflict');
  assert.equal(a.changedFieldCount, b.changedFieldCount);
  for (let i = 0; i < a.stores.length; i++) {
    assert.deepEqual(a.stores[i].left, b.stores[i].right);
    assert.deepEqual(a.stores[i].right, b.stores[i].left);
  }
  const trace = b.stores.find(store => store.storeId === 'submission-store').left.mutations;
  assert.equal(trace.length, 2); assert.ok(trace.every(m => m.storeId === 'submission-store' && m.stepId === 'write-submission' && m.stepIndex === 1));
});
test('comparison rejects invalid paths, mutations and provenance without executing text', () => {
  assert.throws(() => compareScenarioPaths(draft(), 'missing', 'submit-success'), /Unknown/);
  const invalid = draft(); invalid.basis = 'source';
  assert.throws(() => compareScenarioPaths(invalid, 'submit-success', 'receipt-recovery'), /authored/);
  const malicious = draft(); malicious.scenarios[0].steps[0].mutations[0].field = '__proto__';
  assert.throws(() => compareScenarioPaths(malicious, 'submit-success', 'receipt-recovery'), /target/);
  assert.equal({}.polluted, undefined);
});
test('public catalog is deeply frozen and returned reference copies are independent', () => {
  assert.throws(() => { REFERENCE_SCENARIOS[0].stores[0].initial.status = 'CHANGED'; }, TypeError);
  const copies = referenceScenarios(); copies[0].stores[0].initial.status = 'CHANGED';
  assert.equal(REFERENCE_SCENARIOS[0].stores[0].initial.status, 'EDITABLE');
});
