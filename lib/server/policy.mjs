// CLAUDE.md と docs/claude-memory を読む（相談で使う）。
import fs from 'node:fs';
import path from 'node:path';

function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

export function loadPolicy() {
  const root = process.cwd();
  const claude = readSafe(path.join(root, 'CLAUDE.md'));
  const dir = path.join(root, 'docs', 'claude-memory');
  let memory = '';
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) memory += `\n### ${f}\n${readSafe(path.join(dir, f))}\n`;
  } catch { /* なし */ }
  return { policy: claude.slice(0, 12000), memory: memory.slice(0, 12000) };
}
