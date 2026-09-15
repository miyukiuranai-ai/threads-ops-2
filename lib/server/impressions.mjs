// 表示数の「1時間後・3時間後」と良い・悪いの判定（全名義共通の絶対値）。
import { getDoc, setDoc, listDocs, updateDoc } from './firebase.mjs';
import { nowIso, minutesBetween } from './time.mjs';
import { getInsights } from './threads.mjs';
import { upsertHistory, getHistory, listHistory } from './history.mjs';
import { listPosts, updatePost } from './posts.mjs';

export const DEFAULT_LINES = { bad: 300, good: 1000, buzz: 3000 };

export async function getLines() {
  const s = await getDoc('settings', 'impressions');
  return { ...DEFAULT_LINES, ...(s || {}) };
}

export async function setLines({ bad, good, buzz }, by) {
  const cur = await getLines();
  const next = { bad: Number(bad ?? cur.bad), good: Number(good ?? cur.good), buzz: Number(buzz ?? cur.buzz), updatedBy: by || null, updatedAt: nowIso() };
  await setDoc('settings', 'impressions', next);
  return next;
}

export function verdictOf(views, lines) {
  const v = Number(views) || 0;
  if (v < lines.bad) return 'bad';
  if (v < lines.good) return 'normal';
  if (v < lines.buzz) return 'good';
  return 'buzz';
}

export const VERDICT_JA = { bad: '悪い', normal: '普通', good: '良い', buzz: 'バズ' };

/**
 * 5 分ごとの処理。投稿の 1 時間後と 3 時間後に views/likes/replies を取り、history と posts に残す。
 * accounts: [{id, name, accessToken, threadsUserId}]
 */
export async function takeSnapshots(accounts, { now = new Date() } = {}) {
  const lines = await getLines();
  const results = [];
  const since = new Date(now.getTime() - 8 * 3600000).toISOString();
  for (const acc of accounts) {
    if (!acc.accessToken) continue;
    const hist = await listHistory({ accountId: acc.id, from: since });
    for (const h of hist) {
      if (h.deletedAt || h.snapFailed) continue;
      const age = minutesBetween(h.timestamp, now.toISOString());
      const need1h = !h.snap1h && age >= 60 && age < 180;
      const need3h = !h.snap3h && age >= 180;
      if (!need1h && !need3h) continue;
      try {
        const m = await getInsights(h.threadId, acc.accessToken);
        const snap = { views: m.views, likes: m.likes, replies: m.replies, at: nowIso(), ageMin: Math.round(age) };
        const patch = {};
        if (need1h) {
          patch.snap1h = snap;
          if (m.views >= lines.buzz) patch.verdict1h = 'buzz';
          patch.verdictEarly = verdictOf(m.views, lines);
        }
        if (need3h) {
          patch.snap3h = snap;
          patch.verdict3h = verdictOf(m.views, lines);
          if (!h.snap1h) patch.snap1h = h.snap1h || null;
        }
        await upsertHistory(h.threadId, { ...patch, metrics: m });
        if (h.postId) {
          try { await updatePost(h.postId, patch); } catch { /* 手で出した投稿は無い */ }
        } else {
          const posts = await listPosts({ accountId: acc.id, statuses: ['posted'], limit: 100 });
          const p = posts.find((x) => x.postedThreadId === h.threadId);
          if (p) await updatePost(p.id, patch);
        }
        results.push({ account: acc.name, threadId: h.threadId, ...patch });
      } catch (e) {
        // 取れない投稿（リポスト等）は印を付けて叩き直さない
        if (e.status === 400 || /Unsupported|not supported|does not exist/i.test(e.message)) {
          await updateDoc('history', h.threadId, { snapFailed: String(e.message).slice(0, 200) });
        }
        results.push({ account: acc.name, threadId: h.threadId, error: e.message });
      }
    }
  }
  return results;
}

/** 名義の直近 24 時間で 3 時間後の判定がある最新の投稿 */
export async function latestVerdict(accountId, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - 24 * 3600000).toISOString();
  const hist = await listHistory({ accountId, from: since });
  const withV = hist.filter((h) => h.verdict3h).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return withV[0] || null;
}

/** 直近の 3 時間後判定の並び（新しい順） */
export async function recentVerdicts(accountId, { limit = 5 } = {}) {
  const hist = await listHistory({ accountId, limit: 300 });
  return hist.filter((h) => h.verdict3h).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')).slice(0, limit);
}

export function snapLabel(snap) {
  if (!snap) return '-';
  return String(snap.views ?? '-');
}

export { getHistory };
