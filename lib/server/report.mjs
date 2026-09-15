// 日次レポート（15:30、対象は前日）。
import { listAccounts, getPersonaForAccount } from './accounts.mjs';
import { listHistory, median } from './history.mjs';
import { listPosts } from './posts.mjs';
import { getSignups } from './signups.mjs';
import { detectSlump } from './slump.mjs';
import { getLines, VERDICT_JA } from './impressions.mjs';
import { complete, parseJson, sumUsage } from './ai.mjs';
import { reportSystem } from './prompts.mjs';
import { getDoc, setDoc } from './firebase.mjs';
import { addDays, jstDate, formatJst, nowIso } from './time.mjs';

function dayRange(date) {
  return { from: new Date(date + 'T00:00:00+09:00').toISOString(), to: new Date(date + 'T23:59:59+09:00').toISOString() };
}

export async function buildStats(accounts, date) {
  const stats = [];
  for (const acc of accounts) {
    const weekFrom = dayRange(addDays(date, -6)).from;
    const all = await listHistory({ accountId: acc.id, from: weekFrom, to: dayRange(date).to });
    const byDay = {};
    for (const h of all) (byDay[jstDate(new Date(h.timestamp))] ||= []).push(h);
    const day = byDay[date] || [];
    const posts = await listPosts({ accountId: acc.id, plannedDate: date, limit: 20 });
    const views = day.reduce((s, h) => s + (h.metrics?.views || 0), 0);
    const signups = (await getSignups(acc.id, date)) ?? 0;
    const per10k = views ? Math.round((signups / views) * 10000 * 10) / 10 : 0;
    const series = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDays(date, -i);
      const list = byDay[d] || [];
      series.push({ date: d, posts: list.length, medianViews: median(list.map((h) => h.metrics?.views || 0)), views: list.reduce((s, h) => s + (h.metrics?.views || 0), 0) });
    }
    const past = series.slice(0, 6).filter((s) => s.posts);
    const pastMedian = median(past.map((s) => s.medianViews));
    const todayMedian = series[6]?.medianViews || 0;
    const momentum = pastMedian ? Math.round((todayMedian / pastMedian) * 100) : null;
    const postList = day.map((h) => {
      const p = posts.find((x) => x.postedThreadId === h.threadId);
      return { threadId: h.threadId, time: formatJst(h.timestamp, { withDate: false }), type: p?.type || h.type || null, views: h.metrics?.views || 0, likes: h.metrics?.likes || 0, replies: h.metrics?.replies || 0, snap1h: h.snap1h?.views ?? null, snap3h: h.snap3h?.views ?? null, verdict3h: h.verdict3h || null, text: (h.text || '').slice(0, 200) };
    }).sort((a, b) => a.time.localeCompare(b.time));
    const persona = await getPersonaForAccount(acc);
    const slump = await detectSlump(acc.id, addDays(date, 1));
    stats.push({ account: acc.name, accountId: acc.id, views, signups, per10k, past10k: past.length ? Math.round(past.reduce((s, x) => s + x.views, 0) / past.length) : 0, posts: day.length, postList, series, momentum, slump: slump.slump, slumpDetail: slump, dayMix: persona.dayMix || [], hasAudience: persona.hasAudience });
  }
  return stats;
}

export async function generateReport(date, { dry = false } = {}) {
  const accounts = await listAccounts();
  const stats = await buildStats(accounts, date);
  const lines = await getLines();
  const user = `対象日: ${date}\n\n` + stats.map((s) => [
    `## @${s.account}`,
    `前日の投稿 ${s.posts} 本、表示合計 ${s.views}、LINE 追加 ${s.signups}（取れ高 ${s.per10k}/1万）、落ち込み判定: ${s.slump ? 'あり' : 'なし'}（${s.slumpDetail.method}）`,
    s.dayMix.length ? `いまの要望の構成: ${s.dayMix.join(', ')}` : '',
    `直近7日の推移（日: 本数 / 表示の中央値）: ${s.series.map((x) => `${x.date.slice(5)}: ${x.posts}本/${x.medianViews}`).join('、')}`,
    '各投稿:',
    ...s.postList.map((p) => `- ${p.time} [${p.type || '?'}] 表示 ${p.views} いいね ${p.likes} コメント ${p.replies} 1h ${p.snap1h ?? '-'} 3h ${p.snap3h ?? '-'} 判定 ${p.verdict3h ? VERDICT_JA[p.verdict3h] : '-'}\n  ${p.text.replace(/\n/g, ' / ')}`),
  ].filter(Boolean).join('\n')).join('\n\n');
  if (dry) return { date, stats, prompt: user };
  let parsed = { overall: '', alerts: [], accounts: [] };
  let usage = null;
  if (stats.some((s) => s.posts)) {
    const res = await complete({ model: 'claude-opus-5', system: reportSystem(lines), user, maxTokens: 4000, effort: 'medium' });
    usage = sumUsage([res.usage]);
    try { parsed = parseJson(res.text); } catch { parsed.overall = res.text.slice(0, 2000); }
  } else {
    parsed.overall = '前日の投稿がありません。まだ分からない。';
  }
  const doc = { date, overall: parsed.overall || '', alerts: parsed.alerts || [], accounts: parsed.accounts || [], stats, usage, lines, createdAt: nowIso() };
  await setDoc('reports', date, doc, { merge: false });
  return doc;
}

export async function getReport(date) { return getDoc('reports', date); }
export async function latestReport() {
  for (let i = 0; i < 7; i++) {
    const r = await getReport(addDays(jstDate(), -i));
    if (r) return r;
  }
  return null;
}
