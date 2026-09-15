'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/server/firebase.mjs';
import { getCurrentUser } from '@/lib/server/auth.mjs';
import {
  WATCHLIST_COLLECTION,
  WATCH_STATUS,
  parseUsername,
} from '@/lib/server/watchlist.mjs';

/**
 * 気になるアカウントを控える。
 * 競合の情報は分ける理由がないので、ツールを触る全員で共有する。
 */
export async function addWatch(formData) {
  const user = await getCurrentUser();
  const username = parseUsername(formData.get('url'));
  if (!username) {
    return { error: 'Threads のURL（https://www.threads.com/@名前）か、@名前 を入れてください。' };
  }

  const db = getDb();
  const ref = db.collection(WATCHLIST_COLLECTION).doc(username);
  if ((await ref.get()).exists) return { error: `@${username} はすでに控えてあります。` };

  await ref.set({
    username,
    note: String(formData.get('note') ?? '').trim() || null,
    status: 'candidate',
    analysis: null,
    addedBy: user.name,
    createdAt: new Date().toISOString(),
  });

  revalidatePath('/research');
  return { ok: `@${username} を控えました。` };
}

/** 判定の状態を変える。 */
export async function setWatchStatus(formData) {
  const username = String(formData.get('username') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!WATCH_STATUS[status]) return;

  await getDb()
    .collection(WATCHLIST_COLLECTION)
    .doc(username)
    .set({ status, judgedAt: new Date().toISOString() }, { merge: true });

  revalidatePath('/research');
}

/** 分析の結果を書き残す。 */
export async function saveWatchNote(formData) {
  const username = String(formData.get('username') ?? '');
  const analysis = String(formData.get('analysis') ?? '').trim() || null;

  await getDb()
    .collection(WATCHLIST_COLLECTION)
    .doc(username)
    .set({ analysis, analyzedAt: new Date().toISOString() }, { merge: true });

  revalidatePath('/research');
}

/** 控えから外す。 */
export async function removeWatch(formData) {
  await getDb()
    .collection(WATCHLIST_COLLECTION)
    .doc(String(formData.get('username') ?? ''))
    .delete();

  revalidatePath('/research');
}
