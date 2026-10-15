// Counts describe static analysis, never runtime confidence or business correctness.
export const BASIS = Object.freeze({
  source: { label: '源码事实', className: 'basis-source' },
  inferred: { label: '静态推断', className: 'basis-inferred' },
  'user-confirmed': { label: '人工确认', className: 'basis-confirmed' },
  unknown: { label: '未知', className: 'basis-unknown' },
  mock: { label: '模拟', className: 'basis-mock' }
});
export function qualitySummary(model) {
  if (model.schemaVersion === 'share-1.0.0') return model.quality;
  const validEvidence = new Set(model.evidence.filter(e => e.status === 'valid').map(e => e.id));
  const sourceSteps = model.steps.filter(s => s.basis === 'source');
  return {
    sourceSteps: sourceSteps.length,
    evidencedSteps: sourceSteps.filter(s => s.evidenceIds.length && s.evidenceIds.every(id => validEvidence.has(id))).length,
    totalRelations: model.flows.length,
    staticMatches: model.flows.filter(f => f.resolution !== 'unresolved').length,
    inferredNodes: model.entities.filter(n => n.basis === 'inferred').length,
    unknownRelations: model.flows.filter(f => f.resolution === 'unresolved').length,
    confirmedNodes: model.entities.filter(n => n.basis === 'user-confirmed').length,
    limitationCount: model.report.limitations.length + model.diagnostics.filter(d => d.severity === 'warning' || d.severity === 'error').length
  };
}
export function reviewAdvice(quality) {
  return quality.unknownRelations
    ? `适合局部源码核对；${quality.unknownRelations} 个调用目标未解析，不适合作为完整业务评审结论。`
    : '适合静态结构核对；静态匹配不证明运行时绑定、事务或业务正确性。';
}
export const EXPORT_MODES = Object.freeze({
  review: {
    label: '脱敏评审版',
    included: ['流程与依据标识', '字段名称与概括类型', '相对文件位置与证据摘要', '质量摘要'],
    omitted: ['源码正文', '条件表达式与转换代码', '字面量与演示值', '原始诊断和自由文本'],
    risk: '不含源码正文，但相对文件名、符号名、字段名和摘要仍可能敏感。必须审查并确认分享授权。'
  },
  business: {
    label: '业务演示版',
    included: ['流程与依据标识', '字段名称与概括类型', '质量摘要'],
    omitted: ['源码正文', '文件路径与行号', '源码及证据摘要', '条件、转换、字面量和原始说明'],
    risk: '字段与流程名称仍可能包含业务信息。没有人工确认说明或状态模型时不补造业务解释。'
  },
  internal: {
    label: '完整内部版',
    included: ['流程与依据标识', '字段与受限投影', '源码证据及摘要', '条件与解析诊断'],
    omitted: ['真实执行结果（从未采集）'],
    risk: '包含源码、字面量及诊断。尽力脱敏不保证去除所有秘密；仅限获授权的内部使用。'
  }
});
