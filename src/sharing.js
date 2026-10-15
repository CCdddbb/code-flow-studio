import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertModel } from './model.js';
import { redact, safeName } from './safety.js';
import { qualitySummary, EXPORT_MODES } from '../public/quality.js';

const base = JSON.parse(readFileSync(new URL('../schema/analysis.schema.json', import.meta.url), 'utf8'));
const schema = JSON.parse(readFileSync(new URL('../schema/share.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true }).addSchema(base).compile(schema);
const symbolPattern = /^[$\p{L}_][$\p{L}\p{N}_]*(?:\.[$\p{L}_][$\p{L}\p{N}_]*)*$/u;
const safeSymbol = (value, fallback) => typeof value === 'string' && value.length <= 100 && symbolPattern.test(value) && redact(value) === value ? value : fallback;
const safeType = value => ['string', 'String', 'number', 'int', 'long', 'Integer', 'Long', 'boolean', 'Boolean', 'double', 'Double', 'BigDecimal'].includes(value) ? value : safeSymbol(value, 'unknown');
const LIMITATIONS = ['静态调用不是实际执行顺序；推断和未知不代表已确认业务行为。', '分享版移除了条件、转换、字面量和原始说明，不提供数据投影重算。', '质量摘要来自原分析快照；证据正文未包含，接收者不能据此独立核验源码。'];
export function exportMode(mode = 'review') {
  if (!Object.hasOwn(EXPORT_MODES, mode)) throw new Error('Export mode must be review, business or internal');
  return mode;
}
export function manifestFor(mode = 'review') {
  mode = exportMode(mode);
  return { mode, ...EXPORT_MODES[mode], requiresConfirmation: true };
}
export function assertNoSourceLeak(model) {
  const serialized = JSON.stringify(model);
  if (redact(serialized) !== serialized || /(?:^|[\s"'(=:])(?:[A-Za-z]:[\\/]|\/(?!\/)[\w.-]+\/)/.test(serialized)) throw new Error('Share export blocked: sensitive token, connection or absolute path detected');
  // Schema and allowlist construction, not pattern matching alone, remove source-bearing fields.
  if (model.evidence.some(e => Object.hasOwn(e, 'excerpt')) || model.steps.some(s => s.transforms.length || s.guards.length) || model.diagnostics.length) throw new Error('Share export blocked: source-bearing fields remain');
}
export function assertSharedModel(model) {
  if (!validate(model)) throw new Error(`Share schema failed: ${validate.errors.map(e => `${e.instancePath} ${e.message}`).join('; ')}`);
  const entities = new Set(model.entities.map(e => e.id)), steps = new Set(model.steps.map(s => s.id)), evidence = new Set(model.evidence.map(e => e.id));
  if (entities.size !== model.entities.length || steps.size !== model.steps.length || evidence.size !== model.evidence.length || !steps.has(model.entryStepId)) throw new Error('Invalid shared IDs');
  for (const step of model.steps) if (!entities.has(step.entityId) || step.evidenceIds.some(id => !evidence.has(id))) throw new Error('Invalid shared step reference');
  for (const flow of model.flows) if (!entities.has(flow.from) || !entities.has(flow.to) || flow.evidenceId !== null && !evidence.has(flow.evidenceId)) throw new Error('Invalid shared flow reference');
  if (model.sharing.mode === 'business' && (model.sourceSnapshot !== null || model.evidence.length || model.steps.some(s => s.file !== null || s.line !== null || s.evidenceIds.length) || model.entries.some(e => e.file !== null || e.line !== null) || model.contracts.some(c => c.file !== null || c.line !== null || c.evidenceIds.length) || model.flows.some(f => f.evidenceId !== null || f.line !== null))) throw new Error('Business export must not retain source metadata');
  if (model.sharing.mode === 'review' && !model.sourceSnapshot) throw new Error('Review snapshot missing');
  if (model.quality.totalRelations !== model.flows.length || model.quality.staticMatches !== model.flows.filter(f => f.resolution !== 'unresolved').length || model.quality.unknownRelations !== model.flows.filter(f => f.resolution === 'unresolved').length || model.quality.sourceSteps !== model.steps.filter(s => s.basis === 'source').length || model.quality.inferredNodes !== model.entities.filter(e => e.basis === 'inferred').length || model.quality.confirmedNodes !== model.entities.filter(e => e.basis === 'user-confirmed').length || model.quality.evidencedSteps > model.quality.sourceSteps) throw new Error('Inconsistent share quality counts');
  for (const list of [model.entries, model.flows, model.contracts]) if (new Set(list.map(item => item.id)).size !== list.length) throw new Error('Duplicate shared IDs');
  for (const entry of model.entries) if (!steps.has(entry.id)) throw new Error('Invalid shared entry');
  for (const contract of model.contracts) if (contract.evidenceIds.some(id => !evidence.has(id))) throw new Error('Invalid shared contract evidence');
  const files = new Map((model.sourceSnapshot?.files ?? []).map(file => [file.name, file]));
  if (files.size !== (model.sourceSnapshot?.files.length ?? 0)) throw new Error('Duplicate shared source paths');
  for (const file of files.values()) safeName(file.name);
  if (model.sharing.mode === 'review') {
    for (const item of [...model.steps, ...model.entries, ...model.contracts]) if (!files.has(item.file) || item.line < 1 || item.line > files.get(item.file).lines) throw new Error('Invalid shared source location');
    for (const ev of model.evidence) if (!files.has(ev.file) || ev.fileHash !== files.get(ev.file).hash || ev.startLine < 1 || ev.endLine < ev.startLine || ev.endLine > files.get(ev.file).lines) throw new Error('Invalid shared evidence snapshot');
  }
  assertNoSourceLeak(model);
  return model;
}
export function prepareExport(model, mode = 'review') {
  mode = exportMode(mode);
  // Shared payloads cannot be submitted as originals to recover higher-disclosure exports.
  assertModel(model);
  if (mode === 'internal') return structuredClone(model);
  const review = mode === 'review';
  const ids = (items, prefix) => new Map(items.map((item, i) => [item.id, `${prefix}-${i + 1}`]));
  const entityIds = ids(model.entities, 'entity'), stepIds = ids(model.steps, 'step'), evidenceIds = ids(model.evidence, 'evidence');
  const usedNames = new Set();
  const fileNames = new Map(model.sourceSnapshot.files.map((file, i) => {
    let name = file.name.split('/').every(p => /^[\p{L}\p{N}_.-]+$/u.test(p)) && redact(file.name) === file.name ? file.name : `source-${i + 1}${path.posix.extname(file.name)}`;
    while (usedNames.has(name)) name = `shared-${name}`;
    usedNames.add(name);
    return [file.name, name];
  }));
  // Construct every object from an allowlist; no spread of user-controlled source metadata.
  const shared = {
    schemaVersion: 'share-1.0.0', sharing: { mode }, quality: qualitySummary(model),
    project: { name: review ? '代码流程 · 脱敏评审版' : '代码流程 · 业务演示版', languages: model.project.languages.map(l => ['Java', 'JavaScript / TypeScript'].includes(l) ? l : 'Code') },
    sourceSnapshot: review ? { id: model.sourceSnapshot.id, files: model.sourceSnapshot.files.map(f => ({ name: fileNames.get(f.name), hash: f.hash, bytes: f.bytes, lines: f.lines })) } : null,
    dataMode: 'mock', entryStepId: stepIds.get(model.entryStepId),
    entries: model.steps.map(s => ({ id: stepIds.get(s.id), label: safeSymbol(s.label, stepIds.get(s.id)), file: review ? fileNames.get(s.file) : null, line: review ? s.line : null, preferred: s.id === model.entryStepId })),
    entities: model.entities.map(e => ({ id: entityIds.get(e.id), label: safeSymbol(e.label, entityIds.get(e.id)), kind: e.kind, basis: e.basis, unresolved: !!e.unresolved })),
    steps: model.steps.map(s => ({ id: stepIds.get(s.id), label: safeSymbol(s.label, stepIds.get(s.id)), entityId: entityIds.get(s.entityId), basis: s.basis, file: review ? fileNames.get(s.file) : null, line: review ? s.line : null, evidenceIds: review ? s.evidenceIds.map(id => evidenceIds.get(id)) : [], parameters: s.parameters.map((p, i) => ({ name: safeSymbol(p.name, `input${i + 1}`), type: safeType(p.type) })), transforms: [], guards: [], transaction: null, parser: s.parser })),
    flows: model.flows.map((f, i) => ({ id: `flow-${i + 1}`, from: entityIds.get(f.from), to: entityIds.get(f.to), label: safeSymbol(f.label, `connection${i + 1}`), basis: f.basis, resolution: f.resolution, evidenceId: review ? evidenceIds.get(f.evidenceId) : null, line: review ? f.line : null })),
    contracts: model.contracts.map((c, i) => ({ id: `contract-${i + 1}`, name: safeSymbol(c.name, `Contract${i + 1}`), fields: c.fields.map((f, j) => ({ name: safeSymbol(f.name, `field${j + 1}`), type: safeType(f.type), optional: f.optional })), file: review ? fileNames.get(c.file) : null, line: review ? c.line : null, evidenceIds: review ? c.evidenceIds.map(id => evidenceIds.get(id)) : [] })),
    evidence: review ? model.evidence.map(e => ({ id: evidenceIds.get(e.id), file: fileNames.get(e.file), startLine: e.startLine, endLine: e.endLine, fileHash: e.fileHash, excerptHash: e.excerptHash })) : [],
    diagnostics: [], presentation: { layout: 'assembly', playback: 'static-outline', theme: 'light' },
    report: { files: model.sourceSnapshot.files.length, functions: model.report.functions, outlinedFunctions: model.steps.length, unresolvedCalls: model.flows.filter(f => f.resolution === 'unresolved').length, sourceStepsWithEvidence: qualitySummary(model).evidencedSteps, limitations: LIMITATIONS }
  };
  return assertSharedModel(shared);
}
