import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import http from 'node:http';
let server, base, token;
before(async () => { server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; token = (await (await fetch(base + '/api/config')).json()).token; });
after(async () => { await new Promise(resolve => server.close(resolve)); });
const input = { files: [{ name: 'a.ts', content: 'export function run(x: string) { return { value: x }; }' }] };
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
test('workbench and built-in examples work without filesystem input from the client', async () => {
  const res = await fetch(base); assert.equal(res.status, 200); assert.match(await res.text(), /数据旅程/);
  const java = await (await fetch(base + '/api/demo/java')).json(); assert.equal(java.model.steps.length, 2);
});
test('local upload returns a validated model and never invokes source', async () => {
  const res = await post('/api/analyze', input); assert.equal(res.status, 200); assert.equal((await res.json()).steps.length, 1);
});
test('missing token and cross-origin requests are blocked', async () => {
  assert.equal((await post('/api/analyze', input, { 'X-Studio-Token': '' })).status, 403);
  assert.equal((await post('/api/analyze', input, { Origin: 'https://evil.example' })).status, 403);
  const rawStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/config', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(rawStatus, 403);
});
test('invalid JSON, invalid model and incorrect content type return useful errors', async () => {
  assert.equal((await post('/api/analyze', '{broken')).status, 400);
  assert.equal((await post('/api/export', { model: {} })).status, 400);
  assert.equal((await post('/api/analyze', input, { 'Content-Type': 'text/plain' })).status, 415);
});
test('static file allowlist prevents reading arbitrary project files', async () => {
  for (const url of ['/package.json', '/src/server.js', '/api/source?path=/etc/passwd', '/.git/config']) assert.equal((await fetch(base + url)).status, 404);
});
test('standalone export embeds inert JSON and contains no external assets', async () => {
  const model = await (await post('/api/analyze', { files: [{ name: 'x.ts', content: 'export function run() { return "</script><script>globalThis.pwned=true</script>"; }' }] })).json();
  const res = await post('/api/export', { model }); assert.equal(res.status, 200);
  const html = await res.text(); assert.match(html, /embedded-model/); assert.match(html, /\\u003c\/script/); assert.ok(!html.includes('src="./app.js"')); assert.ok(!html.includes('href="./style.css"'));
});
