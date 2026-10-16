import { sampleInput, project, differences, mappings } from './simulation.js';
import { BASIS, qualitySummary, reviewAdvice, EXPORT_MODES } from './quality.js';
import { REFERENCE_SCENARIOS, runScenario } from './scenarios.js';

const $ = id => document.getElementById(id);
const state = { model: null, files: null, index: 0, playing: false, timer: null, token: null, tab: 'assembly', selectedFiles: [], offline: !!document.getElementById('embedded-model'), request: 0 };
const offlineOriginal = state.offline ? '<!doctype html>\n' + document.documentElement.outerHTML : null;
const pretty = value => JSON.stringify(value, null, 2);
let exportSnapshot = null, exportFormat = 'html', exportRevision = 0, exportReady = false;
function basisBadge(basis) {
  const info = BASIS[basis] || BASIS.unknown;
  return node('span', `badge basis-badge ${info.className}`, info.label);
}
function renderQuality() {
  const model = state.model, q = qualitySummary(model);
  $('quality-summary').textContent = `${q.sourceSteps} 个源码步骤 · ${q.unknownRelations} 个未解析调用`;
  $('quality-metrics').replaceChildren(...[['源码事实步骤', q.sourceSteps], ['静态匹配关系', `${q.staticMatches} / ${q.totalRelations}`], ['推断节点', q.inferredNodes], ['未知关系', q.unknownRelations], ['限制项', q.limitationCount]].map(([label, value]) => {
    const div = node('div'); div.append(node('span', '', label), node('strong', '', value)); return div;
  }));
  $('review-advice').textContent = reviewAdvice(q);
  $('evidence-scope').textContent = `原分析快照中，源码步骤证据引用：${q.evidencedSteps} / ${q.sourceSteps}。这不是正确率或已确认业务覆盖率。${model.sharing ? '本分享包无证据正文，接收者无法独立核验。' : '未解析连接不计入静态匹配；磁盘证据需另行核验。'}`;
  $('sharing-level').textContent = model.sharing ? EXPORT_MODES[model.sharing.mode].label : '本地内部分析';
  $('basis-legend').replaceChildren(...Object.keys(BASIS).map(basisBadge));
  $('node-basis-list').replaceChildren(...model.entities.map(entity => {
    const row = node('div', 'node-basis-row'); row.append(node('span', '', entity.label), basisBadge(entity.basis));
    if (entity.unresolved) row.append(basisBadge('unknown'));
    return row;
  }));
}
function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function setSidebar(open) {
  document.body.classList.toggle('sidebar-open', open);
  $('sidebar-toggle').setAttribute('aria-expanded', String(open));
  $('sidebar-toggle').setAttribute('aria-label', open ? '收起导航' : '展开导航');
}
function renderProjectNavigation(model) {
  const files = model.sourceSnapshot?.files || [];
  $('file-count').textContent = model.sourceSnapshot ? files.length : '—';
  $('source-files').replaceChildren(...files.map(file => {
    const row = node('div', 'source-file'); row.title = file.name;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon'); icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-file'); icon.append(use);
    row.append(icon, node('span', '', file.name)); return row;
  }));
  if (!files.length) $('source-files').append(node('div', 'empty-note', '文件位置已隐藏'));
  $('outline-nav').replaceChildren(...model.steps.map((step, index) => {
    const button = node('button'); button.title = step.label;
    button.append(node('span', '', String(index + 1).padStart(2, '0')), node('code', '', step.label));
    button.addEventListener('click', () => { selectStep(index); setTab('assembly'); setSidebar(false); }); return button;
  }));
}
function showMessage(message, error = false) {
  $('message').textContent = message;
  $('message').classList.toggle('error', error);
  $('message').hidden = false;
}
function clearMessage() { $('message').hidden = true; }
function current() { return state.model.steps[state.index]; }
async function request(url, data) {
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': state.token }, body: JSON.stringify(data) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response;
}
function stop() {
  clearTimeout(state.timer); state.playing = false;
  $('play-button').textContent = '播放';
  $('play-button').setAttribute('aria-pressed', 'false');
  document.body.classList.remove('playing');
}
function schedule() {
  state.timer = setTimeout(() => {
    if (state.index >= state.model.steps.length - 1) { stop(); return; }
    state.index++; renderStep();
    if (state.index >= state.model.steps.length - 1) stop(); else schedule();
  }, Number($('speed-select').value));
}
function play() {
  if (!state.model || state.model.steps.length < 2) return;
  if (state.playing) { stop(); return; }
  if (state.index === state.model.steps.length - 1) { state.index = 0; renderStep(); }
  state.playing = true; $('play-button').textContent = '暂停'; $('play-button').setAttribute('aria-pressed', 'true'); document.body.classList.add('playing'); schedule();
}
function selectStep(index) { stop(); state.index = Math.max(0, Math.min(state.model.steps.length - 1, index)); renderStep(); }
function setTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-selected', String(button.dataset.tab === tab)); button.tabIndex = button.dataset.tab === tab ? 0 : -1; }
  for (const name of ['assembly', 'data', 'scenario', 'evidence']) $(`${name}-view`).hidden = name !== tab;
  if (tab !== 'assembly') stop();
}
const scenarioUI = { reference: 0, pathId: null, index: 0 };
function renderScenario(reset = false) {
  const model = REFERENCE_SCENARIOS[scenarioUI.reference];
  if (reset || !model.scenarios.some(path => path.id === scenarioUI.pathId)) { scenarioUI.pathId = model.scenarios[0].id; scenarioUI.index = 0; }
  $('scenario-reference').replaceChildren(...REFERENCE_SCENARIOS.map((item, i) => { const option = node('option', '', item.title); option.value = i; return option; }));
  $('scenario-reference').value = scenarioUI.reference;
  const kindLabels = { success: '成功', rejected: '拒绝', failure: '失败 / 未知', recovery: '恢复' };
  $('scenario-path').replaceChildren(...model.scenarios.map(path => { const option = node('option', '', `${kindLabels[path.kind]} · ${path.label}`); option.value = path.id; return option; }));
  $('scenario-path').value = scenarioUI.pathId;
  const frames = runScenario(model, scenarioUI.pathId);
  scenarioUI.index = Math.max(0, Math.min(scenarioUI.index, frames.length - 1));
  const frame = frames[scenarioUI.index], stateLabel = id => model.states.find(item => item.id === id).label;
  $('scenario-timeline').replaceChildren(...frames.map((item, i) => {
    const button = node('button', i === scenarioUI.index ? 'active' : '', `${i + 1}. ${item.label}`);
    button.setAttribute('aria-current', i === scenarioUI.index ? 'step' : 'false');
    button.addEventListener('click', () => { scenarioUI.index = i; renderScenario(); }); return button;
  }));
  $('scenario-state').textContent = `${stateLabel(frame.fromState)} → ${stateLabel(frame.toState)}`;
  $('scenario-condition').textContent = `${frame.condition}。条件来自作者指定的路径，不由引擎求值。`;
  $('scenario-position').textContent = `${scenarioUI.index + 1} / ${frames.length} · ${frame.label}`;
  $('scenario-previous').disabled = scenarioUI.index === 0;
  $('scenario-next').disabled = scenarioUI.index === frames.length - 1;
  $('scenario-stores').replaceChildren(...model.stores.map(store => {
    const card = node('article', 'scenario-store');
    const title = node('h3', '', store.label); title.append(node('span', 'badge mock', '合成数据'));
    const grid = node('div', 'scenario-snapshots');
    for (const [label, value] of [['Before', frame.before[store.id]], ['After', frame.after[store.id]]]) {
      const pane = node('div'); pane.append(node('h4', '', label), node('pre', '', pretty(value))); grid.append(pane);
    }
    card.append(title, grid); return card;
  }));
  $('scenario-mutations').replaceChildren(...frame.mutations.map(mutation => {
    const row = node('div', 'mapping-row');
    row.append(node('code', '', mutation.op), node('span', '', `${model.stores.find(store => store.id === mutation.storeId).label}.${mutation.field}`), node('code', '', mutation.op === 'unset' ? '移除字段' : pretty(mutation.value))); return row;
  }));
  if (!frame.mutations.length) $('scenario-mutations').append(node('div', 'empty-note', '此步没有模拟存储变化；不自动回滚或补造记录。'));
  $('scenario-boundaries').replaceChildren(...model.transactionRegions.map(region => node('p', 'section-note', `${region.label}：${region.storeIds.map(id => model.stores.find(store => store.id === id).label).join(' / ')}。原子性未验证；不得视为单一强事务。`)));
  $('scenario-assumptions').replaceChildren(...model.assumptions.map(item => node('p', 'section-note', `人工假设 · ${item.author} · 修订 ${item.revision}：${item.statement}`)));
  $('scenario-context').textContent = `独立参考案例：${model.title}。与当前「${state.model.project.name}」的源码分析无关联；本视图不增加源码事实或已确认覆盖率。`;
}
function installModel(model, files = null) {
  if (!['1.0.0', 'share-1.0.0'].includes(model.schemaVersion) || !Array.isArray(model.steps) || !model.steps.length) throw new Error('Unsupported visualization model');
  stop(); state.model = model; state.files = files; state.index = 0;
  $('project-name').textContent = model.project.name;
  $('language-label').textContent = model.project.languages.join(' / ');
  for (const [id, value] of [['stat-files', model.report.files], ['stat-functions', model.report.functions], ['stat-steps', model.steps.length], ['stat-unresolved', model.report.unresolvedCalls]]) $(id).textContent = value;
  $('entry-select').replaceChildren(...model.entries.map(entry => {
    const option = node('option', '', entry.file ? `${entry.label} · ${entry.file}:${entry.line}` : entry.label); option.value = entry.id; return option;
  }));
  $('entry-select').value = model.entryStepId;
  $('entry-select').disabled = state.offline;
  $('data-step-select').replaceChildren(...model.steps.map((step, i) => { const option = node('option', '', step.label); option.value = i; return option; }));
  $('timeline').replaceChildren(...model.steps.map((step, i) => {
    const button = node('button'); button.append(node('span', '', String(i + 1).padStart(2, '0')), document.createTextNode(step.label));
    button.addEventListener('click', () => selectStep(i)); return button;
  }));
  $('flow-list').replaceChildren(...model.flows.slice(0, 80).map(flow => {
    const row = node('div', 'flow-row');
    const from = model.entities.find(n => n.id === flow.from), to = model.entities.find(n => n.id === flow.to);
    row.append(node('span', '', from.label), node('b', '', '→'), node('span', '', to.label), basisBadge(to.basis), node('small', '', flow.resolution === 'unresolved' ? '未知目标' : '静态匹配（非运行事实）'));
    return row;
  }));
  if (!model.flows.length) $('flow-list').append(node('div', 'empty-note', '当前入口没有发现调用表达式，可能是纯数据投影。'));
  $('limitations').replaceChildren(...model.report.limitations.map(item => node('li', '', item)));
  $('diagnostic-summary').textContent = `${model.diagnostics.length} 条诊断 · ${model.report.unresolvedCalls} 个未解析调用 · 全部保留在证据视图`;
  $('snapshot-badge').textContent = model.sourceSnapshot ? `SNAPSHOT ${model.sourceSnapshot.id.slice(0, 10)}` : '无源码元数据';
  renderProjectNavigation(model); renderQuality(); renderEvidence(); renderStep(); renderScenario();
  $('play-button').disabled = model.steps.length < 2;
}
function renderStep() {
  const step = current(), model = state.model;
  $('current-label').textContent = step.label;
  $('current-location').textContent = step.file ? `${step.file}:${step.line}` : '业务演示 · 文件位置已移除';
  $('position-label').textContent = `${String(state.index + 1).padStart(2, '0')} / ${String(model.steps.length).padStart(2, '0')} 静态步骤`;
  $('logic-footer').textContent = step.parser === 'java-lexical' ? 'Java 词法提取 · 有限支持' : 'TypeScript AST · 只读分析';
  const fields = [];
  for (const param of step.parameters) {
    const contract = model.contracts.find(c => c.name === param.type);
    if (contract) for (const field of contract.fields) fields.push({ name: `${param.name}.${field.name}`, type: field.type });
    else fields.push(param);
  }
  $('contract-fields').replaceChildren(...fields.slice(0, 12).map(field => { const row = node('div', 'field-row'); row.append(node('span', '', field.name), node('span', '', field.type)); return row; }));
  if (!fields.length) $('contract-fields').append(node('div', 'empty-note', '无显式参数'));
  const capabilities = [basisBadge(step.basis), basisBadge('mock'), node('span', 'capability', `${step.parameters.length} 个入参`)];
  if (step.transforms.length) capabilities.push(node('span', 'capability', `${step.transforms.length} 个声明式投影`));
  if (step.guards.length) capabilities.push(node('span', 'capability warn', `${step.guards.length} 个条件（未求值）`));
  if (step.transaction) capabilities.push(node('span', 'capability warn', '@Transactional / 生效未验证'));
  $('capabilities').replaceChildren(...capabilities);
  const flows = model.flows.filter(f => f.from === step.entityId);
  $('dependencies').replaceChildren(...flows.slice(0, 7).map(flow => {
    const div = node('div', `dependency-item ${flow.resolution === 'unresolved' ? '' : 'resolved'}`);
    const target = model.entities.find(e => e.id === flow.to);
    const name = node('span', 'dependency-name', flow.label); name.title = flow.label;
    div.append(node('span', 'dot'), name, basisBadge(target.basis), node('small', '', flow.resolution === 'unresolved' ? '未知目标' : '静态匹配')); return div;
  }));
  if (!flows.length) $('dependencies').append(node('div', 'empty-note', '无调用表达式 · 直接处理数据'));
  if (flows.length > 7) $('dependencies').append(node('div', 'empty-note', `另有 ${flows.length - 7} 个连接，见下方连接图。`));
  [...$('timeline').children].forEach((button, i) => { button.classList.toggle('active', i === state.index); button.setAttribute('aria-current', i === state.index ? 'step' : 'false'); });
  [...$('outline-nav').children].forEach((button, i) => { button.classList.toggle('active', i === state.index); button.setAttribute('aria-current', i === state.index ? 'step' : 'false'); });
  $('caption-title').textContent = step.label;
  $('caption-note').textContent = step.guards.length ? `条件：${step.guards[0].condition}。条件分支未执行；静态连接不代表必经路径。` : step.transforms.length ? '支持的声明式投影可在「数据变化」中编辑输入并核对字段来源。' : '当前步骤只提供源码与依赖解释，不编造输出、数据库记录或执行结果。';
  $('previous-button').disabled = state.index === 0;
  $('next-button').disabled = state.index === model.steps.length - 1;
  $('data-step-select').value = state.index;
  $('input-editor').value = pretty(sampleInput(step, model.contracts));
  $('transform-select').replaceChildren(...step.transforms.map(t => { const option = node('option', '', t.target === '$return' ? 'return / 返回对象' : t.target); option.value = t.target; return option; }));
  if (step.transforms.some(t => t.target === '$return')) $('transform-select').value = '$return';
  $('transform-select').disabled = !step.transforms.length;
  renderProjection();
}
function renderProjection() {
  try {
    const input = JSON.parse($('input-editor').value);
    if ($('input-editor').value.length > 200_000) throw new Error('演示输入过大');
    const step = current(), result = project(step, input), target = $('transform-select').value;
    if (state.model.sharing) {
      $('output-json').textContent = '分享版未包含原始转换、字面量或演示值。';
      $('projection-status').textContent = '为防止源码泄漏，本分享包仅展示字段契约与流程；不执行数据投影重算。';
      $('field-mappings').replaceChildren(); $('diff-list').replaceChildren(); return;
    }
    const output = result.supported ? result.output[target] : { $unknown: '当前步骤没有受支持的纯投影；不构造成功结果。' };
    $('output-json').textContent = pretty(output);
    const hasUnknown = pretty(output)?.includes('"$unknown"');
    $('projection-status').textContent = !result.supported ? '未生成投影：Java 或复杂控制流需要人工确认，源码仍可核对。' : hasUnknown ? '部分或全部转换未知：未执行函数调用或复杂表达式。unknown 不是空值或失败。' : '已按声明式规则生成模拟投影。下方差异只比较对象形态，不代表持久化操作。';
    const transform = step.transforms.find(t => t.target === target);
    $('field-mappings').replaceChildren(...mappings(transform?.expression, '', Object.fromEntries(step.transforms.map(t => [t.target, t.expression]))).map(mapping => {
      const row = node('div', 'mapping-row'); row.append(node('span', '', mapping.source), node('b', '', '→'), node('span', '', mapping.target)); return row;
    }));
    if (!$('field-mappings').children.length) $('field-mappings').append(node('div', 'empty-note', '没有可提取的字段血缘。'));
    const base = step.parameters.length === 1 ? input[step.parameters[0].name] : input;
    const diff = differences(base, output).slice(0, 100);
    $('diff-list').replaceChildren(...diff.map(change => {
      const row = node('div', `diff-row ${change.kind}`);
      row.append(node('span', 'kind', { added: '新增', removed: '未包含', changed: '变化' }[change.kind]), node('span', '', `${change.path} ${change.kind === 'changed' ? `${JSON.stringify(change.before)} → ` : ''}${JSON.stringify(change.after ?? change.before)}`)); return row;
    }));
    if (!diff.length) $('diff-list').append(node('div', 'empty-note', '选定投影与输入结构相同。'));
  } catch (error) {
    $('projection-status').textContent = `输入无效：${error.message}`;
    $('output-json').textContent = '未生成：请修正输入后应用修改。';
    $('field-mappings').replaceChildren(); $('diff-list').replaceChildren();
  }
}
function renderEvidence() {
  const model = state.model;
  $('evidence-list').replaceChildren(...model.evidence.map((ev, i) => {
    const details = node('details', 'evidence-card'); if (i === 0) details.open = true;
    const summary = node('summary', '', `${ev.file}:${ev.startLine}–${ev.endLine}`);
    summary.append(node('span', 'badge', ev.redacted ? '已脱敏' : '快照证据'));
    const numbered = ev.excerpt?.split('\n').map((line, j) => `${String(ev.startLine + j).padStart(4)}  ${line}`).join('\n');
    details.append(summary, node('p', '', ev.claim || '仅保留相对位置与原始摘要；源码正文未包含，不能在本包独立核验。'));
    if (numbered !== undefined) details.append(node('pre', '', numbered));
    details.append(node('div', 'evidence-hash', `SHA-256 / file: ${ev.fileHash} · excerpt: ${ev.excerptHash}`)); return details;
  }));
  if (!model.evidence.length) $('evidence-list').append(node('div', 'empty-note', '业务演示版已移除文件、行号与证据摘要，不提供源码核验。'));
  $('diagnostics-list').replaceChildren(...model.diagnostics.map(d => { const div = node('div', 'diagnostic-item'); div.append(node('code', '', `${d.code}${d.file ? ` / ${d.file}:${d.line || 1}` : ''}`), document.createTextNode(d.message)); return div; }));
}
async function loadDemo(kind) {
  if (state.offline) { showMessage('这是独立导出页面。切换示例或上传代码请启动本地工作台。'); return; }
  const version = ++state.request; stop();
  try {
    clearMessage(); const response = await request(`/api/demo/${kind}`); const result = await response.json();
    if (version !== state.request) return;
    installModel(result.model, result.files); setTab('assembly'); setSidebar(false);
  } catch (error) { showMessage(error.message, true); }
}
function openUpload() {
  if (state.offline) { showMessage('离线页面支持回放与编辑演示输入。新代码分析请运行 npm start。'); return; }
  setSidebar(false); $('upload-error').hidden = true; $('upload-dialog').showModal();
}
async function selectFiles(files) {
  const list = [...files].filter(f => /\.(?:java|[jt]sx?)$/i.test(f.name) && !/(?:^|\/)(?:node_modules|\.git|target|dist|build|coverage)(?:\/|$)/.test(f.webkitRelativePath));
  state.selectedFiles = list;
  if (list.length) $('paste-code').value = '';
  $('selected-files').textContent = list.length ? `${list.length} 个源文件 · ${(list.reduce((n, f) => n + f.size, 0) / 1024).toFixed(1)} KB\n${list.slice(0, 6).map(f => f.webkitRelativePath || f.name).join(' / ')}` : '未选择支持的源码文件';
}
async function analyzeUpload(event) {
  event.preventDefault(); $('upload-error').hidden = true;
  const button = $('analyze-button'); button.disabled = true; button.textContent = '正在分析…';
  const version = ++state.request;
  try {
    let files;
    if ($('paste-code').value.trim()) files = [{ name: $('paste-name').value.trim(), content: $('paste-code').value }];
    else {
      if (state.selectedFiles.length > 120 || state.selectedFiles.reduce((sum, f) => sum + f.size, 0) > 2_000_000) throw new Error('最多 120 个文件，总计不超过 2 MB。');
      files = await Promise.all(state.selectedFiles.map(async f => ({ name: f.webkitRelativePath || f.name, content: await f.text() })));
    }
    const response = await request('/api/analyze', { files, name: $('name-input').value.trim() || '我的代码流程' });
    const model = await response.json();
    if (version !== state.request) return;
    installModel(model, files); setTab('assembly'); $('upload-dialog').close(); showMessage('分析完成。入口和未解析项已列出；数据投影是模拟，不是实际执行。');
  } catch (error) { $('upload-error').textContent = error.message; $('upload-error').hidden = false; }
  finally { button.disabled = false; button.textContent = '开始分析'; }
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = node('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function previewExport() {
  const revision = ++exportRevision;
  exportReady = false; $('export-confirmation').checked = false; $('export-confirmation').disabled = true; $('export-submit').disabled = true; $('export-error').hidden = true;
  $('export-risk').textContent = '准备内容清单…'; $('export-included').replaceChildren(); $('export-omitted').replaceChildren();
  const mode = $('export-mode').value;
  try {
    const manifest = state.offline ? EXPORT_MODES[mode] : await (await request('/api/export/preview', { model: exportSnapshot, mode })).json();
    if (revision !== exportRevision || !$('export-dialog').open) return;
    $('export-included').replaceChildren(...manifest.included.map(item => node('li', '', item)));
    $('export-omitted').replaceChildren(...manifest.omitted.map(item => node('li', '', item)));
    $('export-risk').textContent = manifest.risk; exportReady = true; $('export-confirmation').disabled = false;
  } catch (error) { $('export-error').textContent = error.message; $('export-error').hidden = false; }
}
function openExport(format) {
  if (!state.model) return;
  stop(); exportSnapshot = state.model; exportFormat = format;
  $('export-format-label').textContent = `文件格式：${format.toUpperCase()}。只导出分析快照，不包含你在工作台临时修改的输入。`;
  $('export-mode').value = state.offline ? state.model.sharing?.mode || 'internal' : 'review';
  $('export-mode').disabled = state.offline; $('export-offline-note').hidden = !state.offline;
  $('export-dialog').showModal(); previewExport();
}
async function submitExport(event) {
  event.preventDefault();
  if (!exportReady || !$('export-confirmation').checked) return;
  $('export-submit').disabled = true;
  try {
    const mode = $('export-mode').value;
    if (state.offline) download(exportFormat === 'html' ? offlineOriginal : pretty(exportSnapshot), exportFormat === 'html' ? 'code-flow.html' : 'analysis.json', exportFormat === 'html' ? 'text/html' : 'application/json');
    else {
      const response = await request('/api/export', { model: exportSnapshot, mode, format: exportFormat, confirmed: true });
      download(await response.text(), exportFormat === 'html' ? 'code-flow.html' : 'analysis.json', exportFormat === 'html' ? 'text/html' : 'application/json');
    }
    $('export-dialog').close(); showMessage(`已导出${EXPORT_MODES[mode].label}。分享前仍须人工审查。`);
  } catch (error) { $('export-error').textContent = error.message; $('export-error').hidden = false; }
  finally { $('export-submit').disabled = !$('export-confirmation').checked; }
}
for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => setTab(button.dataset.tab));
  button.addEventListener('keydown', event => {
    const tabs = [...document.querySelectorAll('[data-tab]')];
    const index = tabs.indexOf(button);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); setTab(tabs[next].dataset.tab); tabs[next].focus();
  });
}
$('sidebar-toggle').addEventListener('click', () => setSidebar(!document.body.classList.contains('sidebar-open')));
for (const button of document.querySelectorAll('[data-demo]')) button.addEventListener('click', () => loadDemo(button.dataset.demo));
for (const id of ['upload-open', 'hero-upload']) $(id).addEventListener('click', openUpload);
$('upload-close').addEventListener('click', () => $('upload-dialog').close());
$('upload-form').addEventListener('submit', analyzeUpload);
$('file-input').addEventListener('change', event => selectFiles(event.target.files));
$('folder-input').addEventListener('change', event => selectFiles(event.target.files));
$('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
$('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); selectFiles(event.dataTransfer.files); });
$('home-button').addEventListener('click', () => { setTab('assembly'); setSidebar(false); });
$('scenario-reference').addEventListener('change', event => { scenarioUI.reference = Number(event.target.value); renderScenario(true); });
$('scenario-path').addEventListener('change', event => { scenarioUI.pathId = event.target.value; scenarioUI.index = 0; renderScenario(); });
$('scenario-previous').addEventListener('click', () => { scenarioUI.index--; renderScenario(); });
$('scenario-next').addEventListener('click', () => { scenarioUI.index++; renderScenario(); });
$('scenario-reset').addEventListener('click', () => { scenarioUI.index = 0; renderScenario(); });
$('play-button').addEventListener('click', play);
$('previous-button').addEventListener('click', () => selectStep(state.index - 1));
$('next-button').addEventListener('click', () => selectStep(state.index + 1));
$('reset-button').addEventListener('click', () => selectStep(0));
$('speed-select').addEventListener('change', () => { if (state.playing) { clearTimeout(state.timer); schedule(); } });
$('data-step-select').addEventListener('change', event => selectStep(Number(event.target.value)));
$('transform-select').addEventListener('change', renderProjection);
$('apply-input').addEventListener('click', renderProjection);
$('sample-button').addEventListener('click', () => { $('input-editor').value = pretty(sampleInput(current(), state.model.contracts)); renderProjection(); });
$('entry-select').addEventListener('change', async event => {
  if (!state.files || state.offline) return;
  const version = ++state.request; stop();
  try {
    const response = await request('/api/analyze', { files: state.files, entry: event.target.value, name: state.model.project.name });
    const model = await response.json(); if (version === state.request) { installModel(model, state.files); clearMessage(); }
  } catch (error) { $('entry-select').value = state.model.entryStepId; showMessage(error.message, true); }
});
$('export-json').addEventListener('click', () => openExport('json'));
$('export-html').addEventListener('click', () => openExport('html'));
$('export-close').addEventListener('click', () => { exportRevision++; $('export-dialog').close(); });
$('export-mode').addEventListener('change', previewExport);
$('export-confirmation').addEventListener('change', () => { $('export-submit').disabled = !exportReady || !$('export-confirmation').checked; });
$('export-form').addEventListener('submit', submitExport);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setSidebar(false);
  if (!state.model || $('upload-dialog').open || $('export-dialog').open || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(document.activeElement.tagName)) return;
  if (event.code === 'Space' && state.tab === 'assembly') { event.preventDefault(); play(); }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault(); const direction = event.key === 'ArrowRight' ? 1 : -1;
    if (state.tab === 'scenario') { scenarioUI.index += direction; renderScenario(); }
    else selectStep(state.index + direction);
  }
});
async function boot() {
  try {
    if (state.offline) {
      installModel(JSON.parse($('embedded-model').textContent));
      document.querySelector('.local-badge').textContent = '离线快照';
      showMessage('独立离线页面 · 源码快照已固定；可以播放、切换步骤和修改演示输入。');
    } else {
      const config = await (await request('/api/config')).json(); state.token = config.token;
      await loadDemo('typescript');
    }
  } catch (error) { showMessage(`工作台未能载入：${error.message}`, true); }
}
boot();
