#!/usr/bin/env node
// Meta の「ユーザートークン生成ツール」で発行した長期トークンを取り込む。
// 認可URL(OAuth)フローの代わりに使える簡易ルート。
// 名義ごとに accounts.local.json へ蓄積し、あわせて .env.local も更新する。
//
// 使い方:
//   npm run token:import -- "<生成された長期トークン>"
//   npm run token:import -- "<token>" --print    # ファイルを更新せず表示のみ
//   npm run token:import -- "<token>" --no-env   # accounts.local.json のみ更新
import { loadEnv } from './lib/env.mjs';
import { upsertEnvFile, ENV_FILE_PATH } from './lib/env-file.mjs';
import { getMe } from './lib/threads.mjs';
import { upsertAccount, ACCOUNTS_FILE } from './lib/accounts.mjs';

const LONG_LIVED_DAYS = 60;

async function main() {
  const args = process.argv.slice(2);
  const printOnly = args.includes('--print');
  const skipEnv = args.includes('--no-env');
  const token = args.find((a) => !a.startsWith('--'))?.trim();

  if (!token) {
    console.error('トークンを渡してください:\n  npm run token:import -- "<長期トークン>" [--print] [--no-env]');
    process.exit(1);
  }
  loadEnv();

  console.log('[1/3] トークンの持ち主を確認 ...');
  const me = await getMe({ accessToken: token, fields: 'id,username' });
  console.log(`      OK  @${me.username} (id=${me.id})`);

  // 生成ツールのトークンは長期(60日)。発行時刻は取得できないため「今から60日」を目安として記録する。
  const expiresAt = new Date(Date.now() + LONG_LIVED_DAYS * 86400000);

  const updates = {
    THREADS_ACCESS_TOKEN: token,
    THREADS_USER_ID: me.id,
    THREADS_TOKEN_EXPIRES_AT: expiresAt.toISOString(),
  };

  if (printOnly) {
    console.log('\n--print のため書き込みません。以下を .env.local に貼り付けてください:\n');
    for (const [k, v] of Object.entries(updates)) console.log(`${k}=${v}`);
    return;
  }

  console.log('[2/3] accounts.local.json を更新 ...');
  const accounts = upsertAccount({
    username: me.username,
    userId: me.id,
    accessToken: token,
    expiresAt: expiresAt.toISOString(),
  });
  console.log(`      OK  ${ACCOUNTS_FILE}`);
  console.log(`      保存済みの名義: ${accounts.map((a) => `@${a.username}`).join(', ')}`);

  if (skipEnv) {
    console.log('[3/3] --no-env のため .env.local は更新しません。');
  } else {
    console.log('[3/3] .env.local を更新 ...');
    upsertEnvFile(updates);
    console.log(`      OK  ${ENV_FILE_PATH}`);
  }
  console.log(`      有効期限の目安: ${expiresAt.toISOString()}（発行から60日。実際の発行時刻に依存）`);

  console.log(`\n次のステップ: npm run post:test -- --account ${me.username} --dry-run`);
}

main().catch((err) => {
  console.error(`\n失敗しました: ${err.message}`);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
