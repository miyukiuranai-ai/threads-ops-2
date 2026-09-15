#!/usr/bin/env node
// 予定時刻を過ぎた承認済み投稿を投稿する。手元から実行するための入口。
// 本番では Vercel Cron が /api/cron/publish を叩く。
//
// 使い方:
//   npm run publish                 # POSTING_MODE に従う（既定は dry_run）
//   npm run publish -- --force      # dry_run を無視して実際に投稿する
//   npm run publish -- --delay 5    # コンテナ作成後の待機を5秒に短縮（確認用）
import { loadEnv } from './lib/env.mjs';
import { publishDuePosts } from '../lib/server/publish.mjs';
import { postingMode } from '../lib/server/guard.mjs';

function parseArgs(argv) {
  const args = { force: false, delaySec: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--delay') args.delaySec = Number(argv[++i]);
  }
  return args;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  console.log(`投稿モード: ${postingMode()}${args.force ? '（--force で実投稿）' : ''}`);
  if (args.force && postingMode() !== 'live') {
    console.log('⚠ POSTING_MODE は dry_run ですが、--force のため実際に投稿します。');
  }

  const { summary, results } = await publishDuePosts({
    force: args.force,
    delayMs: args.delaySec !== null ? args.delaySec * 1000 : undefined,
  });

  if (!results.length) {
    console.log('投稿対象はありませんでした（承認済みかつ予定時刻を過ぎたもの）。');
    return;
  }

  for (const r of results) {
    const head = `[${r.result}] @${r.account}`;
    if (r.result === 'posted') console.log(`${head} → ${r.permalink ?? r.threadId}`);
    else if (r.result === 'dry_run') console.log(`${head} 実投稿せず: ${String(r.body).split('\n')[0].slice(0, 40)}`);
    else console.log(`${head} ${r.reason ?? ''}`);
  }

  console.log(`\n集計: ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
