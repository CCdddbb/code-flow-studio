import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const LIMITS = Object.freeze({ files: 120, fileBytes: 200_000, totalBytes: 2_000_000, functions: 800, steps: 40 });
export const EXTENSIONS = new Set(['.java', '.js', '.jsx', '.ts', '.tsx']);
const excluded = new Set(['node_modules', '.git', 'target', 'dist', 'build', 'coverage', '.idea', '.next', 'vendor']);
export const hash = value => createHash('sha256').update(value).digest('hex');
export function safeName(name) {
  if (typeof name !== 'string' || name.length > 240 || /[\x00-\x1f\\]/.test(name) || path.posix.isAbsolute(name) || /^[A-Za-z]:/.test(name)) throw new Error('Invalid relative file path');
  const parts = name.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw new Error('Hidden or traversal paths are not allowed');
  if (!EXTENSIONS.has(path.posix.extname(name).toLowerCase()) || /(?:^|\/)(?:credentials|secrets?)(?:\.|\/)/i.test(name)) throw new Error('Unsupported source file');
  return name;
}
export function redact(text) {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, match => '[REDACTED PRIVATE KEY]' + '\n'.repeat((match.match(/\n/g) || []).length))
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED ACCESS KEY]')
    .replace(/\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{16,}\b/g, '[REDACTED TOKEN]')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|authorization|connection[_-]?string)\s*["']?\s*[:=]\s*)["'][^"'\r\n]*["']/gi, '$1"[REDACTED]"')
    .replace(/\b(?:jdbc:[^\s"'<>]+|(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql):\/\/[^\s"'<>]+)/gi, '[REDACTED CONNECTION]');
}
export function validateFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > LIMITS.files) throw new Error(`Upload 1–${LIMITS.files} source files`);
  let total = 0;
  const names = new Set();
  return files.map(file => {
    const name = safeName(file?.name);
    if (names.has(name)) throw new Error(`Duplicate path: ${name}`);
    names.add(name);
    if (typeof file.content !== 'string') throw new Error('Source content must be text');
    const bytes = Buffer.byteLength(file.content);
    if (bytes > LIMITS.fileBytes || file.content.includes('\0')) throw new Error(`File too large or binary: ${name}`);
    total += bytes;
    if (total > LIMITS.totalBytes) throw new Error('Source input exceeds 2 MB');
    return { name, content: file.content };
  });
}
export async function scanDirectory(directory) {
  const root = await realpath(directory);
  const files = [], skipped = [];
  async function walk(relative = '') {
    for (const item of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (item.isSymbolicLink()) { skipped.push(`${name}: symbolic link`); continue; }
      if (item.name.startsWith('.') || excluded.has(item.name)) continue;
      if (item.isDirectory()) { await walk(name); continue; }
      if (!item.isFile() || !EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      safeName(name);
      const full = await realpath(path.join(root, name));
      if (!full.startsWith(root + path.sep)) throw new Error('Source path escaped root');
      files.push({ name, content: await readFile(full, 'utf8') });
      if (files.length > LIMITS.files) throw new Error('Too many source files; select a smaller module');
    }
  }
  await walk();
  return { files: validateFiles(files), skipped };
}
