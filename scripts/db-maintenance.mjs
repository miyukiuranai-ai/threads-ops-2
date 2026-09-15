#!/usr/bin/env node
// Firestore の後片付けと、集計データの作り直し。
//
//   - 既存のコメントから commenters（被り判定用）を作り直す
//   - 投稿ごとの取り込み位置（replyCursors）を作り直す
//   - 古い実行ログを削除する
//
// 使い方:
//   npm run db:maintenance
//   npm run db:maintenance -- --keep-days 3
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import {
  COMMENTERS_COLLECTION,
  CURSORS_COLLECTION,
} from '../lib/server/reply-state.mjs';

/** 実行ログを何日ぶん残すか。 */
const DEFAULT_KEEP_DAYS = 7;

/** まとめ書きの単位（Firestoreの上限は500）。 */
const BATCH_SIZE = 400;

async function commitInChunks(db, items, apply) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const item of items.slice(i, i + BATCH_SIZE)) apply(batch, item);
    await batch.commit();
  }
}

async function rebuildCommenters(db) {
  const snap = await db.collection(COLLECTIONS.replies).get();
  const byUser = new Map();

  for (const d of snap.docs) {
    const r = d.data();
    if (!r.username) continue;
    const s = byUser.get(r.username) ?? {
      username: r.username,
      accounts: new Set(),
      threads: new Set(),
      total: 0,
      texts: 0,
      lastSeenAt: null,
    };
    s.accounts.add(r.accountName);
    s.threads.add(r.sourceThreadId);
    s.total += 1;
    if (r.category === 'message') s.texts += 1;
    if (!s.lastSeenAt || (r.timestamp ?? '') > s.lastSeenAt) s.lastSeenAt = r.timestamp ?? null;
    byUser.set(r.username, s);
  }

  const items = [...byUser.values()];
  await commitInChunks(db, items, (batch, s) => {
    batch.set(
      db.collection(COMMENTERS_COLLECTION).doc(s.username),
      {
        username: s.username,
        accounts: [...s.accounts],
        threads: [...s.threads],
        total: s.total,
        texts: s.texts,
        lastSeenAt: s.lastSeenAt,
      },
      { merge: true }
    );
  });

  return { replies: snap.size, commenters: items.length };
}

async function rebuildCursors(db) {
  const snap = await db.collection(COLLECTIONS.replies).get();
  const byThread = new Map();

  for (const d of snap.docs) {
    const r = d.data();
    if (!r.sourceThreadId || !r.timestamp) continue;
    const current = byThread.get(r.sourceThreadId);
    if (!current || r.timestamp > current) byThread.set(r.sourceThreadId, r.timestamp);
  }

  const items = [...byThread.entries()];
  await commitInChunks(db, items, (batch, [threadId, lastTimestamp]) => {
    batch.set(
      db.collection(CURSORS_COLLECTION).doc(threadId),
      { lastTimestamp, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  });

  return { threads: items.length };
}

async function pruneRuns(db, keepDays) {
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();
  const snap = await db.collection(COLLECTIONS.runs).get();
  const old = snap.docs.filter((d) => String(d.data().startedAt ?? '') < cutoff);

  await commitInChunks(db, old, (batch, doc) => batch.delete(doc.ref));
  return { total: snap.size, deleted: old.length };
}

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const keepIndex = args.indexOf('--keep-days');
  const keepDays = keepIndex >= 0 ? Number(args[keepIndex + 1]) : DEFAULT_KEEP_DAYS;

  const db = getDb();

  console.log('コメントした人の集計を作り直しています ...');
  const c = await rebuildCommenters(db);
  console.log(`  コメント${c.replies}件 → ${c.commenters}人ぶんを保存`);

  console.log('投稿ごとの取り込み位置を作り直しています ...');
  const cur = await rebuildCursors(db);
  console.log(`  ${cur.threads}投稿ぶんを保存`);

  console.log(`${keepDays}日より古い実行ログを削除しています ...`);
  const r = await pruneRuns(db, keepDays);
  console.log(`  ${r.total}件のうち ${r.deleted}件を削除`);

  console.log('\n完了しました。');
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
