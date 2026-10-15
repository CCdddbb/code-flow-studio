// Shared by browser and Node tests. Pure projections, never an interpreter.
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
export const unknown = reason => ({ $unknown: reason });
export function evaluate(expr, environment, depth = 0) {
  if (depth > 24) return unknown('Expression too deep');
  if (!expr || typeof expr !== 'object') return unknown('Invalid expression');
  if (expr.op === 'literal') return expr.value;
  if (expr.op === 'ref') {
    if (!Array.isArray(expr.path) || expr.path.some(p => FORBIDDEN.has(p))) return unknown('Unsafe reference');
    let value = environment;
    for (const part of expr.path) {
      if (value == null || typeof value !== 'object' || !Object.hasOwn(value, part)) return unknown(`Missing ${expr.path.join('.')}`);
      value = value[part];
    }
    return value;
  }
  if (expr.op === 'object') {
    const output = {};
    for (const field of expr.fields ?? []) {
      if (FORBIDDEN.has(field.key)) return unknown('Unsafe field');
      output[field.key] = evaluate(field.expression, environment, depth + 1);
    }
    return output;
  }
  if (expr.op === 'array') return (expr.items ?? []).map(e => evaluate(e, environment, depth + 1));
  return unknown(expr.reason || 'Unsupported transformation');
}
export function sampleValue(type, contracts, seen = new Set(), depth = 0) {
  if (depth > 5) return unknown('Nested input limit');
  type = (type || 'unknown').trim();
  if (/\[\]$/.test(type) || /^(?:List|Array)</.test(type)) return [];
  if (/^(?:number|int|long|Integer|Long|Double|double|BigDecimal)$/.test(type)) return 100;
  if (/^(?:boolean|Boolean)$/.test(type)) return true;
  if (/^(?:string|String)$/.test(type)) return 'demo';
  const literal = /^['"]([^'"]+)['"]$/.exec(type);
  if (literal) return literal[1];
  const contract = contracts.find(c => c.name === type);
  if (!contract || seen.has(type)) return unknown(`Provide ${type}`);
  const next = new Set([...seen, type]), result = {};
  for (const field of contract.fields) if (!FORBIDDEN.has(field.name)) result[field.name] = sampleValue(field.type, contracts, next, depth + 1);
  return result;
}
export function sampleInput(step, contracts) {
  const result = {};
  for (const parameter of step.parameters) if (!FORBIDDEN.has(parameter.name)) result[parameter.name] = sampleValue(parameter.type, contracts);
  return result;
}
export function project(step, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('演示输入必须是 JSON 对象');
  const environment = structuredClone(input), outputs = {};
  for (const transform of step.transforms) {
    if (FORBIDDEN.has(transform.target)) continue;
    const value = evaluate(transform.expression, environment);
    environment[transform.target] = value;
    outputs[transform.target] = value;
  }
  return { input, output: outputs, supported: step.transforms.length > 0, mode: 'mock' };
}
export function differences(before, after, prefix = '') {
  const result = [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const location = `${prefix}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (!Object.hasOwn(before, key)) result.push({ path: location, kind: 'added', after: after[key] });
      else if (!Object.hasOwn(after, key)) result.push({ path: location, kind: 'removed', before: before[key] });
      else result.push(...differences(before[key], after[key], location));
    }
  } else if (JSON.stringify(before) !== JSON.stringify(after)) result.push({ path: prefix || '/', kind: 'changed', before, after });
  return result;
}
export function mappings(expression, prefix = '', bindings = {}, seen = new Set()) {
  if (!expression) return [];
  if (expression.op === 'ref' && expression.path.length === 1 && Object.hasOwn(bindings, expression.path[0]) && !seen.has(expression.path[0])) {
    const key = expression.path[0];
    return mappings(bindings[key], prefix, bindings, new Set([...seen, key]));
  }
  if (expression.op === 'object') return expression.fields.flatMap(f => mappings(f.expression, prefix ? `${prefix}.${f.key}` : f.key, bindings, seen));
  return [{ target: prefix || '$return', source: expression.op === 'ref' ? expression.path.join('.') : expression.op === 'literal' ? JSON.stringify(expression.value) : 'unknown', basis: expression.op === 'unknown' ? 'unknown' : 'source' }];
}
