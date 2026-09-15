#!/usr/bin/env node
// 各名義の過去投稿とインサイトを取得し、スコア化して Firestore に保存する。
// 読み取りのみ。投稿は一切行わない。
//
// 使い方:
//   npm run analyze:fetch                 # 直近30日
//   npm run analyze:fetch -- --days 60    # 期間を変える
//   npm run analyze:fetch -- --account seiran_uranai_
import { loadEnv } from './lib/env.mjs';
import { collectInsights } from '../lib/server/insights.mjs';

function parseArgs(argv) {
  const args = { days: 30, account: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--days') args.days = Number(argv[++i]);
    else if (argv[i] === '--account') args.account = argv[++i];
  }
  return args;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  console.log(`分析期間: 直近${args.days}日
`);

  const { summary, results } = await collectInsights({
    days: args.days,
    accountName: args.account,
    log: (m) => console.log('  ' + m),
  });

  console.log('
結果:', JSON.stringify(summary));
  for (const r of results) {
    console.log(`  @${r.account}: ${r.result === 'ok' ? `${r.saved}件保存` : r.reason}`);
  }
  console.log('
集計は管理画面の「リサーチ」で見られます。');
}

main().catch((err) => {
  console.error('
失敗しました: ' + err.message);
  process.exit(1);
});
