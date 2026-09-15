// .env.local を読み込む最小ローダー（依存パッケージなし）。
// 秘密情報はすべてこのファイル経由でのみ参照する。コードへの直書き禁止。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_PATH = resolve(ROOT, '.env.local');

let loaded = false;

/** .env.local を process.env に流し込む（既存の環境変数は上書きしない）。 */
export function loadEnv() {
  if (loaded) return;
  loaded = true;

  if (!existsSync(ENV_PATH)) {
    throw new Error(
      `.env.local が見つかりません: ${ENV_PATH}\n` +
        '  cp .env.local.example .env.local\n' +
        'を実行し、値を記入してください。'
    );
  }

  const raw = readFileSync(ENV_PATH, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // 前後のクォートのみ剥がす
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** 必須の環境変数を取得。未設定なら理由を添えて即エラー。 */
export function requireEnv(key, hint = '') {
  loadEnv();
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `環境変数 ${key} が未設定です。.env.local に設定してください。${hint ? `\n  ヒント: ${hint}` : ''}`
    );
  }
  return value;
}

/** 任意の環境変数を取得。 */
export function optionalEnv(key, fallback = undefined) {
  loadEnv();
  const value = process.env[key];
  return value ? value : fallback;
}

/** ログ出力用にトークンをマスクする。 */
export function mask(secret) {
  if (!secret) return '(empty)';
  if (secret.length <= 12) return '*'.repeat(secret.length);
  return `${secret.slice(0, 6)}...${secret.slice(-4)} (len=${secret.length})`;
}

export const ENV_FILE_PATH = ENV_PATH;
