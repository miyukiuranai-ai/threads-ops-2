// 投稿済みの投稿を Threads から消す。
// Threads の API の削除を呼ぶだけなので、費用はかからない（Claude は使わない）。
// 消したものは戻せないので、呼ぶ側で必ず確認を取る。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { deleteThread } from './threads.mjs';
import { HISTORY_COLLECTION } from './scoring.mjs';

/**
 * 投稿の記録（posts の doc）を渡して、Threads 上の投稿を消し、記録を「削除済み」にする。
 * @returns {{ accountName: string, head: string }}
 */
export async function deletePostedPost({ postId, by = null }) {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.posts).doc(String(postId));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('その投稿の記録が見つかりません。');
  const post = snap.data();
  if (post.status !== 'posted' || !post.postedThreadId) throw new Error('投稿済みのものだけ消せます。');

  const account = (await db.collection(COLLECTIONS.accounts).doc(post.accountId).get()).data();
  if (!account?.accessToken) throw new Error('名義のトークンが見つかりません。');

  await deleteThread({ accessToken: account.accessToken, threadId: post.postedThreadId });
  await ref.set({ status: 'deleted', deletedAt: new Date().toISOString(), deletedBy: by }, { merge: true });

  // 反応の履歴にも印を付けておく（分析から外せるように）
  const hist = await db.collection(HISTORY_COLLECTION).where('threadId', '==', post.postedThreadId).limit(1).get().catch(() => null);
  if (hist && !hist.empty) await hist.docs[0].ref.set({ deletedAt: new Date().toISOString() }, { merge: true });

  return { accountName: post.accountName, head: String(post.body ?? '').split('\n')[0].slice(0, 30) };
}
