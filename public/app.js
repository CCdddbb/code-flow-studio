import { sampleInput, project, differences, mappings } from './simulation.js';

const $ = id => document.getElementById(id);
const state = { model: null, files: null, index: 0, playing: false, timer: null, token: null, tab: 'assembly', selectedFiles: [], offline: !!document.getElementById('embedded-model'), request: 0 };
const pretty = value => JSON.stringify(value, null, 2);
function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
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
  $('play-button').textContent = '▶ 播放流程';
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
  state.playing = true; $('play-button').textContent = 'Ⅱ 暂停'; document.body.classList.add('playing'); schedule();
}
function selectStep(index) { stop(); state.index = Math.max(0, Math.min(state.model.steps.length - 1, index)); renderStep(); }
function setTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) { button.classList.toggle('active', button.dataset.tab === tab); button.setAttribute('aria-selected', String(button.dataset.tab === tab)); }
  for (const name of ['assembly', 'data', 'evidence']) $(`${name}-view`).hidden = name !== tab;
  if (tab !== 'assembly') stop();
}
function installModel(model, files = null) {
  if (model.schemaVersion !== '1.0.0' || !Array.isArray(model.steps) || !model.steps.length) throw new Error('Unsupported visualization model');
  stop(); state.model = model; state.files = files; state.index = 0;
  $('project-name').textContent = model.project.name;
  $('language-label').textContent = model.project.languages.join(' / ');
  for (const [id, value] of [['stat-files', model.report.files], ['stat-functions', model.report.functions], ['stat-steps', model.steps.length], ['stat-unresolved', model.report.unresolvedCalls]]) $(id).textContent = value;
  $('entry-select').replaceChildren(...model.entries.map(entry => {
    const option = node('option', '', `${entry.label} · ${entry.file}:${entry.line}`); option.value = entry.id; return option;
  }));
  $('entry-select').value = model.entryStepId;
  $('entry-select').disabled = state.offline;
  $('data-step-select').replaceChildren(...model.steps.map((step, i) => { const option = node('option', '', step.label); option.value = i; return option; }));
  $('timeline').replaceChildren(...model.steps.map((step, i) => {
    const button = node('button'); button.append(node('span', '', `STEP ${String(i + 1).padStart(2, '0')}`), document.createTextNode(step.label));
    button.addEventListener('click', () => selectStep(i)); return button;
  }));
  $('flow-list').replaceChildren(...model.flows.slice(0, 80).map(flow => {
    const row = node('div', 'flow-row');
    const from = model.entities.find(n => n.id === flow.from), to = model.entities.find(n => n.id === flow.to);
    row.append(node('span', '', from.label), node('b', '', '→'), node('span', '', to.label), node('small', '', flow.resolution === 'unresolved' ? '未解析' : '静态匹配'));
    return row;
  }));
  if (!model.flows.length) $('flow-list').append(node('div', 'empty-note', '当前入口没有发现调用表达式，可能是纯数据投影。'));
  $('limitations').replaceChildren(...model.report.limitations.map(item => node('li', '', item)));
  $('diagnostic-summary').textContent = `${model.diagnostics.length} 条诊断 · ${model.report.unresolvedCalls} 个未解析调用 · 全部保留在证据视图`;
  $('snapshot-badge').textContent = `SNAPSHOT ${model.sourceSnapshot.id.slice(0, 10)}`;
  renderEvidence(); renderStep();
  $('play-button').disabled = model.steps.length < 2;
}
function renderStep() {
  const step = current(), model = state.model;
  $('current-label').textContent = step.label;
  $('current-location').textContent = `${step.file}:${step.line}`;
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
  const capabilities = [node('span', 'capability', '源码事实'), node('span', 'capability', `${step.parameters.length} 个入参`)];
  if (step.transforms.length) capabilities.push(node('span', 'capability', `${step.transforms.length} 个声明式投影`));
  if (step.guards.length) capabilities.push(node('span', 'capability warn', `${step.guards.length} 个条件（未求值）`));
  if (step.transaction) capabilities.push(node('span', 'capability warn', '@Transactional / 生效未验证'));
  $('capabilities').replaceChildren(...capabilities);
  const flows = model.flows.filter(f => f.from === step.entityId);
  $('dependencies').replaceChildren(...flows.slice(0, 7).map(flow => {
    const div = node('div', `dependency-item ${flow.resolution === 'unresolved' ? '' : 'resolved'}`);
    div.append(node('span', 'dot'), document.createTextNode(flow.label + (flow.resolution === 'unresolved' ? ' · 未解析' : ' · 静态匹配'))); return div;
  }));
  if (!flows.length) $('dependencies').append(node('div', 'empty-note', '无调用表达式 · 直接处理数据'));
  if (flows.length > 7) $('dependencies').append(node('div', 'empty-note', `另有 ${flows.length - 7} 个连接，见下方连接图。`));
  [...$('timeline').children].forEach((button, i) => { button.classList.toggle('active', i === state.index); button.setAttribute('aria-current', i === state.index ? 'step' : 'false'); });
  $('caption-title').textContent = `观察 ${step.label} 的输入、规则与交接`;
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
    const numbered = ev.excerpt.split('\n').map((line, j) => `${String(ev.startLine + j).padStart(4)}  ${line}`).join('\n');
    details.append(summary, node('p', '', ev.claim), node('pre', '', numbered), node('div', 'evidence-hash', `SHA-256 / file: ${ev.fileHash} · excerpt: ${ev.excerptHash}`)); return details;
  }));
  $('diagnostics-list').replaceChildren(...model.diagnostics.map(d => { const div = node('div', 'diagnostic-item'); div.append(node('code', '', `${d.code}${d.file ? ` / ${d.file}:${d.line || 1}` : ''}`), document.createTextNode(d.message)); return div; }));
}
async function loadDemo(kind) {
  if (state.offline) { showMessage('这是独立导出页面。切换示例或上传代码请启动本地工作台。'); return; }
  const version = ++state.request; stop();
  try {
    clearMessage(); const response = await request(`/api/demo/${kind}`); const result = await response.json();
    if (version !== state.request) return;
    installModel(result.model, result.files); setTab('assembly');
  } catch (error) { showMessage(error.message, true); }
}
function openUpload() {
  if (state.offline) { showMessage('离线页面支持回放与编辑演示输入。新代码分析请运行 npm start。'); return; }
  $('upload-error').hidden = true; $('upload-dialog').showModal();
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
  finally { button.disabled = false; button.textContent = '开始分析 →'; }
}
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = node('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportHtml() {
  if (!state.model) return;
  if (state.offline) { download(document.documentElement.outerHTML, 'code-flow.html', 'text/html'); return; }
  try {
    const response = await request('/api/export', { model: state.model });
    download(await response.text(), 'code-flow.html', 'text/html');
    showMessage('已导出独立 HTML（含脱敏证据）。分享前请人工审查源码片段；可双击离线打开。');
  } catch (error) { showMessage(error.message, true); }
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => setTab(button.dataset.tab));
for (const button of document.querySelectorAll('[data-demo]')) button.addEventListener('click', () => loadDemo(button.dataset.demo));
for (const id of ['upload-open', 'hero-upload']) $(id).addEventListener('click', openUpload);
$('upload-close').addEventListener('click', () => $('upload-dialog').close());
$('upload-form').addEventListener('submit', analyzeUpload);
$('file-input').addEventListener('change', event => selectFiles(event.target.files));
$('folder-input').addEventListener('change', event => selectFiles(event.target.files));
$('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
$('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); selectFiles(event.dataTransfer.files); });
$('home-button').addEventListener('click', () => setTab('assembly'));
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
$('export-json').addEventListener('click', () => { if (state.model) { download(pretty(state.model), 'analysis.json', 'application/json'); showMessage('JSON 包含脱敏源码证据。分享前仍须人工审查。'); } });
$('export-html').addEventListener('click', exportHtml);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
document.addEventListener('keydown', event => {
  if (!state.model || $('upload-dialog').open || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY'].includes(document.activeElement.tagName)) return;
  if (event.code === 'Space' && state.tab === 'assembly') { event.preventDefault(); play(); }
  if (event.key === 'ArrowRight') { event.preventDefault(); selectStep(state.index + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); selectStep(state.index - 1); }
});
async function boot() {
  try {
    if (state.offline) {
      installModel(JSON.parse($('embedded-model').textContent));
      document.querySelector('.local-badge').textContent = '● 离线快照';
      showMessage('独立离线页面 · 源码快照已固定；可以播放、切换步骤和修改演示输入。');
    } else {
      const config = await (await request('/api/config')).json(); state.token = config.token;
      await loadDemo('typescript');
    }
  } catch (error) { showMessage(`工作台未能载入：${error.message}`, true); }
}
boot();
