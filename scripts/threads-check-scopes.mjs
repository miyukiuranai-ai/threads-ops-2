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

  // threads_delete: 投稿の削除
  // 実際には消さない。存在しないID「0」に削除を投げて、返ってくるエラーの種類で見分ける。
  //   「アプリに権限が無い」(code=10) なら権限なし
  //   「そんな投稿は無い」(code=100 / subcode=33) なら権限はある
  results.threads_delete = await probeDelete(accessToken);

  return results;
}

/** 削除の権限があるかを、存在しないIDへの削除で確かめる（何も消えない）。 */
async function probeDelete(accessToken) {
  const url = new URL('https://graph.threads.net/v1.0/0');
  url.searchParams.set('access_token', accessToken);
  let body;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    body = await res.json().catch(() => ({}));
  } catch (err) {
    return `確認できません (${err.message})`;
  }
  const err = body?.error ?? {};
  const message = String(err.message ?? '');
  if (err.code === 10 || /does not have permission/i.test(message)) {
    return 'NG (アプリに threads_delete の権限が乗っていません。権限を足してトークンを取り直してください)';
  }
  if (err.code === 100 || err.error_subcode === 33 || /does not exist/i.test(message)) {
    return 'OK (削除できます)';
  }
  if (!body?.error) return 'OK (削除できます)';
  return `不明 (${message || JSON.stringify(err)})`;
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
