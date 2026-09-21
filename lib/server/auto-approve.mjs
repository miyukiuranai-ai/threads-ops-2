// 生成した投稿案を、承認待ちを飛ばして「承認済み」で保存するかどうか（threads-ops2 で追加。本人 9/19「毎日生成したツイートは自動で承認してほしい」）。
//
// 既定は OFF（人が「投稿予定」で承認する）。ON にすると 15:30 の生成でできた投稿案が
// そのまま承認済みになり、予定時刻が来れば投稿される。画面から本文を直したり却下したりはできる。
//
// 例外:
//   - 画像が要るのに素材が無い投稿は承認しない（保留のまま。画像を付けると承認待ちに戻る）
//   - 名義の設定「自動仕分けから外す」が ON の名義は、これまで通り承認待ちで止める
import { getDb } from './firebase.mjs';
import { needsImage } from './image-need.mjs';
import { attachedMedia } from './storage.mjs';

export const AUTO_APPROVE_DOC = { collection: 'settings', id: 'posting' };

/** いま自動承認が ON か。設定が無ければ OFF。 */
export async function loadAutoApprove() {
  try {
    const snap = await getDb().collection(AUTO_APPROVE_DOC.collection).doc(AUTO_APPROVE_DOC.id).get();
    return snap.exists ? snap.data().autoApprove === true : false;
  } catch {
    // 設定が読めないときは、勝手に投稿しない側に倒す
    return false;
  }
}

/** 自動承認の ON / OFF を保存する。 */
export async function saveAutoApprove(on, by = null) {
  await getDb()
    .collection(AUTO_APPROVE_DOC.collection)
    .doc(AUTO_APPROVE_DOC.id)
    .set({ autoApprove: on === true, autoApproveUpdatedAt: new Date().toISOString(), autoApproveUpdatedBy: by }, { merge: true });
  return on === true;
}

/**
 * その投稿案を、生成と同時に承認してよいか。
 * @param {object} record 投稿案
 * @param {object} account 名義
 * @returns {boolean}
 */
export function canAutoApprove(record, account) {
  if (record?.status !== 'pending') return false; // 保留（画像が未準備）はそのまま
  if (account?.autoReviewExempt === true) return false; // 人が全件見る名義
  if (needsImage(record) && !attachedMedia(record).length) return false; // 画像が要るのに無い
  return true;
}

/**
 * すでに承認待ちで残っている投稿案を、まとめて承認する（threads-ops2 で追加）。
 * 5分おきの処理から呼ぶ。自動承認が OFF のときは何もしない。
 *
 * 生成と同時の承認だけだと、設定を ON にする前に作られた投稿案が承認待ちのまま残り、
 * 予定時刻を過ぎて投稿されないままになる。ここで毎回すくい上げる。
 *
 * 触らないもの:
 *   - 保留・却下・承認済み（人が決めたもの）
 *   - 「自動仕分けから外す」名義
 *   - 画像が要るのに素材が無い投稿（23:30 の仕分けで却下される）
 *   - すでに予定時刻を過ぎた投稿（承認しても本文の時刻とズレる。23:30 の仕分けに任せる）
 */
export async function autoApprovePending({ dry = false } = {}) {
  if (!(await loadAutoApprove())) return { skipped: true, reason: '自動承認は OFF' };

  const { COLLECTIONS } = await import('./firebase.mjs');
  const { minutesLate, LATE_LIMIT_MINUTES } = await import('./post-time.mjs');
  const db = getDb();

  const snap = await db.collection(COLLECTIONS.posts).where('status', '==', 'pending').limit(500).get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!all.length) return { approved: 0, results: [] };

  const accSnap = await db.collection(COLLECTIONS.accounts).select('autoReviewExempt').get();
  const accounts = new Map(accSnap.docs.map((d) => [d.id, d.data()]));

  const now = new Date().toISOString();
  const results = [];
  const batch = db.batch();
  let approved = 0;

  for (const post of all) {
    if (!canAutoApprove(post, accounts.get(post.accountId) ?? {})) continue;
    if (minutesLate(post.scheduledAt) > LATE_LIMIT_MINUTES) continue;
    approved += 1;
    results.push({ account: post.accountName ?? post.accountId, postId: post.id, slot: post.slot ?? null });
    if (!dry) {
      batch.set(
        db.collection(COLLECTIONS.posts).doc(post.id),
        { status: 'approved', autoReviewed: true, autoReviewReason: '自動承認が ON のため承認しました', reviewedAt: now },
        { merge: true }
      );
    }
  }

  if (!dry && approved) await batch.commit();
  return { approved, dry, results };
}
