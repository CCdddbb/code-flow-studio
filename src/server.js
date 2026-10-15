import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze } from './analyzer.js';
import { scanDirectory, LIMITS } from './safety.js';
import { standalone, ROOT } from './export.js';

const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']], ['/app.js', ['app.js', 'text/javascript']], ['/simulation.js', ['simulation.js', 'text/javascript']]]);
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
export function createServer() {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      const host = new URL(`http://${req.headers.host}`);
      if (!loopback.has(host.hostname)) { send(403, { error: 'Loopback Host required (DNS rebinding protection)' }); return; }
      if (req.headers.origin && req.headers.origin !== host.origin) { send(403, { error: 'Cross-origin requests are forbidden' }); return; }
      const url = new URL(req.url, host);
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        send(200, await readFile(path.join(ROOT, 'public', file), 'utf8'), type); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/config') { send(200, { token, limits: LIMITS, version: '0.1.0' }); return; }
      if (req.method === 'GET' && /^\/api\/demo\/(typescript|java)$/.test(url.pathname)) {
        const kind = url.pathname.split('/').pop();
        const { files } = await scanDirectory(path.join(ROOT, 'fixtures', kind));
        send(200, { files, model: analyze(files, { name: kind === 'java' ? '草稿提交 · Java 合成示例' : '订单创建 · 字段映射示例' }) }); return;
      }
      if (req.method === 'POST' && ['/api/analyze', '/api/export'].includes(url.pathname)) {
        if (req.headers['x-studio-token'] !== token) { send(403, { error: 'Invalid local session token' }); return; }
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { send(415, { error: 'JSON content type required' }); return; }
        let bytes = 0, chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > LIMITS.totalBytes * 3) { send(413, { error: 'Request exceeds 6 MB' }); req.resume(); return; }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object required');
        if (url.pathname === '/api/analyze') send(200, analyze(body.files, { entry: body.entry, name: body.name }));
        else send(200, await standalone(body.model), 'text/html');
        return;
      }
      send(404, { error: 'Not found' });
    } catch (error) { send(400, { error: error.message || 'Analysis failed' }); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  const server = createServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} occupied. Try PORT=4180 npm start` : error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Code Flow Studio: http://127.0.0.1:${port}\nLocal-only · no source execution · Ctrl+C to stop`));
}
