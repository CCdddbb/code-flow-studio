import path from 'node:path';
import { validateFiles, hash, redact, LIMITS } from './safety.js';
import { parseTypeScript, parseJava } from './parsers.js';
import { SCHEMA_VERSION, assertModel } from './model.js';

const identifier = (prefix, value) => `${prefix}-${hash(value).slice(0, 12)}`;
function hint(callee) {
  if (/(?:save|insert|update|delete|find|select|repository|collection|store|jdbc|mongo)/i.test(callee)) return 'store';
  if (/(?:publish|enqueue|send|emit|queue)/i.test(callee)) return 'queue';
  return 'external';
}
export function analyze(input, { entry, name = '代码分析' } = {}) {
  const files = validateFiles(input).sort((a, b) => a.name.localeCompare(b.name));
  const diagnostics = [], functions = [], contracts = [], evidence = [];
  const fileMap = new Map(files.map(f => [f.name, f]));
  function proof(file, startLine, endLine, claim) {
    const lines = file.content.split('\n');
    endLine = Math.min(lines.length, Math.max(startLine, endLine));
    const original = lines.slice(startLine - 1, endLine).join('\n');
    const excerpt = redact(original);
    const id = identifier('ev', `${file.name}:${startLine}:${endLine}:${claim}`);
    if (!evidence.some(e => e.id === id)) evidence.push({ id, file: file.name, startLine, endLine, claim, fileHash: hash(file.content), excerptHash: hash(original), excerpt, redacted: excerpt !== original, truncated: endLine < lines.length, status: 'valid' });
    return id;
  }
  for (const file of files) {
    const safeFile = { ...file, content: redact(file.content) };
    const parsed = file.name.endsWith('.java') ? parseJava(safeFile) : parseTypeScript(safeFile);
    diagnostics.push(...parsed.diagnostics);
    for (const fn of parsed.functions) {
      fn.file = file.name;
      fn.safeContent = safeFile.content;
      fn.id = identifier('fn', `${file.name}:${fn.start}:${fn.name}`);
      fn.symbol = fn.className ? `${fn.className}.${fn.name}` : fn.name;
      functions.push(fn);
    }
    for (const contract of parsed.contracts) contracts.push({ ...contract, id: identifier('contract', `${file.name}:${contract.name}:${contract.line}`), file: file.name, evidenceIds: [proof(file, contract.line, Math.min(contract.line + 12, file.content.split('\n').length), `Declaration of ${contract.name}`)] });
  }
  if (functions.length > LIMITS.functions) throw new Error('Too many functions; select a smaller module');
  if (!functions.length) throw new Error('No supported function/method bodies found. Upload Java public/private/protected methods or JS/TS functions.');
  const preferred = functions.filter(f => f.entry);
  const candidates = preferred.length ? preferred : functions;
  const selected = entry ? functions.filter(f => f.id === entry || f.symbol === entry || f.name === entry) : [candidates[0]];
  if (!selected.length) throw new Error('Selected entry not found');
  if (selected.length > 1) throw new Error('Entry is ambiguous; select its unique ID');
  const root = selected[0], entities = [], steps = [], flows = [], visited = new Set();
  function resolve(fn, call) {
    if (call.construct) return null;
    const parts = call.callee.split('.');
    let matches = [];
    if (parts.length === 1) {
      if (fn.parameters.some(p => p.name === call.callee)) return null;
      if (fn.localBindings?.includes(call.callee) && !functions.some(other => other.name === call.callee && other.scopeStarts?.[0] === fn.start)) return null;
      matches = functions.filter(other => other.file === fn.file && other.name === call.callee && other.className === fn.className && (!other.scopeStarts?.length || other.scopeStarts[0] === fn.start || fn.scopeStarts?.includes(other.scopeStarts[0])));
      // Explicit relative named imports only; no package resolution or filesystem access.
      if (!matches.length && !fn.file.endsWith('.java')) {
        const imports = [...fn.safeContent.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)];
        for (const imp of imports) {
          const imported = imp[1].split(',').map(s => s.trim().split(/\s+as\s+/)).find(pair => (pair[1] || pair[0]) === call.callee);
          if (!imported || !imp[2].startsWith('.')) continue;
          const base = path.posix.normalize(path.posix.join(path.posix.dirname(fn.file), imp[2]));
          const names = [base, `${base}.ts`, `${base}.js`, base.replace(/\.js$/, '.ts'), `${base}/index.ts`, `${base}/index.js`];
          matches.push(...functions.filter(other => names.includes(other.file) && other.name === imported[0] && !other.className));
        }
      }
    } else if (parts.length === 2 && (parts[0] === 'this' || parts[0] === fn.className)) matches = functions.filter(other => other.file === fn.file && other.className === fn.className && other.name === parts[1]);
    else if (fn.receiverTypes && parts.length === 2 && fn.receiverTypes[parts[0]]) matches = functions.filter(other => other.className === fn.receiverTypes[parts[0]] && other.name === parts[1]);
    return matches.length === 1 ? matches[0] : null;
  }
  function visit(fn) {
    if (visited.has(fn.id)) return;
    if (steps.length >= LIMITS.steps) { diagnostics.push({ severity: 'warning', code: 'OUTLINE_LIMIT', message: '流程超过 40 个步骤；显示有限静态展开，不代表完整调用链。' }); return; }
    visited.add(fn.id);
    const file = fileMap.get(fn.file);
    const entityId = identifier('node', fn.id);
    entities.push({ id: entityId, label: fn.symbol, kind: 'service', basis: 'source' });
    const evidenceId = proof(file, fn.line, Math.min(fn.endLine, fn.line + 45), `Declaration and body of ${fn.symbol}`);
    const transforms = fn.transforms;
    steps.push({ id: fn.id, label: fn.symbol, entityId, basis: 'source', file: fn.file, line: fn.line, evidenceIds: [evidenceId], parameters: fn.parameters, transforms, guards: fn.guards.map(g => ({ ...g, condition: redact(g.condition), evidenceId: proof(file, g.line, g.line + 2, 'Conditional source expression; reachability is not evaluated') })), transaction: fn.transaction ? { basis: 'source', label: '@Transactional annotation; effective boundary unverified' } : null, parser: fn.parser });
    for (const call of fn.calls) {
      const target = resolve(fn, call);
      const ev = proof(file, call.line, call.line, `Call expression ${call.callee}; runtime reachability unknown`);
      let to;
      if (target && (visited.has(target.id) || steps.length < LIMITS.steps)) {
        visit(target);
        to = identifier('node', target.id);
      } else {
        to = identifier('external', `${fn.file}:${call.callee}`);
        if (!entities.some(n => n.id === to)) entities.push({ id: to, label: call.callee, kind: hint(call.callee), basis: 'inferred', unresolved: true });
        diagnostics.push({ severity: 'info', code: 'UNRESOLVED_CALL', file: fn.file, line: call.line, message: `未解析 ${call.callee}；节点类型来自命名提示，不证明存在数据库/队列或调用执行。` });
      }
      flows.push({ id: identifier('edge', `${fn.id}:${call.line}:${call.callee}:${flows.length}`), from: entityId, to, label: call.callee, basis: 'source', resolution: target && to === identifier('node', target.id) ? (target.file === fn.file ? 'static-local' : 'static-declared-reference') : 'unresolved', evidenceId: ev, line: call.line });
    }
  }
  visit(root);
  if (functions.length > steps.length) diagnostics.push({ severity: 'info', code: 'OUT_OF_SCOPE', message: `${functions.length - steps.length} 个函数未包含在当前入口静态展开中，可切换入口查看。` });
  if (root.parameters.some(p => !contracts.some(c => c.name === p.type))) diagnostics.push({ severity: 'info', code: 'INPUT_ASSUMPTION', message: '未解析的入参使用占位值；演示输入可以手工修改，不是实测请求。' });
  const model = {
    schemaVersion: SCHEMA_VERSION,
    project: { name: redact(String(name)).slice(0, 80), languages: [...new Set(files.map(f => f.name.endsWith('.java') ? 'Java' : 'JavaScript / TypeScript'))] },
    sourceSnapshot: { id: hash(files.map(f => `${f.name}:${hash(f.content)}`).join('|')), files: files.map(f => ({ name: f.name, hash: hash(f.content), bytes: Buffer.byteLength(f.content), lines: f.content.split('\n').length })) },
    dataMode: 'mock', entryStepId: root.id,
    entries: functions.map(f => ({ id: f.id, label: f.symbol, file: f.file, line: f.line, preferred: f.entry })),
    entities, steps, flows, contracts, evidence, diagnostics,
    presentation: { layout: 'assembly', playback: 'static-outline', theme: 'light' },
    report: { files: files.length, functions: functions.length, outlinedFunctions: steps.length, unresolvedCalls: flows.filter(f => f.resolution === 'unresolved').length, sourceStepsWithEvidence: steps.filter(s => s.evidenceIds.length).length, limitations: ['静态展开包含条件分支里的调用，不是实际执行顺序或执行追踪。', '静态声明引用不证明运行时绑定；命名推断不证明表名、事务范围、幂等性或恢复。', '仅 TS/JS 的直线 const/return 支持受限投影；Java 不自动求值。', '证据已进行尽力脱敏，导出前仍须人工审查。'] }
  };
  return assertModel(model);
}
