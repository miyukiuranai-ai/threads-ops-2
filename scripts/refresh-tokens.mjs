#!/usr/bin/env node
// 長期トークンを延長する。本番では Vercel Cron が /api/cron/refresh-tokens を週次で叩く。
//
// 使い方:
//   npm run token:refresh          # 期限が30日を切った名義だけ
//   npm run token:refresh -- --all # 全名義
import { loadEnv } from './lib/env.mjs';
import { refreshTokens, WARN_DAYS } from '../lib/server/tokens.mjs';

async function main() {
  loadEnv();
  const all = process.argv.includes('--all');
  const { results } = await refreshTokens({ all });

  for (const r of results) {
    if (r.result === 'refreshed') console.log(`[延長] @${r.account} → 残り${r.daysLeft}日`);
    else if (r.result === 'skipped') console.log(`[スキップ] @${r.account} 残り${r.daysLeft}日のためスキップ`);
    else console.log(`[${r.result}] @${r.account} ${r.reason ?? ''}`);
  }

  const warn = results.filter((r) => typeof r.daysLeft === 'number' && r.daysLeft < WARN_DAYS);
  if (warn.length) {
    console.log(`\n⚠ 失効まで${WARN_DAYS}日を切っている名義があります: ${warn.map((r) => '@' + r.account).join(', ')}`);
  }
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
