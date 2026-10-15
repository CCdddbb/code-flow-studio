import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { safeName } from './safety.js';
const schema = JSON.parse(readFileSync(new URL('../schema/analysis.schema.json', import.meta.url), 'utf8'));
const validateSchema = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);
export const SCHEMA_VERSION = '1.0.0';
export function validateModel(model) {
  if (!validateSchema(model)) return { valid: false, errors: validateSchema.errors.map(e => `${e.instancePath || '/'} ${e.message}`) };
  const errors = [];
  const fail = message => errors.push(message);
  if (model?.schemaVersion !== SCHEMA_VERSION) fail('Unsupported schema version');
  for (const key of ['entities', 'steps', 'flows', 'evidence', 'contracts', 'diagnostics', 'entries']) if (!Array.isArray(model?.[key])) fail(`${key} must be an array`);
  if (errors.length) return { valid: false, errors };
  function unique(items, label) {
    const ids = items.map(x => x.id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) fail(`Invalid or duplicate ${label} IDs`);
    return new Set(ids);
  }
  const entities = unique(model.entities, 'entity'), steps = unique(model.steps, 'step'), evidence = unique(model.evidence, 'evidence');
  unique(model.flows, 'flow'); unique(model.contracts, 'contract'); unique(model.entries, 'entry');
  if (!model.project || !model.sourceSnapshot?.files?.length) fail('Missing source snapshot');
  const files = new Set(model.sourceSnapshot.files.map(f => f.name));
  if (files.size !== model.sourceSnapshot.files.length) fail('Duplicate source paths');
  for (const file of model.sourceSnapshot.files) { try { safeName(file.name); } catch { fail(`Invalid source path ${file.name}`); } }
  for (const ev of model.evidence) {
    const source = model.sourceSnapshot.files.find(f => f.name === ev.file);
    if (source && (ev.fileHash !== source.hash || ev.endLine > source.lines)) fail(`Evidence snapshot mismatch ${ev.id}`);
    if (!files.has(ev.file) || !Number.isInteger(ev.startLine) || ev.startLine < 1 || ev.endLine < ev.startLine || !/^[a-f0-9]{64}$/.test(ev.fileHash) || !/^[a-f0-9]{64}$/.test(ev.excerptHash)) fail(`Invalid evidence ${ev.id}`);
  }
  for (const step of model.steps) {
    if (!entities.has(step.entityId)) fail(`Unknown step entity ${step.id}`);
    if (!['source', 'inferred', 'user-confirmed', 'unknown'].includes(step.basis)) fail(`Invalid basis ${step.id}`);
    if (step.basis === 'source' && !step.evidenceIds?.length) fail(`Source step missing evidence ${step.id}`);
    for (const id of step.evidenceIds ?? []) if (!evidence.has(id)) fail(`Missing evidence ${id}`);
    for (const guard of step.guards) if (!evidence.has(guard.evidenceId)) fail(`Missing guard evidence ${guard.evidenceId}`);
    if (!Array.isArray(step.transforms) || !Array.isArray(step.parameters)) fail(`Missing step contract ${step.id}`);
  }
  for (const contract of model.contracts) for (const id of contract.evidenceIds) if (!evidence.has(id)) fail(`Missing contract evidence ${id}`);
  for (const flow of model.flows) if (!entities.has(flow.from) || !entities.has(flow.to) || !evidence.has(flow.evidenceId)) fail(`Invalid flow ${flow.id}`);
  if (!steps.has(model.entryStepId)) fail('Invalid selected entry');
  if (model.dataMode !== 'mock') fail('Only mock illustrations are supported');
  if (!model.presentation || model.presentation.playback !== 'static-outline') fail('Playback must be a static outline, not runtime execution');
  return { valid: errors.length === 0, errors };
}
export function assertModel(model) {
  const result = validateModel(model);
  if (!result.valid) throw new Error(`Model validation failed: ${result.errors.join('; ')}`);
  return model;
}
