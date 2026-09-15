'use server';

import { revalidatePath } from 'next/cache';
import { getDb, COLLECTIONS } from '@/lib/server/firebase.mjs';
import { invalidate, TAGS } from '@/lib/server/repo.mjs';

/** 除外されたコメントを、返信対象に戻す。 */
export async function requeueReply(formData) {
  const id = formData.get('replyId');
  await getDb()
    .collection(COLLECTIONS.replies)
    .doc(id)
    .set(
      { status: 'queued', skipReason: null, requeuedAt: new Date().toISOString() },
      { merge: true }
    );
  invalidate(TAGS.replies);
  revalidatePath('/replies');
}

/** 返信対象から外す。 */
export async function skipReply(formData) {
  const id = formData.get('replyId');
  await getDb()
    .collection(COLLECTIONS.replies)
    .doc(id)
    .set(
      { status: 'skipped', skipReason: '手動で除外', classifiedAt: new Date().toISOString() },
      { merge: true }
    );
  invalidate(TAGS.replies);
  revalidatePath('/replies');
}

/** 手動で返信済みにする（画面外で自分が返した場合に使う）。 */
export async function markRepliedManually(formData) {
  const id = formData.get('replyId');
  await getDb()
    .collection(COLLECTIONS.replies)
    .doc(id)
    .set(
      { status: 'sent', manual: true, sentAt: new Date().toISOString() },
      { merge: true }
    );
  invalidate(TAGS.replies);
  revalidatePath('/replies');
}
