const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { mkdir, writeFile, readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const { createServer } = await import('../src/server.js');
  const { analyze } = await import('../src/analyzer.js');
  const { standalone, ROOT } = await import('../src/export.js');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
  let browser;
  const results = [];
  async function check(label, fn) { await fn(); results.push(label); console.log(`✓ ${label}`); }
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith(base)) external.push(req.url()); });
    await page.goto(base);
    await page.waitForFunction(() => document.getElementById('stat-steps').textContent === '2');
    await check('desktop assembly renders contract, local call and unresolved ports', async () => {
      assert.match(await page.locator('#contract-fields').innerText(), /input.customer/);
      assert.match(await page.locator('#dependencies').innerText(), /orderRepository.save/);
      assert.equal(await page.locator('#timeline button').count(), 2);
      assert.equal(await page.locator('#timeline button.active').count(), 1);
    });
    await check('quality panel separates source facts, static matches, inference and unknown nodes', async () => {
      assert.equal(await page.locator('#quality-panel').evaluate(el => el.open), false);
      await page.click('#quality-panel > summary');
      assert.match(await page.locator('#review-advice').innerText(), /不适合作为完整/);
      assert.equal(await page.locator('#quality-metrics strong').nth(1).innerText(), '1 / 4');
      assert.equal(await page.locator('#node-basis-list .node-basis-row').count(), 5);
      assert.match(await page.locator('#basis-legend').innerText(), /源码事实/);
      assert.match(await page.locator('#basis-legend').innerText(), /未知/);
      await page.click('#quality-panel > summary');
    });
    async function downloadConfirmed(button, mode = 'internal') {
      await page.click(button);
      await page.waitForFunction(() => document.getElementById('export-risk').textContent.length > 10);
      assert.equal(await page.locator('#export-mode').inputValue(), 'review');
      assert.equal(await page.locator('#export-submit').isDisabled(), true);
      if (mode !== 'review') {
        await page.selectOption('#export-mode', mode);
        await page.waitForFunction(mode => document.getElementById('export-risk').textContent === ({internal:'包含源码、字面量及诊断。尽力脱敏不保证去除所有秘密；仅限获授权的内部使用。',business:'字段与流程名称仍可能包含业务信息。没有人工确认说明或状态模型时不补造业务解释。'})[mode], mode);
      }
      await page.check('#export-confirmation');
      const promise = page.waitForEvent('download'); await page.click('#export-submit'); return promise;
    }
    await mkdir(path.join(ROOT, 'artifacts/screenshots'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'artifacts/screenshots/studio-desktop.png'), fullPage: true });
    await check('compact workspace exposes the flow above the fold and supports keyboard tabs', async () => {
      assert.ok(await page.locator('.assembly-board').evaluate(el => el.getBoundingClientRect().bottom < 1000));
      assert.match(await page.locator('#source-files').innerText(), /order.ts/);
      assert.equal(await page.locator('#outline-nav button').count(), 2);
      await page.locator('#tab-assembly').focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#tab-data').getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('#data-view').isVisible(), true);
      await page.keyboard.press('Home');
      assert.equal(await page.locator('#assembly-view').isVisible(), true);
      await page.locator('#outline-nav button').nth(1).click(); assert.match(await page.locator('#current-label').innerText(), /toEnvelope/);
      await page.click('#reset-button');
    });
    await check('step selection, reset and reduced-duration playback work', async () => {
      await page.click('#next-button'); assert.match(await page.locator('#current-label').innerText(), /toEnvelope/);
      await page.click('#reset-button'); assert.match(await page.locator('#current-label').innerText(), /createOrder/);
      await page.selectOption('#speed-select', '2000'); await page.click('#play-button');
      await page.waitForFunction(() => document.getElementById('current-label').textContent === 'toEnvelope');
      await page.waitForFunction(() => !document.body.classList.contains('playing'));
    });
    await check('editable JSON projection and field lineage track actual supported rules', async () => {
      await page.click('[data-tab="data"]');
      const input = JSON.parse(await page.locator('#input-editor').inputValue());
      input.input.customer = 'Ada'; input.input.amount = 725; input.input.note = 'demo note';
      await page.fill('#input-editor', JSON.stringify(input)); await page.click('#apply-input');
      const output = JSON.parse(await page.locator('#output-json').innerText());
      assert.deepEqual(output, { customerName: 'Ada', total: 725, memo: 'demo note', status: 'PENDING' });
      assert.match(await page.locator('#field-mappings').innerText(), /input.customer/);
      assert.match(await page.locator('#diff-list').innerText(), /customerName/);
      await page.screenshot({ path: path.join(ROOT, 'artifacts/screenshots/studio-data.png'), fullPage: true });
      await page.fill('#input-editor', '{invalid'); await page.click('#apply-input');
      assert.match(await page.locator('#projection-status').innerText(), /输入无效/);
      assert.match(await page.locator('#output-json').innerText(), /未生成/);
      await page.click('#sample-button');
    });
    await check('evidence includes original line ranges and SHA-256 fingerprints', async () => {
      await page.click('[data-tab="evidence"]'); assert.ok(await page.locator('.evidence-card').count() >= 4);
      assert.match(await page.locator('.evidence-card').first().innerText(), /SHA-256/);
    });
    await check('Java example resolves source-declared service and flags transaction limits', async () => {
      await page.click('[data-demo="java"]'); await page.waitForFunction(() => document.getElementById('language-label').textContent === 'Java');
      await page.click('#next-button');
      assert.match(await page.locator('#current-label').innerText(), /DraftService.submit/);
      assert.match(await page.locator('#capabilities').innerText(), /生效未验证/);
      await page.click('[data-tab="data"]'); assert.match(await page.locator('#projection-status').innerText(), /未生成投影/);
    });
    await check('file upload runs a fresh analysis without business requests', async () => {
      await page.click('#hero-upload');
      await page.setInputFiles('#file-input', { name: 'uploaded.ts', mimeType: 'text/plain', buffer: Buffer.from('interface Input { name: string; } export function map(input: Input) { return { title: input.name }; }') });
      await page.fill('#name-input', 'Uploaded sample'); await page.click('#analyze-button');
      await page.waitForFunction(() => document.getElementById('project-name').textContent === 'Uploaded sample');
      assert.equal(await page.locator('#stat-steps').innerText(), '1');
      assert.equal(await page.locator('#play-button').isDisabled(), true);
    });
    await check('pasted source rejects traversal paths with an inline error', async () => {
      await page.click('#hero-upload'); await page.click('.paste-details summary');
      await page.fill('#paste-name', '../bad.ts'); await page.fill('#paste-code', 'export function run() { return 1; }'); await page.click('#analyze-button');
      await page.waitForFunction(() => !document.getElementById('upload-error').hidden);
      assert.match(await page.locator('#upload-error').innerText(), /path/i);
      await page.click('#upload-close');
    });
    await check('JSON and standalone HTML download are available', async () => {
      const json = await downloadConfirmed('#export-json'); assert.equal(json.suggestedFilename(), 'analysis.json');
      const html = await downloadConfirmed('#export-html'); assert.equal(html.suggestedFilename(), 'code-flow.html');
      await html.saveAs(path.join(ROOT, 'artifacts/browser-export.html'));
    });
    await check('standalone HTML works over file:// with no server or module loader', async () => {
      const offline = await browser.newPage(); const offlineErrors = [];
      offline.on('pageerror', e => offlineErrors.push(e.message));
      await offline.goto(pathToFileURL(path.join(ROOT, 'artifacts/browser-export.html')).href);
      await offline.waitForFunction(() => document.getElementById('project-name').textContent === 'Uploaded sample');
      await offline.click('[data-tab="data"]'); assert.match(await offline.locator('#output-json').innerText(), /title/);
      assert.deepEqual(offlineErrors, []); await offline.close();
    });
    await check('untrusted HTML in source is displayed as text and never executed', async () => {
      const malicious = analyze([{ name: 'safe.ts', content: 'export function run() { return "</script><script>globalThis.pwned=true</script><img src=x onerror=alert(1)>"; }' }]);
      await writeFile(path.join(ROOT, 'artifacts/xss-export.html'), await standalone(malicious, { mode: 'internal' }));
      const offline = await browser.newPage(); await offline.goto(pathToFileURL(path.join(ROOT, 'artifacts/xss-export.html')).href);
      await offline.waitForFunction(() => document.getElementById('stat-steps').textContent === '1');
      await offline.click('[data-tab="data"]'); assert.equal(await offline.evaluate(() => globalThis.pwned), undefined);
      assert.equal(await offline.locator('#output-json img').count(), 0); await offline.close();
    });
    await check('review and business JSON downloads follow selected policies and reset risk confirmation', async () => {
      for (const mode of ['review', 'business']) {
        const download = await downloadConfirmed('#export-json', mode);
        const payload = JSON.parse(await readFile(await download.path(), 'utf8'));
        assert.equal(payload.sharing.mode, mode); assert.ok(payload.evidence.every(e => !('excerpt' in e)));
        if (mode === 'business') assert.equal(payload.sourceSnapshot, null);
      }
      await page.click('#export-html'); await page.check('#export-confirmation');
      await page.selectOption('#export-mode', 'internal');
      assert.equal(await page.locator('#export-confirmation').isChecked(), false);
      assert.equal(await page.locator('#export-submit').isDisabled(), true);
      await page.click('#export-close');
    });
    await check('all three modes and both languages open offline without network requests', async () => {
      for (const language of ['typescript', 'java']) {
        const { model } = await (await fetch(`${base}/api/demo/${language}`)).json();
        for (const mode of ['internal', 'review', 'business']) {
          const file = path.join(ROOT, `artifacts/offline-${language}-${mode}.html`);
          const html = await standalone(model, { mode }); await writeFile(file, html);
          const offline = await browser.newPage(), requests = [], failures = [];
          offline.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
          offline.on('pageerror', error => failures.push(error.message));
          await offline.goto(pathToFileURL(file).href);
          await offline.waitForFunction(() => document.getElementById('stat-steps').textContent === '2');
          await offline.click('#next-button');
          if (mode !== 'internal') {
            await offline.click('[data-tab="evidence"]'); assert.equal(await offline.locator('#evidence-list pre').count(), 0);
            await offline.click('[data-tab="data"]'); assert.match(await offline.locator('#projection-status').innerText(), /不执行数据投影/);
            await offline.click('#quality-panel > summary');
            assert.match(await offline.locator('#evidence-scope').innerText(), /无法独立核验/);
          }
          assert.deepEqual(requests, []); assert.deepEqual(failures, []);
          await offline.close();
        }
      }
    });
    await check('safe offline re-export is immutable and cannot upgrade disclosure', async () => {
      const offline = await browser.newPage({ acceptDownloads: true });
      await offline.goto(pathToFileURL(path.join(ROOT, 'artifacts/offline-typescript-review.html')).href);
      await offline.waitForFunction(() => document.getElementById('stat-steps').textContent === '2');
      await offline.evaluate(() => { document.getElementById('output-json').textContent = 'DO_NOT_EXPORT_TEMPORARY_INPUT'; });
      await offline.click('#export-html');
      assert.equal(await offline.locator('#export-mode').isDisabled(), true);
      assert.equal(await offline.locator('#export-mode').inputValue(), 'review');
      await offline.check('#export-confirmation');
      const promise = offline.waitForEvent('download'); await offline.click('#export-submit');
      const download = await promise;
      const html = await readFile(await download.path(), 'utf8'); assert.ok(!html.includes('DO_NOT_EXPORT_TEMPORARY_INPUT'));
      assert.ok(!html.includes('Declaration and body of'));
      await offline.close();
    });
    await check('mobile view has no page overflow or hidden primary controls', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-tab="assembly"]');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(ROOT, 'artifacts/screenshots/studio-mobile.png'), fullPage: true });
      await page.click('#sidebar-toggle'); assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#workspace-sidebar').isVisible(), true); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#sidebar-toggle').getAttribute('aria-expanded'), 'false');
      await page.click('#hero-upload'); assert.ok(await page.evaluate(() => document.querySelector('dialog').getBoundingClientRect().right <= innerWidth)); await page.click('#upload-close');
    });
    await check('browser does not call external services and has no script exceptions', async () => { assert.deepEqual(external, []); assert.deepEqual(errors, []); });
    await writeFile(path.join(ROOT, 'artifacts/browser-report.json'), JSON.stringify({ passed: results.length, checks: results }, null, 2));
    console.log(`Browser checks passed: ${results.length}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
