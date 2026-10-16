import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { REFERENCE_SCENARIOS, validateScenario } from '../public/scenarios.js';

const schema = JSON.parse(readFileSync(new URL('../schema/scenario.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
export function assertScenario(model) {
  if (!validate(model)) throw new Error(`Scenario schema failed: ${validate.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  return validateScenario(model);
}
export function referenceScenarios() {
  return REFERENCE_SCENARIOS.map(model => structuredClone(assertScenario(model)));
}
