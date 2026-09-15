#!/usr/bin/env node
// Phase 1 の動作確認: 取得済みの長期トークンで Threads に1投稿する。
// 手順は公式APIの2段階（メディアコンテナ作成 → publish）。
//
// 使い方:
//   npm run post:test                      # .env.local の名義・文言で投稿
//   npm run post:test -- --account uta001012   # accounts.local.json の指定名義で投稿
//   npm run post:test -- --list            # 保存済みの名義一覧を表示
//   npm run post:test -- --text "本文"      # 本文を指定
//   npm run post:test -- --dry-run         # 投稿せず、トークンと本文の検証だけ行う
//   npm run post:test -- --yes             # 確認プロンプトを省略
//   npm run post:test -- --wait 10         # コンテナ作成後の待機秒数（既定30秒）
import { createInterface } from 'node:readline/promises';
import { requireEnv, optionalEnv } from './lib/env.mjs';
import { readAccounts, findAccount } from './lib/accounts.mjs';
import { getMe, createTextContainer, publishContainer, getThread } from './lib/threads.mjs';

const DEFAULT_TEXT = 'Threads API 接続テストです。（自動投稿ツールの疎通確認）';
const MAX_LENGTH = 500; // Threads のテキスト投稿上限

function parseArgs(argv) {
  const args = { dryRun: false, yes: false, text: null, wait: 30, account: null, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--text') args.text = argv[++i];
    else if (a.startsWith('--text=')) args.text = a.slice('--text='.length);
    else if (a === '--account') args.account = argv[++i];
    else if (a.startsWith('--account=')) args.account = a.slice('--account='.length);
    else if (a === '--list') args.list = true;
    else if (a === '--wait') args.wait = Number(argv[++i]);
    else if (a.startsWith('--wait=')) args.wait = Number(a.slice('--wait='.length));
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function confirm(question) {
  if (!process.stdin.isTTY) return true; // 非対話実行（CI等）はそのまま進める
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const accounts = readAccounts();
    if (!accounts.length) {
      console.log('accounts.local.json に保存された名義はまだありません。npm run token:import で追加してください。');
      return;
    }
    console.log('保存済みの名義:');
    for (const a of accounts) {
      const days = Math.floor((new Date(a.expiresAt).getTime() - Date.now()) / 86400000);
      console.log(`  @${a.username}  (id=${a.userId})  トークン残り約${days}日`);
    }
    return;
  }

  // --account 指定時は accounts.local.json から、無指定なら .env.local から読む
  let accessToken;
  let userId;
  let tokenExpiresAt;
  if (args.account) {
    const account = findAccount(args.account);
    if (!account) {
      throw new Error(
        `名義 "${args.account}" は accounts.local.json にありません。npm run post:test -- --list で確認してください。`
      );
    }
    accessToken = account.accessToken;
    userId = account.userId;
    tokenExpiresAt = account.expiresAt;
  } else {
    accessToken = requireEnv('THREADS_ACCESS_TOKEN', 'npm run token:import で取得する');
    userId = requireEnv('THREADS_USER_ID', 'npm run token:import で取得する');
    tokenExpiresAt = optionalEnv('THREADS_TOKEN_EXPIRES_AT');
  }
  const text = args.text ?? optionalEnv('TEST_POST_TEXT', DEFAULT_TEXT);

  if (!text.trim()) throw new Error('投稿本文が空です。--text または TEST_POST_TEXT を指定してください。');
  if ([...text].length > MAX_LENGTH) {
    throw new Error(`本文が長すぎます（${[...text].length}文字 / 上限${MAX_LENGTH}文字）。`);
  }

  if (tokenExpiresAt) {
    const days = Math.floor((new Date(tokenExpiresAt).getTime() - Date.now()) / 86400000);
    console.log(`トークン残り: 約${days}日 (${tokenExpiresAt})`);
    if (days < 0) throw new Error('トークンが失効しています。トークンを取り直してください。');
    if (days < 10) console.warn('⚠ 失効まで10日を切っています。リフレッシュを検討してください。');
  }

  console.log('[1/4] トークンの有効性を確認 ...');
  const me = await getMe({ accessToken, fields: 'id,username' });
  console.log(`      OK  @${me.username} (id=${me.id})`);
  if (me.id !== userId) {
    throw new Error(
      `指定されたユーザーID (${userId}) がトークンの持ち主 (${me.id}) と一致しません。設定を確認してください。`
    );
  }

  console.log('\n----- 投稿内容 -----');
  console.log(text);
  console.log(`--------------------\n投稿先: @${me.username}\n`);

  if (args.dryRun) {
    console.log('--dry-run のため投稿はしません。検証のみ完了しました。');
    return;
  }
  if (!args.yes && !(await confirm('この内容で実際に投稿します。よろしいですか？'))) {
    console.log('中止しました。');
    return;
  }

  console.log('[2/4] メディアコンテナを作成 ...');
  const container = await createTextContainer({ accessToken, userId, text });
  console.log(`      OK  creation_id=${container.id}`);

  const waitSec = Number.isFinite(args.wait) ? Math.max(0, args.wait) : 30;
  console.log(`[3/4] 公開前の待機 ${waitSec}秒 ...（公式推奨: 約30秒）`);
  await sleep(waitSec * 1000);

  console.log('[4/4] コンテナを公開 ...');
  const published = await publishContainer({ accessToken, userId, creationId: container.id });
  console.log(`      OK  thread_id=${published.id}`);

  try {
    const thread = await getThread({ accessToken, threadId: published.id });
    console.log(`\n✅ 投稿完了: ${thread.permalink ?? '(permalink取得不可)'}`);
    console.log(`   timestamp: ${thread.timestamp ?? '-'}`);
  } catch {
    console.log('\n✅ 投稿完了（permalink の取得には失敗しましたが投稿自体は成功しています）');
  }
}

main().catch((err) => {
  console.error(`\n失敗しました: ${err.message}`);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
