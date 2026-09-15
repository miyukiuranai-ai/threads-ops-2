#!/usr/bin/env node
// 直近72時間の自投稿に付いたコメントを取得し、判定まで行う。送信はしない。
//
// 使い方:
//   npm run replies:collect              # 取得＋判定
//   npm run replies:collect -- --classify-only
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { collectRepliesForAccount, classifyPending } from '../lib/server/replies.mjs';

async function main() {
  loadEnv();
  const classifyOnly = process.argv.includes('--classify-only');
  const db = getDb();

  if (!classifyOnly) {
    const accounts = (await db.collection(COLLECTIONS.accounts).get()).docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // 停止中でも自動返信が ON なら取り込む（「投稿は手で、返信は自動」の使い方）
      .filter((a) => (a.status ?? 'active') === 'active' || a.autoReply === true);

    for (const account of accounts) {
      try {
        const r = await collectRepliesForAccount(account);
        console.log(`@${account.name}: 対象${r.threads}投稿 / 取得${r.fetched}件 / 新規${r.added}件`);
      } catch (err) {
        console.log(`@${account.name}: 取得失敗 ${err.message.split('\n').pop().trim()}`);
      }
    }
  }

  console.log('\n判定中 ...');
  const c = await classifyPending({});
  console.log(`判定 ${c.classified}件 → 返信する ${c.queued}件 / 返信しない ${c.skipped}件`);
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
