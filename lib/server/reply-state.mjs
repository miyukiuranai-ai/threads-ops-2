// コメント処理まわりの集計データ。
// Firestore の読み取りを抑えるため、毎回コレクション全体を走査せず、
// 必要な値を小さなドキュメントに持たせておく。
import { getDb } from './firebase.mjs';

/** 投稿ごとの「どこまで取り込んだか」。 */
export const CURSORS_COLLECTION = 'replyCursors';

/** コメントした人の集計（被り判定に使う）。 */
export const COMMENTERS_COLLECTION = 'commenters';

/** 名義ごとの送信履歴（休憩と上限の判定に使う）。 */
export const REPLY_STATS_COLLECTION = 'replyStats';

/** 送信履歴として保持する件数。1日の上限判定に足りる長さ。 */
const KEEP_SENDS = 400;

/** その投稿で最後に取り込んだコメントの時刻を返す。 */
export async function getCursor(threadId) {
  const snap = await getDb().collection(CURSORS_COLLECTION).doc(threadId).get();
  return snap.exists ? (snap.data().lastTimestamp ?? null) : null;
}

export async function setCursor(threadId, lastTimestamp) {
  await getDb()
    .collection(CURSORS_COLLECTION)
    .doc(threadId)
    .set({ lastTimestamp, updatedAt: new Date().toISOString() }, { merge: true });
}

/**
 * ユーザー名を Firestore のドキュメントIDに使える形にする。
 * 「__」で囲まれた名前（例: __tuki_____）は予約されていて弾かれ、
 * 1人のせいで判定処理ごと落ちて全名義の返信が止まったことがある。
 * 普通の名前はそのまま使い、危ないものだけ接頭辞を付ける。
 */
export function commenterKey(username) {
  const name = String(username ?? '');
  const unsafe = /^__.*__$/.test(name) || name.includes('/') || name === '.' || name === '..';
  return unsafe ? `u_${name.replaceAll('/', '_')}` : name;
}

/** コメントした人の記録を1件ぶん進める。 */
export async function touchCommenter({ username, accountName, threadId, hasText }) {
  if (!username) return;
  const { FieldValue } = await import('firebase-admin/firestore');
  await getDb()
    .collection(COMMENTERS_COLLECTION)
    .doc(commenterKey(username))
    .set(
      {
        username,
        accounts: FieldValue.arrayUnion(accountName),
        threads: FieldValue.arrayUnion(threadId),
        total: FieldValue.increment(1),
        texts: FieldValue.increment(hasText ? 1 : 0),
        lastSeenAt: new Date().toISOString(),
      },
      { merge: true }
    );
}

/** 指定したユーザーぶんだけ集計を読む（全件走査しない）。 */
export async function loadCommenters(usernames) {
  const unique = [...new Set(usernames.filter(Boolean))];
  if (!unique.length) return new Map();

  const db = getDb();
  const refs = unique.map((u) => db.collection(COMMENTERS_COLLECTION).doc(commenterKey(u)));
  const snaps = await db.getAll(...refs);

  const map = new Map();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const d = snap.data();
    map.set(d.username, {
      accounts: d.accounts ?? [],
      threads: d.threads ?? [],
      total: d.total ?? 0,
      texts: d.texts ?? 0,
    });
  }
  return map;
}

/** 直近で使ったテンプレートを何件覚えておくか。 */
const KEEP_TEMPLATES = 12;

/** 名義の送信履歴と、直近で使ったテンプレートを読む。 */
export async function loadReplyStats(accountId) {
  const snap = await getDb().collection(REPLY_STATS_COLLECTION).doc(accountId).get();
  const d = snap.exists ? snap.data() : {};
  return { sends: d.sends ?? [], recentTemplateIds: d.recentTemplateIds ?? [] };
}

/** 送信履歴に1件足す（古いものは捨てる）。 */
export async function pushReplySend(accountId, state, iso, templateId) {
  const sends = [...state.sends, iso].slice(-KEEP_SENDS);
  const recentTemplateIds = [templateId, ...state.recentTemplateIds]
    .filter(Boolean)
    .slice(0, KEEP_TEMPLATES);

  await getDb()
    .collection(REPLY_STATS_COLLECTION)
    .doc(accountId)
    .set({ sends, recentTemplateIds, updatedAt: new Date().toISOString() }, { merge: true });

  return { sends, recentTemplateIds };
}

/** 送信履歴から、直近の件数を数える。 */
export function countWithin(sends, minutes) {
  const limit = Date.now() - minutes * 60_000;
  return sends.filter((iso) => new Date(iso).getTime() >= limit).length;
}
