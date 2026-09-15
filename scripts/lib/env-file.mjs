// .env.local の書き換え（キー単位の追加・更新）。
import { readFileSync, writeFileSync } from 'node:fs';
import { ENV_FILE_PATH } from './env.mjs';

/** .env.local の該当キーを差し替える（無ければ追記）。値に改行は含められない。 */
export function upsertEnvFile(updates) {
  const raw = readFileSync(ENV_FILE_PATH, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(ENV_FILE_PATH, lines.join(eol), 'utf8');
}

export { ENV_FILE_PATH };
