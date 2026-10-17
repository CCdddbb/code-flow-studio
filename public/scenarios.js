// Public synthetic reference scenarios. Never extracted from uploaded source.
const scenarioBasis = 'authored-assumption';
const scenarioKinds = new Set(['success', 'rejected', 'failure', 'recovery']);
const unsafeScenarioKeys = new Set(['__proto__', 'prototype', 'constructor']);
function scenarioRecord(value, depth = 0) {
  if (depth > 12) throw new Error('Scenario record too deep');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Scenario records must use plain JSON values and objects');
  for (const [key, child] of Object.entries(value)) {
    if (unsafeScenarioKeys.has(key)) throw new Error('Unsafe scenario field');
    scenarioRecord(child, depth + 1);
  }
}
function scenarioUnique(items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id)) throw new Error(`Invalid or duplicate ${label} id`);
    ids.add(item.id);
  }
  return ids;
}
export function validateScenario(scenario) {
  if (!scenario || scenario.schemaVersion !== 'scenario-1.0.0' || scenario.basis !== scenarioBasis || !scenario.assumptions?.length) throw new Error('An authored scenario with explicit assumptions is required');
  for (const key of ['states', 'stores', 'transitions', 'scenarios', 'transactionRegions', 'assumptions']) if (!Array.isArray(scenario[key]) || scenario[key].length > 100) throw new Error(`Invalid scenario collection: ${key}`);
  const states = scenarioUnique(scenario.states, 'state'), stores = scenarioUnique(scenario.stores, 'store');
  scenarioUnique(scenario.transitions, 'transition'); scenarioUnique(scenario.scenarios, 'path'); scenarioUnique(scenario.assumptions, 'assumption'); scenarioUnique(scenario.transactionRegions, 'transaction');
  if (!states.has(scenario.initialState)) throw new Error('Unknown initial state');
  for (const item of scenario.assumptions) if (item.basis !== scenarioBasis || !Number.isInteger(item.revision) || item.revision < 1 || typeof item.author !== 'string' || !item.author.trim() || typeof item.statement !== 'string' || !item.statement.trim()) throw new Error('Assumptions require authors and revisions');
  for (const store of scenario.stores) scenarioRecord(store.initial);
  for (const transition of scenario.transitions) if (!states.has(transition.from) || !states.has(transition.to) || scenario.states.find(s => s.id === transition.from).terminal || typeof transition.condition !== 'string' || !transition.condition.trim()) throw new Error('Invalid or terminal-state transition');
  for (const region of scenario.transactionRegions) {
    if (!region.storeIds.length || new Set(region.storeIds).size !== region.storeIds.length || region.storeIds.some(id => !stores.has(id)) || region.atomicity !== 'unverified') throw new Error('Transaction atomicity must remain unverified');
  }
  for (const path of scenario.scenarios) {
    if (!scenarioKinds.has(path.kind) || !Array.isArray(path.steps) || !path.steps.length || path.steps.length > 100) throw new Error('Invalid scenario path');
    scenarioUnique(path.steps, 'scenario step');
    let state = scenario.initialState;
    const records = Object.fromEntries(scenario.stores.map(store => [store.id, structuredClone(store.initial)]));
    for (const step of path.steps) {
      if (step.basis !== scenarioBasis || typeof step.label !== 'string' || !Array.isArray(step.mutations) || step.mutations.length > 100) throw new Error('Invalid scenario step');
      if (step.transitionId !== null) {
        const transition = scenario.transitions.find(t => t.id === step.transitionId);
        if (!transition || transition.from !== state) throw new Error('Illegal scenario state transition');
        state = transition.to;
      }
      for (const mutation of step.mutations) applyScenarioMutation(records, mutation);
    }
  }
  return scenario;
}
function applyScenarioMutation(records, mutation) {
  if (!Object.hasOwn(records, mutation.storeId) || typeof mutation.field !== 'string' || !mutation.field || mutation.field.length > 100 || unsafeScenarioKeys.has(mutation.field)) throw new Error('Invalid scenario mutation target');
  const record = records[mutation.storeId];
  if (mutation.op === 'set') { scenarioRecord(mutation.value); record[mutation.field] = structuredClone(mutation.value); }
  else if (mutation.op === 'unset') delete record[mutation.field];
  else if (mutation.op === 'increment') {
    if (typeof record[mutation.field] !== 'number' || typeof mutation.value !== 'number' || !Number.isFinite(record[mutation.field] + mutation.value)) throw new Error('Increment requires finite numbers');
    record[mutation.field] += mutation.value;
  } else throw new Error('Unsupported scenario mutation');
}
export function runScenario(scenario, pathId) {
  validateScenario(scenario);
  const path = scenario.scenarios.find(item => item.id === pathId);
  if (!path) throw new Error('Unknown scenario path');
  let state = scenario.initialState;
  const records = Object.fromEntries(scenario.stores.map(store => [store.id, structuredClone(store.initial)]));
  return path.steps.map(step => {
    const before = structuredClone(records), fromState = state;
    const transition = scenario.transitions.find(t => t.id === step.transitionId);
    if (transition) state = transition.to;
    for (const mutation of step.mutations) applyScenarioMutation(records, mutation);
    return { id: step.id, label: step.label, basis: step.basis, fromState, toState: state, condition: transition?.condition ?? '无状态迁移', before, after: structuredClone(records), mutations: structuredClone(step.mutations) };
  });
}
// Compare authored final snapshots, not runtime equivalence or real database writes.
export function compareScenarioPaths(scenario, leftPathId, rightPathId) {
  const leftFrames = runScenario(scenario, leftPathId), rightFrames = runScenario(scenario, rightPathId);
  const endpoint = (id, frames) => {
    const path = scenario.scenarios.find(item => item.id === id), final = frames.at(-1);
    return { pathId: id, label: path.label, kind: path.kind, finalState: final.toState, stepCount: frames.length, mutationCount: frames.reduce((sum, frame) => sum + frame.mutations.length, 0) };
  };
  const left = endpoint(leftPathId, leftFrames), right = endpoint(rightPathId, rightFrames);
  const compareFields = (a, b, leftPresent = true, rightPresent = true, path = []) => {
    const object = value => value !== null && typeof value === 'object';
    if (leftPresent && rightPresent && object(a) && object(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      if (!keys.length) return [{ path, change: 'same', left: { present: true, value: structuredClone(a) }, right: { present: true, value: structuredClone(b) } }];
      return keys.flatMap(key => compareFields(a[key], b[key], Object.hasOwn(a, key), Object.hasOwn(b, key), [...path, key]));
    }
    const change = !leftPresent ? 'right-only' : !rightPresent ? 'left-only' : a === b ? 'same' : 'different';
    return [{ path, change, left: leftPresent ? { present: true, value: structuredClone(a) } : { present: false }, right: rightPresent ? { present: true, value: structuredClone(b) } : { present: false } }];
  };
  const trace = (frames, storeId) => frames.flatMap((frame, stepIndex) => frame.mutations.filter(mutation => mutation.storeId === storeId).map(mutation => ({ stepId: frame.id, stepIndex, label: frame.label, ...structuredClone(mutation) })));
  const stores = scenario.stores.map(store => {
    const a = leftFrames.at(-1).after[store.id], b = rightFrames.at(-1).after[store.id];
    const fields = compareFields(a, b), leftMutations = trace(leftFrames, store.id), rightMutations = trace(rightFrames, store.id);
    return { storeId: store.id, label: store.label, sameFinalRecord: fields.every(field => field.change === 'same'), fields, left: { record: structuredClone(a), mutations: leftMutations }, right: { record: structuredClone(b), mutations: rightMutations } };
  });
  return { basis: scenarioBasis, scenarioId: scenario.id, left, right, sameFinalState: left.finalState === right.finalState, sameFinalRecords: stores.every(store => store.sameFinalRecord), changedFieldCount: stores.reduce((count, store) => count + store.fields.filter(field => field.change !== 'same').length, 0), stores, limitations: ['仅对照作者指定路径的最终状态、模拟快照和显式操作，不判断运行等价、幂等性或恢复正确性。', '操作次数不是数据库写入次数；相同终态也不代表存储一致或事务原子性。'] };
}
const scenarioSet = (storeId, field, value) => ({ storeId, field, op: 'set', value });
const scenarioStep = (id, label, transitionId = null, mutations = []) => ({ id, label, transitionId, mutations, basis: scenarioBasis });
const scenarioTransition = (id, from, to, condition) => ({ id, from, to, condition });
const scenarioPath = (id, label, kind, steps) => ({ id, label, kind, steps });
function referenceScenario(id, title, stores, transitions, paths, states, initialState, regionStores) {
  return {
    schemaVersion: 'scenario-1.0.0', id, title, basis: scenarioBasis,
    assumptions: [{ id: 'reference-assumption', basis: scenarioBasis, author: 'Code Flow Studio reference author', revision: 1, statement: '独立编写的合成参考模型；条件由场景作者指定，未求值、未关联上传源码，也未验证真实事务或恢复策略。' }],
    states: states.map(([stateId, label, terminal = false]) => ({ id: stateId, label, terminal })), initialState, stores, transitions, scenarios: paths,
    transactionRegions: [{ id: 'reference-boundary', label: '跨存储边界', storeIds: regionStores, atomicity: 'unverified' }]
  };
}
export const REFERENCE_SCENARIOS = [
  referenceScenario('draft-lifecycle', '草稿提交与恢复', [
    { id: 'draft-store', label: '草稿逻辑存储', kind: 'document', initial: { status: 'EDITABLE', revision: 3, temporaryNote: 'synthetic sample' } },
    { id: 'submission-store', label: '正式提交逻辑存储', kind: 'relational', initial: { submission: null, outbox: null } }
  ], [
    scenarioTransition('freeze', 'editable', 'frozen', '假设请求版本与 revision 匹配'),
    scenarioTransition('complete', 'frozen', 'submitted', '假设业务写入及回执均已确认'),
    scenarioTransition('conflict', 'editable', 'rejected', '假设请求版本已过期'),
    scenarioTransition('uncertain', 'frozen', 'pending', '假设业务已写入，但回执超时'),
    scenarioTransition('recover', 'pending', 'submitted', '假设恢复任务确认提交键已存在')
  ], [
    scenarioPath('submit-success', '提交成功', 'success', [
      scenarioStep('freeze-draft', '冻结草稿并递增版本', 'freeze', [scenarioSet('draft-store', 'status', 'FROZEN'), { storeId: 'draft-store', field: 'revision', op: 'increment', value: 1 }]),
      scenarioStep('write-submission', '写入正式记录与 Outbox（假设）', null, [scenarioSet('submission-store', 'submission', 'synthetic-submission'), scenarioSet('submission-store', 'outbox', 'PENDING')]),
      scenarioStep('finish-draft', '确认结果并清除临时字段', 'complete', [scenarioSet('draft-store', 'status', 'SUBMITTED'), { storeId: 'draft-store', field: 'temporaryNote', op: 'unset' }])
    ]),
    scenarioPath('version-conflict', '版本冲突', 'rejected', [scenarioStep('reject-version', '拒绝过期版本；存储不变', 'conflict')]),
    scenarioPath('receipt-timeout', '回执超时', 'failure', [
      scenarioStep('freeze-draft', '冻结草稿', 'freeze', [scenarioSet('draft-store', 'status', 'FROZEN')]),
      scenarioStep('write-submission', '业务侧已写入（合成假设）', null, [scenarioSet('submission-store', 'submission', 'synthetic-submission')]),
      scenarioStep('lose-receipt', '回执未知，不宣称回滚', 'uncertain', [scenarioSet('draft-store', 'status', 'PENDING_CONFIRMATION')])
    ]),
    scenarioPath('receipt-recovery', '超时后恢复', 'recovery', [
      scenarioStep('freeze-draft', '冻结草稿', 'freeze', [scenarioSet('draft-store', 'status', 'FROZEN')]),
      scenarioStep('write-submission', '业务侧已写入（合成假设）', null, [scenarioSet('submission-store', 'submission', 'synthetic-submission')]),
      scenarioStep('lose-receipt', '保留待确认状态', 'uncertain', [scenarioSet('draft-store', 'status', 'PENDING_CONFIRMATION')]),
      scenarioStep('confirm-existing', '按提交键核对已有记录；不重复写入', 'recover', [scenarioSet('draft-store', 'status', 'SUBMITTED'), { storeId: 'draft-store', field: 'temporaryNote', op: 'unset' }])
    ])
  ], [['editable', '可编辑'], ['frozen', '已冻结'], ['pending', '待确认'], ['submitted', '已提交', true], ['rejected', '版本拒绝', true]], 'editable', ['draft-store', 'submission-store']),
  referenceScenario('order-dispatch', '订单与消息交付', [
    { id: 'order-store', label: '订单逻辑存储', kind: 'relational', initial: { status: 'NEW', event: null } },
    { id: 'message-store', label: '消息逻辑存储', kind: 'queue', initial: { delivery: null } }
  ], [
    scenarioTransition('accept', 'new', 'accepted', '假设订单校验通过'),
    scenarioTransition('deny', 'new', 'rejected', '假设订单校验不通过'),
    scenarioTransition('deliver', 'accepted', 'delivered', '假设消息确认到达'),
    scenarioTransition('timeout', 'accepted', 'pending', '假设消息发送结果未知'),
    scenarioTransition('retry', 'pending', 'delivered', '假设消费端按事件键去重后确认')
  ], [
    scenarioPath('dispatch-success', '交付成功', 'success', [scenarioStep('save-order', '保存订单与待发送事件', 'accept', [scenarioSet('order-store', 'status', 'ACCEPTED'), scenarioSet('order-store', 'event', 'synthetic-event')]), scenarioStep('send-event', '消息获得确认', 'deliver', [scenarioSet('message-store', 'delivery', 'ACKNOWLEDGED')])]),
    scenarioPath('invalid-order', '校验拒绝', 'rejected', [scenarioStep('reject-order', '拒绝请求；不生成事件', 'deny')]),
    scenarioPath('dispatch-failure', '发送结果未知', 'failure', [scenarioStep('save-order', '保存待发送事件', 'accept', [scenarioSet('order-store', 'status', 'ACCEPTED'), scenarioSet('order-store', 'event', 'synthetic-event')]), scenarioStep('send-timeout', '超时并保留待确认事件', 'timeout')]),
    scenarioPath('dispatch-recovery', '重试交付', 'recovery', [scenarioStep('save-order', '保存待发送事件', 'accept', [scenarioSet('order-store', 'status', 'ACCEPTED'), scenarioSet('order-store', 'event', 'synthetic-event')]), scenarioStep('send-timeout', '进入待确认状态', 'timeout'), scenarioStep('retry-event', '按同一事件键重试（去重为假设）', 'retry', [scenarioSet('message-store', 'delivery', 'ACKNOWLEDGED')])])
  ], [['new', '新建'], ['accepted', '已接受'], ['pending', '待确认'], ['delivered', '已交付', true], ['rejected', '已拒绝', true]], 'new', ['order-store', 'message-store'])
];
// Keep reference definitions immutable, including in the live browser workspace.
function freezeScenario(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeScenario); Object.freeze(value); }
  return value;
}
freezeScenario(REFERENCE_SCENARIOS);
