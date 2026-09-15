#!/usr/bin/env node
// 認可コードを長期アクセストークン（60日）に交換し、Threads ユーザーIDも取得する。
// 使い方:
//   npm run auth:exchange -- "<認可コード>"
//   npm run auth:exchange -- "<認可コード>" --write   # .env.local を自動更新
import { requireEnv, mask } from './lib/env.mjs';
import { upsertEnvFile, ENV_FILE_PATH } from './lib/env-file.mjs';
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getMe,
} from './lib/threads.mjs';

/** .env.local の該当キーを差し替える（無ければ追記）。 */
async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const rawCode = args.find((a) => !a.startsWith('--'));

  if (!rawCode) {
    console.error('認可コードを渡してください:\n  npm run auth:exchange -- "<code>" [--write]');
    process.exit(1);
  }
  // リダイレクトURLからコピーすると末尾に "#_" が付くことがある
  const code = rawCode.replace(/#_$/, '').trim();

  const appId = requireEnv('THREADS_APP_ID');
  const appSecret = requireEnv('THREADS_APP_SECRET');
  const redirectUri = requireEnv('THREADS_REDIRECT_URI');

  console.log('[1/3] 認可コード → 短期トークン ...');
  const shortLived = await exchangeCodeForShortLivedToken({ appId, appSecret, redirectUri, code });
  console.log(`      OK  user_id=${shortLived.user_id ?? '(不明)'} token=${mask(shortLived.access_token)}`);

  console.log('[2/3] 短期トークン → 長期トークン ...');
  const longLived = await exchangeForLongLivedToken({
    appSecret,
    shortLivedToken: shortLived.access_token,
  });
  const expiresInSec = Number(longLived.expires_in ?? 0);
  const expiresAt = new Date(Date.now() + expiresInSec * 1000);
  console.log(`      OK  有効期限 ${Math.round(expiresInSec / 86400)}日 (${expiresAt.toISOString()})`);

  console.log('[3/3] トークンの持ち主を確認 ...');
  const me = await getMe({ accessToken: longLived.access_token, fields: 'id,username' });
  console.log(`      OK  @${me.username} (id=${me.id})`);

  const updates = {
    THREADS_ACCESS_TOKEN: longLived.access_token,
    THREADS_USER_ID: me.id,
    THREADS_TOKEN_EXPIRES_AT: expiresAt.toISOString(),
  };

  if (write) {
    upsertEnvFile(updates);
    console.log(`\n.env.local を更新しました: ${ENV_FILE_PATH}`);
  } else {
    console.log('\n以下を .env.local に貼り付けてください（--write で自動更新も可）:\n');
    for (const [k, v] of Object.entries(updates)) console.log(`${k}=${v}`);
    console.log('');
  }

  console.log('次のステップ: npm run post:test');
}

main().catch((err) => {
  console.error(`\n失敗しました: ${err.message}`);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
