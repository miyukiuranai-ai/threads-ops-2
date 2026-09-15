#!/usr/bin/env node
// 認可URLを組み立てて表示する。ブラウザで開き、対象の Threads アカウントで承認する。
// 使い方: npm run auth:url
import { requireEnv, optionalEnv } from './lib/env.mjs';
import { buildAuthorizeUrl } from './lib/threads.mjs';

// Phase 1 は投稿のみ。Phase 3以降で threads_manage_replies 等を追加する。
const SCOPES = ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies', 'threads_manage_insights', 'threads_delete'];

function main() {
  const appId = requireEnv('THREADS_APP_ID', 'Meta for Developers > アプリ > Threads > 設定 の「Threads アプリID」');
  const redirectUri = requireEnv('THREADS_REDIRECT_URI', 'Meta 側に登録したリダイレクトURIと完全一致させる');
  const state = optionalEnv('THREADS_OAUTH_STATE', 'phase1');

  const url = buildAuthorizeUrl({ appId, redirectUri, scopes: SCOPES, state });

  console.log('\n以下のURLをブラウザで開き、投稿させたい Threads アカウントで承認してください。\n');
  console.log(url);
  console.log('\n承認後、リダイレクト先のURLに ?code=... が付きます。');
  console.log('リダイレクト先のページが表示できなくても構いません（アドレスバーの code の値が必要）。');
  console.log('末尾に "#_" が付く場合はそれを除いた値をコピーしてください。\n');
  console.log('次のステップ:');
  console.log('  npm run auth:exchange -- "<コピーしたcode>"\n');
}

try {
  main();
} catch (err) {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
}
