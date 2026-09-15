// LINE の友だち追加数。名義ごと・日ごとに人が入力する。
//
// 表示数やいいね数は API から取れるが、実際に集客できたかは LINE 側にしかない。
// ここが埋まると「どの型・どの時間帯が登録に効いたか」で判断できるようになる。
// 表示数だけで判断すると、届く層が広がる方向（＝薄い層）へ最適化されてしまう。
import { getDb } from './firebase.mjs';

export const SIGNUPS_COLLECTION = 'signups';

/** 日ごとの記録は 名義ID_日付 で1件にする。 */
export const signupId = (accountId, date) => `${accountId}_${date}`;

/** 日本時間の "YYYY-MM-DD"。 */
export function jstDate(input = new Date()) {
  return new Date(new Date(input).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/** 記録を読む。 */
export async function loadSignups({ accountIds = null, days = 30 } = {}) {
  const snap = await getDb().collection(SIGNUPS_COLLECTION).limit(1000).get();
  const since = jstDate(Date.now() - days * 86400000);

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.date >= since)
    .filter((r) => !accountIds || accountIds.includes(r.accountId));
}

/**
 * 反応の履歴と追加数を、名義×日で突き合わせる。
 * @param {object[]} history history コレクションの行
 * @param {object[]} signups signups コレクションの行
 */
export function joinDaily(history, signups) {
  const byKey = new Map();

  for (const h of history) {
    if (!h.timestamp) continue;
    const date = jstDate(h.timestamp);
    const key = `${h.accountId}_${date}`;
    const cur = byKey.get(key) ?? {
      accountId: h.accountId,
      accountName: h.accountName,
      date,
      posts: 0,
      views: 0,
      likes: 0,
      replies: 0,
      signups: null,
    };
    cur.posts += 1;
    cur.views += h.metrics?.views ?? 0;
    cur.likes += h.metrics?.likes ?? 0;
    cur.replies += h.metrics?.replies ?? 0;
    byKey.set(key, cur);
  }

  for (const s of signups) {
    const key = `${s.accountId}_${s.date}`;
    const cur = byKey.get(key) ?? {
      accountId: s.accountId,
      accountName: s.accountName,
      date: s.date,
      posts: 0,
      views: 0,
      likes: 0,
      replies: 0,
      signups: null,
    };
    cur.signups = s.count;
    cur.accountName = cur.accountName ?? s.accountName;
    byKey.set(key, cur);
  }

  return [...byKey.values()]
    .map((d) => ({ ...d, rate: d.views > 0 && d.signups !== null ? d.signups / d.views : null }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** 名義ごとの合計と登録率。 */
export function byAccountTotals(daily) {
  const map = new Map();

  for (const d of daily) {
    if (d.signups === null) continue; // 追加数が入っていない日は効率を出せない
    const cur = map.get(d.accountName) ?? {
      accountName: d.accountName,
      days: 0,
      posts: 0,
      views: 0,
      likes: 0,
      replies: 0,
      signups: 0,
    };
    cur.days += 1;
    cur.posts += d.posts;
    cur.views += d.views;
    cur.likes += d.likes;
    cur.replies += d.replies;
    cur.signups += d.signups;
    map.set(d.accountName, cur);
  }

  return [...map.values()]
    .map((a) => ({
      ...a,
      rate: a.views > 0 ? a.signups / a.views : null,
      perLike: a.likes > 0 ? a.signups / a.likes : null,
      perReply: a.replies > 0 ? a.signups / a.replies : null,
    }))
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
}

/** 相関係数。母数が少ないときは null を返す（当てにならないため）。 */
export function correlation(pairs, min = 5) {
  const rows = pairs.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (rows.length < min) return null;

  const n = rows.length;
  const mx = rows.reduce((s, [x]) => s + x, 0) / n;
  const my = rows.reduce((s, [, y]) => s + y, 0) / n;

  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of rows) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }

  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : Number((num / den).toFixed(2));
}

/** 表示率の見せ方。 */
export const asPercent = (value) => (value === null ? '-' : `${(value * 100).toFixed(2)}%`);
