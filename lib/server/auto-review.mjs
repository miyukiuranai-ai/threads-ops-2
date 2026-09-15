// 承認されないまま夜が更けた投稿を、決まった時刻に自動で仕分けする。
//
// 毎日 17:00 に翌日ぶんが作られ、19:00 以降に人が承認する運用だが、
// 見られない日もある。放っておくと投稿が1本も出ない日ができてしまう。
// そこで締切を決めて、それまでに触られなかったものを機械的に決める:
//   画像が要る投稿  → 却下（画像を用意できないまま出しても意味がない）
//   文章だけの投稿  → 承認
//
// 「保留」にしたものは人が意図して止めているので触らない。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { jstClock, minutesLate, LATE_LIMIT_MINUTES } from './post-time.mjs';
import { attachedMedia } from './storage.mjs';
import { needsImage } from './image-need.mjs';

/** 締切の時刻（日本時間）。これを過ぎたら自動で仕分ける。 */
export const AUTO_REVIEW_AT = process.env.AUTO_REVIEW_AT ?? '23:30';

/** 締切から何分のあいだ実行を受け付けるか。 */
const WINDOW_MINUTES = 40;

/** 一度に書き換える件数。Firestore の一括書き込みは500件まで。 */
const CHUNK = 300;

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** いまが締切の時間帯か。投稿実行（5分おき）から呼ばれる。 */
export function shouldRunNow(now = new Date()) {
  const at = toMinutes(AUTO_REVIEW_AT);
  const cur = toMinutes(jstClock(now));
  if (at === null || cur === null) return false;
  return cur >= at && cur < at + WINDOW_MINUTES;
}

/** その投稿を承認してよいか。画像が要るのに無いものは却下する。 */
function decide(post) {
  // 本文が画像を指している投稿だけ却下する。
  // 画像の指示が付いていても、本文だけで読めるものはそのまま承認する
  if (!attachedMedia(post).length && needsImage(post)) {
    return { status: 'rejected', reason: '本文が画像を指しているのに素材がないため却下しました' };
  }

  // すでに予定時刻を過ぎているものは、承認しても投稿されない（本文の時刻とズレるため）
  if (minutesLate(post.scheduledAt) > LATE_LIMIT_MINUTES) {
    return { status: 'rejected', reason: '予定時刻を過ぎていたため自動で却下しました' };
  }

  return { status: 'approved', reason: '締切までに確認がなかったため自動で承認しました' };
}

/**
 * 承認待ちのまま残っている投稿を仕分ける。
 * 「保留」「却下」「承認済み」には触らない。
 */
export async function autoReviewPending({ dry = false } = {}) {
  const db = getDb();
  const startedAt = new Date().toISOString();

  const snap = await db
    .collection(COLLECTIONS.posts)
    .where('status', '==', 'pending')
    .limit(500)
    .get();

  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!all.length) return { startedAt, summary: {}, results: [] };

  // 「自動仕分けしない」名義の投稿は触らない（人が全件見る運用のため）
  const accSnap = await db.collection(COLLECTIONS.accounts).select('autoReviewExempt').get();
  const exempt = new Set(accSnap.docs.filter((d) => d.data().autoReviewExempt === true).map((d) => d.id));

  const results = [];
  const now = new Date().toISOString();

  for (const post of all.filter((p) => exempt.has(p.accountId))) {
    results.push({
      account: post.accountName ?? post.accountId,
      postId: post.id,
      result: 'skipped',
      reason: 'この名義は自動仕分けしない設定',
      slot: post.slot ?? null,
    });
  }
  const posts = all.filter((p) => !exempt.has(p.accountId));

  for (let i = 0; i < posts.length; i += CHUNK) {
    const batch = db.batch();
    for (const post of posts.slice(i, i + CHUNK)) {
      const { status, reason } = decide(post);
      if (!dry) {
        batch.set(
          db.collection(COLLECTIONS.posts).doc(post.id),
          { status, autoReviewed: true, autoReviewReason: reason, reviewedAt: now },
          { merge: true }
        );
      }
      results.push({
        account: post.accountName ?? post.accountId,
        postId: post.id,
        result: status,
        reason,
        slot: post.slot ?? null,
      });
    }
    if (!dry) await batch.commit();
  }

  const summary = results.reduce((acc, r) => {
    acc[r.result] = (acc[r.result] ?? 0) + 1;
    return acc;
  }, {});

  if (dry) return { startedAt, dry: true, summary, results };

  await db.collection(COLLECTIONS.runs).add({
    job: 'auto-review',
    startedAt,
    finishedAt: new Date().toISOString(),
    status: 'ok',
    summary,
    message: `締切 ${AUTO_REVIEW_AT} の自動仕分け: 承認 ${summary.approved ?? 0}件 / 却下 ${summary.rejected ?? 0}件`,
    results,
  });

  return { startedAt, summary, results };
}
