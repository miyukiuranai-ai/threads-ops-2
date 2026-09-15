// 自分の投稿と反応（history）。ID は threadId。
import { getDoc, listDocs, setDoc, updateDoc } from './firebase.mjs';
import { nowIso, addDays, jstDate } from './time.mjs';

export function engagementsOf(m) {
  if (!m) return 0;
  return (m.likes || 0) + (m.replies || 0) + (m.reposts || 0) + (m.quotes || 0) + (m.shares || 0);
}

/** 評価点: コメントが付いていいねも一定ある投稿を良しとする。いいねだけは評価しない */
export function scoreOf(m) {
  if (!m) return 0;
  const replies = m.replies || 0;
  const likes = m.likes || 0;
  if (replies === 0) return 0;
  return replies * 10 + Math.min(likes, replies * 5);
}

export async function upsertHistory(threadId, data) {
  const existing = await getDoc('history', threadId);
  const metrics = data.metrics || existing?.metrics || null;
  const doc = {
    ...(existing || {}),
    ...data,
    threadId,
    metrics,
    engagements: metrics ? engagementsOf(metrics) : existing?.engagements || 0,
    engagementRate: metrics?.views ? engagementsOf(metrics) / metrics.views : existing?.engagementRate || 0,
    score: metrics ? scoreOf(metrics) : existing?.score || 0,
    fetchedAt: data.metrics ? nowIso() : existing?.fetchedAt || null,
    createdAt: existing?.createdAt || nowIso(),
  };
  delete doc.id;
  await setDoc('history', threadId, doc, { merge: false });
  return { id: threadId, ...doc };
}

export async function getHistory(threadId) { return getDoc('history', threadId); }

export async function listHistory({ accountId, from, to, limit = 1000 } = {}) {
  const where = [];
  if (accountId) where.push(['accountId', '==', accountId]);
  if (from) where.push(['timestamp', '>=', from]);
  if (to) where.push(['timestamp', '<=', to]);
  const list = await listDocs('history', { where, limit });
  return list.filter((h) => !h.deletedAt).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

export async function markDeleted(threadId, by) {
  await updateDoc('history', threadId, { deletedAt: nowIso(), deletedBy: by || null });
}

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 名義ごとの「集客が来ているか」判定に使う: 直近 30 日に 1,000 以上の投稿があるか */
export async function hasBigPostSince(accountId, days = 30, today = jstDate(), threshold = 1000) {
  const from = new Date(addDays(today, -days) + 'T00:00:00+09:00').toISOString();
  const list = await listHistory({ accountId, from });
  return list.some((h) => (h.metrics?.views || 0) >= threshold);
}

/** 日ごとの最高表示（超バズを差し込む判定用）。{date: max} */
export async function dailyMaxViews(accountId, days, today = jstDate()) {
  const from = new Date(addDays(today, -days) + 'T00:00:00+09:00').toISOString();
  const list = await listHistory({ accountId, from });
  const out = {};
  for (const h of list) {
    const d = jstDate(new Date(h.timestamp));
    const v = h.snap3h?.views ?? h.metrics?.views ?? 0;
    out[d] = Math.max(out[d] || 0, v);
  }
  return out;
}

/** 当たった投稿の骨格（reuseWinners）。期間があればその期間の全投稿、無ければコメント数順 */
export async function winners(accountId, { from, to, max = 24 } = {}) {
  let list;
  if (from) {
    list = await listHistory({ accountId, from: new Date(from + 'T00:00:00+09:00').toISOString(), to: to ? new Date(to + 'T23:59:59+09:00').toISOString() : undefined });
    list = list.filter((h) => h.text).sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    if (list.length > max) {
      const step = list.length / max;
      list = Array.from({ length: max }, (_, i) => list[Math.floor(i * step)]);
    }
  } else {
    list = await listHistory({ accountId });
    list = list.filter((h) => h.text).sort((a, b) => (b.metrics?.replies || 0) - (a.metrics?.replies || 0) || (b.metrics?.views || 0) - (a.metrics?.views || 0)).slice(0, max);
  }
  return list.map((h) => ({ text: h.text, replies: h.metrics?.replies || 0, views: h.metrics?.views || 0 }));
}
