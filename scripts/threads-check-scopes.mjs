#!/usr/bin/env node
// 各名義のトークンに必要な権限が乗っているかを実際のAPI呼び出しで確認する。
// 使い方: npm run threads:check
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { getMe, listMyThreads, getThreadInsights, listReplies } from './lib/threads.mjs';

/** 権限ごとに、それを必要とする最小の呼び出しを1回ずつ試す。 */
async function probe(account) {
  const accessToken = account.accessToken;
  const userId = account.threadsUserId;
  const results = {};

  // threads_basic: 自分のプロフィール
  try {
    await getMe({ accessToken, fields: 'id,username' });
    results.threads_basic = 'OK';
  } catch (err) {
    results.threads_basic = `NG (${err.message.split('\n').pop().trim()})`;
  }

  // threads_basic: 自分の投稿一覧（分析の入力になる）
  let firstThreadId = null;
  try {
    const threads = await listMyThreads({ accessToken, userId, limit: 5 });
    firstThreadId = threads.data?.[0]?.id ?? null;
    results.investigate_posts = `OK (${threads.data?.length ?? 0}件取得)`;
  } catch (err) {
    results.investigate_posts = `NG (${err.message.split('\n').pop().trim()})`;
  }

  // threads_manage_insights: 投稿のインサイト
  if (firstThreadId) {
    try {
      const insights = await getThreadInsights({ accessToken, threadId: firstThreadId });
      const names = (insights.data ?? []).map((m) => m.name).join(', ');
      results.threads_manage_insights = `OK (${names || '指標なし'})`;
    } catch (err) {
      results.threads_manage_insights = `NG (${err.message.split('\n').pop().trim()})`;
    }
  } else {
    results.threads_manage_insights = 'スキップ（投稿が無い）';
  }

  // threads_read_replies: リプライの読み取り
  if (firstThreadId) {
    try {
      const replies = await listReplies({ accessToken, threadId: firstThreadId, limit: 5 });
      results.threads_read_replies = `OK (${replies.data?.length ?? 0}件)`;
    } catch (err) {
      results.threads_read_replies = `NG (${err.message.split('\n').pop().trim()})`;
    }
  } else {
    results.threads_read_replies = 'スキップ（投稿が無い）';
  }

  return results;
}

async function main() {
  loadEnv();
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.accounts).get();
  const accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  for (const account of accounts) {
    console.log(`\n=== @${account.name} (${account.status ?? 'active'}) ===`);
    const results = await probe(account);
    for (const [key, value] of Object.entries(results)) {
      console.log(`  ${key.padEnd(26)} ${value}`);
    }
  }
  console.log('\nNG が出た項目は、Metaで権限を追加してからトークンを取り直してください。');
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
