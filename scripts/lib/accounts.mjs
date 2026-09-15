// 名義ごとのトークンを accounts.local.json に保存する。
// Phase 2 で Firestore の `accounts` コレクションへ移す前の、ローカル保管庫。
// このファイルはトークンを含むため .gitignore 済み。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ACCOUNTS_FILE = resolve(ROOT, 'accounts.local.json');

/** 保存済みアカウント一覧を返す（ファイルが無ければ空配列）。 */
export function readAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) return [];
  const raw = readFileSync(ACCOUNTS_FILE, 'utf8').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.accounts) ? parsed.accounts : [];
}

/** userId をキーに追加・更新する。 */
export function upsertAccount(account) {
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => a.userId === account.userId);
  if (idx >= 0) accounts[idx] = { ...accounts[idx], ...account };
  else accounts.push(account);
  accounts.sort((a, b) => a.username.localeCompare(b.username));
  writeFileSync(ACCOUNTS_FILE, `${JSON.stringify({ accounts }, null, 2)}\n`, 'utf8');
  return accounts;
}

/** ユーザー名（@あり/なし）またはユーザーIDで検索。 */
export function findAccount(key) {
  const needle = key.replace(/^@/, '').toLowerCase();
  return (
    readAccounts().find(
      (a) => a.username.toLowerCase() === needle || a.userId === key
    ) ?? null
  );
}
