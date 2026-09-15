#!/usr/bin/env node
// 返信待ちのコメントに順次返信する。
//
// 使い方:
//   npm run replies:send            # REPLY_MODE に従う（既定は dry_run）
//   npm run replies:send -- --force # dry_run でも実際に送る
import { loadEnv } from './lib/env.mjs';
import { sendQueuedReplies, replyMode, isQuietNow } from '../lib/server/send-replies.mjs';

async function main() {
  loadEnv();
  const force = process.argv.includes('--force');
  console.log(`返信モード: ${replyMode()}${force ? '（--force で実送信）' : ''}`);
  if (isQuietNow()) console.log('※ 現在は深夜帯（2:00-6:00 JST）のため送信されません。');

  const { summary, results, skipped } = await sendQueuedReplies({ force });
  if (skipped) {
    console.log(skipped);
    return;
  }
  if (!results.length) {
    console.log('送信対象はありませんでした（遅延時間が経過していないか、自動返信が有効な名義がありません）。');
    return;
  }
  for (const r of results) {
    if (r.result === 'sent') console.log(`[送信] @${r.account} → ${r.threadId}`);
    else if (r.result === 'dry_run') console.log(`[dry_run] @${r.account}: ${String(r.text).split('\n')[0]}`);
    else console.log(`[${r.result}] @${r.account} ${r.reason ?? ''}`);
  }
  console.log(`\n集計: ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
