// コマンド共通: .env.local を読む、引数を読む、結果を表示する。
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] == null) process.env[m[1]] = v;
    }
  }
}
loadEnv();

export { parseArgs } from '../lib/server/ops.mjs';

export function out(v) { console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2)); }

export async function main(fn) {
  try {
    const { parseArgs } = await import('../lib/server/ops.mjs');
    const args = parseArgs(process.argv.slice(2));
    const r = await fn(args);
    if (r !== undefined) out(r);
    process.exit(0);
  } catch (e) {
    console.error('エラー:', e.message || e);
    if (process.env.DEBUG) console.error(e);
    process.exit(1);
  }
}
