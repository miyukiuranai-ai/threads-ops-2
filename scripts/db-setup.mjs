#!/usr/bin/env node
// Firebase のサービスアカウントJSONから接続情報を .env.local に取り込む。
// 使い方: npm run db:setup -- "C:\path\to\threads-ops-firebase-adminsdk-xxxxx.json"
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';
import { upsertEnvFile, ENV_FILE_PATH } from './lib/env-file.mjs';

/**
 * 過去に改行のまま書き込まれた FIREBASE_PRIVATE_KEY の残骸を取り除く。
 * 鍵が複数行に分かれて残っていると、続く行がゴミの環境変数として解釈される。
 */
function removeBrokenPrivateKeyLines() {
  const raw = readFileSync(ENV_FILE_PATH, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('FIREBASE_PRIVATE_KEY='));
  if (start === -1) return;
  if (lines[start].includes('END PRIVATE KEY')) return; // 1行に収まっていれば正常

  let end = start;
  while (end < lines.length && !lines[end].includes('END PRIVATE KEY')) end += 1;
  if (end >= lines.length) return; // 終端が見つからなければ触らない
  if (lines[end + 1] === '"' || lines[end + 1] === '') end += 1;

  const removed = end - start + 1;
  lines.splice(start, removed);
  writeFileSync(ENV_FILE_PATH, lines.join(eol), 'utf8');
  console.log(`  壊れていた FIREBASE_PRIVATE_KEY の${removed}行を除去しました。`);
}

function main() {
  const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('サービスアカウントJSONのパスを渡してください:\n  npm run db:setup -- "<path>.json"');
    process.exit(1);
  }
  if (!existsSync(path)) throw new Error(`ファイルが見つかりません: ${path}`);

  const json = JSON.parse(readFileSync(path, 'utf8'));
  if (json.type !== 'service_account') {
    throw new Error('サービスアカウントのJSONではありません（type が service_account でない）。');
  }
  for (const key of ['project_id', 'client_email', 'private_key']) {
    if (!json[key]) throw new Error(`JSONに ${key} が含まれていません。鍵を発行し直してください。`);
  }

  loadEnv();
  removeBrokenPrivateKeyLines();

  // 実際の改行を「バックスラッシュ + n」の2文字に置き換え、1行に収めてダブルクォートで囲う
  const escapedKey = json.private_key.replace(/\r?\n/g, String.raw`\n`);
  if (escapedKey.includes('\n')) {
    throw new Error('鍵の改行を除去できませんでした。SETUP-FIREBASE.md の第4章を参照して手動で設定してください。');
  }
  upsertEnvFile({
    FIREBASE_PROJECT_ID: json.project_id,
    FIREBASE_CLIENT_EMAIL: json.client_email,
    FIREBASE_PRIVATE_KEY: `"${escapedKey}"`,
  });

  console.log(`.env.local を更新しました: ${ENV_FILE_PATH}`);
  console.log(`  FIREBASE_PROJECT_ID=${json.project_id}`);
  console.log(`  FIREBASE_CLIENT_EMAIL=${json.client_email}`);
  console.log('  FIREBASE_PRIVATE_KEY=(取り込み済み)');
  console.log('\n⚠ 取り込みが済んだので、ダウンロードしたJSONファイルは削除してください。');
  console.log('次のステップ: npm run db:check');
}

try {
  main();
} catch (err) {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
}
