'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { invalidate, TAGS } from '@/lib/server/repo.mjs';
import { alignBodyTime } from '@/lib/server/post-time.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts } from '@/lib/server/repo.mjs';
import { deletePostedPost } from '@/lib/server/post-delete.mjs';

/** 承認キューで取りうる操作。SPEC の 編集/承認/却下/保留 に対応。 */
const ALLOWED_STATUS = ['pending', 'approved', 'rejected', 'held'];

async function setStatus(postId, status) {
  if (!ALLOWED_STATUS.includes(status)) throw new Error(`不正なステータス: ${status}`);
  await getDb()
    .collection(COLLECTIONS.posts)
    .doc(postId)
    .set({ status, reviewedAt: new Date().toISOString() }, { merge: true });
  invalidate(TAGS.posts);
  revalidatePath('/posts');
  revalidatePath('/');
}

export async function approvePost(formData) {
  await setStatus(formData.get('postId'), 'approved');
}

export async function rejectPost(formData) {
  await setStatus(formData.get('postId'), 'rejected');
}

export async function holdPost(formData) {
  await setStatus(formData.get('postId'), 'held');
}

export async function reopenPost(formData) {
  await setStatus(formData.get('postId'), 'pending');
}

/** 投稿済みのものを Threads から消す（戻せない）。費用はかからない。 */
export async function deletePostedThread(formData) {
  const user = await getCurrentUser();
  if (!user) throw new Error('ログインしてください。');
  const postId = String(formData.get('postId') ?? '');
  const snap = await getDb().collection(COLLECTIONS.posts).doc(postId).get();
  if (!snap.exists) throw new Error('投稿が見つかりません。');
  const allowed = filterAccountsForUser(await listAccounts(), user);
  if (!allowed.some((a) => a.id === snap.data().accountId)) throw new Error('その名義は扱えません。');
  await deletePostedPost({ postId, by: user.name });
  invalidate(TAGS.posts);
  revalidatePath('/posts');
  revalidatePath('/');
}

/** 本文の編集。編集したら承認待ちに戻す。 */
export async function updatePostBody(formData) {
  const postId = formData.get('postId');
  const body = String(formData.get('body') ?? '').trim();
  if (!body) throw new Error('本文が空です。');
  if ([...body].length > 500) throw new Error('本文が500文字を超えています。');

  await getDb()
    .collection(COLLECTIONS.posts)
    .doc(postId)
    .set(
      { body, status: 'pending', editedAt: new Date().toISOString(), editedByHuman: true },
      { merge: true }
    );
  invalidate(TAGS.posts);
  revalidatePath('/posts');
}

/**
 * 予定時刻の変更（日本時間の "YYYY-MM-DDTHH:MM" を受け取る）。
 * 本文の冒頭に時刻が書かれていれば、新しい時刻に合わせて書き直す。
 */
export async function updateSchedule(formData) {
  const postId = formData.get('postId');
  const local = String(formData.get('scheduledAtLocal') ?? '');
  if (!local) throw new Error('日時が空です。');

  // datetime-local の値は日本時間として扱う
  const iso = new Date(`${local}:00+09:00`).toISOString();
  const clock = local.slice(11, 16);

  const ref = getDb().collection(COLLECTIONS.posts).doc(postId);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : {};
  const aligned = alignBodyTime(prev.body ?? '', clock);

  await ref.set(
    {
      scheduledAt: iso,
      slot: clock,
      body: aligned.body,
      editedAt: new Date().toISOString(),
      // 見送りになっていた投稿は、時刻を直した時点で承認待ちに戻す
      ...(prev.status === 'missed' ? { status: 'pending', missedReason: null } : {}),
    },
    { merge: true }
  );
  invalidate(TAGS.posts);
  revalidatePath('/posts');
}
