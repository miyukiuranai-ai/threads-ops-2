// お客様の声（口コミ）の置き場所。
// 鑑定を受けた方からもらった言葉を貼っておき、たまに1本だけ「声を引く型」の投稿に使う。
// 1つの声は1回しか使わない（使ったら usedAt が入る）。
import { getDb } from './firebase.mjs';

export const TESTIMONIALS_COLLECTION = 'testimonials';

/** 名義ごとの声を読む。accountIds を渡すとその名義だけ。 */
export async function loadTestimonials({ accountIds = null } = {}) {
  const snap = await getDb().collection(TESTIMONIALS_COLLECTION).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => !accountIds || accountIds.includes(t.accountId))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

/** まだ使っていない声を、古いものから1つ選ぶ。無ければ null。 */
export async function pickUnusedTestimonial(accountId) {
  const snap = await getDb()
    .collection(TESTIMONIALS_COLLECTION)
    .where('accountId', '==', accountId)
    .get();
  const unused = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => !t.usedAt)
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  return unused[0] ?? null;
}

/** 使った印を付ける。 */
export async function markTestimonialUsed(id, postId) {
  await getDb()
    .collection(TESTIMONIALS_COLLECTION)
    .doc(id)
    .set({ usedAt: new Date().toISOString(), usedPostId: postId ?? null }, { merge: true });
}
