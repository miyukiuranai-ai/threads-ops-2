#!/usr/bin/env node
// 投稿済みのスレッドを削除する。threads_delete が必要。
//
// 使い方:
//   npm run post:delete -- <threadId>
//   npm run post:delete -- <threadId> --dry
import { loadEnv } from './lib/env.mjs';
import { getDb, COLLECTIONS } from '../lib/server/firebase.mjs';
import { deleteThread } from '../lib/server/threads.mjs';

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const threadId = args.find((a) => !a.startsWith('--'));
  if (!threadId) throw new Error('削除するスレッドIDを渡してください。');

  const db = getDb();
  const snap = await db.collection(COLLECTIONS.posts).where('postedThreadId', '==', threadId).limit(1).get();
  if (snap.empty) throw new Error(`スレッド ${threadId} に対応する投稿が見つかりません。`);

  const doc = snap.docs[0];
  const post = doc.data();
  const account = (await db.collection(COLLECTIONS.accounts).doc(post.accountId).get()).data();

  console.log(`@${post.accountName} の投稿を削除します:`);
  console.log(String(post.body).split('\n')[0]);
  if (dry) {
    console.log('\n--dry のため削除しません。');
    return;
  }

  await deleteThread({ accessToken: account.accessToken, threadId });
  await doc.ref.set(
    { status: 'deleted', deletedAt: new Date().toISOString() },
    { merge: true }
  );
  console.log('\n削除しました。');
}

main().catch((err) => {
  console.error('\n失敗しました: ' + err.message);
  process.exit(1);
});
