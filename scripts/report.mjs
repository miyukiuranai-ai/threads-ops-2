#!/usr/bin/env node
// 昨日の投稿の成績を読んで、続けること・やめることを出す。
//
// 使い方:
//   npm run report                      # 昨日ぶん
//   npm run report -- --date 2026-09-02
//   npm run report -- --dry             # 保存しない
import { loadEnv } from './lib/env.mjs';
import { generateDailyReport } from '../lib/server/report.mjs';

function parseArgs(argv) {
  const args = { date: null, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--date') args.date = argv[++i];
    else if (argv[i] === '--dry') args.dry = true;
  }
  return args;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const r = await generateDailyReport(args);

  if (r.skipped) {
    console.log(r.date + ': ' + r.skipped);
    return;
  }

  console.log('=== ' + r.date + ' のレポート ===\n');
  console.log(r.overall + '\n');
  for (const a of record.alerts ?? []) {
    console.log(`[${a.level}] @${a.account} ${a.message}${a.proposal ? `
    提案: ${a.proposal}` : ''}`);
  }

  for (const a of r.accounts) {
    const stat = r.stats.find((s) => s.account === a.account);
    console.log('■ @' + a.account +
      (stat ? `   表示${stat.views.toLocaleString()} / 追加${stat.signups ?? '-'}` +
        (stat.per10k !== null ? ` / 1万表示あたり${stat.per10k}人` : '') : ''));
    for (const k of a.keep ?? []) console.log('  続ける: ' + k);
    for (const s of a.stop ?? []) console.log('  やめる: ' + s);
    if (a.note) console.log('  気づき: ' + a.note);
    console.log();
  }

  console.log(`使用トークン: 入力${r.usage?.input_tokens} / 出力${r.usage?.output_tokens}`);
  if (args.dry) console.log('--dry のため保存していません。');
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
