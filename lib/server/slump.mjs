// 落ち込み判定。
// 3 時間後の記録が 3 本たまっていれば「悪い」3 連続で抑制中。
// たまるまでは、2〜21 日前の表示数の中央値を基準に、16 時間以上たった直近 3 本の中央値が 15% 未満。
import { listHistory, median } from './history.mjs';
import { recentVerdicts } from './impressions.mjs';
import { addDays } from './time.mjs';

export async function detectSlump(accountId, today, { now = new Date() } = {}) {
  const verdicts = await recentVerdicts(accountId, { limit: 3 });
  if (verdicts.length >= 3) {
    const slump = verdicts.every((h) => h.verdict3h === 'bad');
    return { slump, method: 'verdict', verdicts: verdicts.map((h) => h.verdict3h), baseline: null, recentMedian: null };
  }
  const from = new Date(addDays(today, -21) + 'T00:00:00+09:00').toISOString();
  const to = new Date(addDays(today, -2) + 'T23:59:59+09:00').toISOString();
  const base = await listHistory({ accountId, from, to });
  const baseViews = base.map((h) => h.metrics?.views || 0);
  const baseline = median(baseViews);
  const all = await listHistory({ accountId, from });
  const matured = all.filter((h) => (now.getTime() - new Date(h.timestamp).getTime()) / 3600000 >= 16).slice(0, 3);
  const recentMedian = median(matured.map((h) => h.metrics?.views || 0));
  const slump = baseViews.length >= 4 && baseline >= 300 && matured.length >= 3 && recentMedian < baseline * 0.15;
  return { slump, method: 'median', baseline, recentMedian, samples: baseViews.length };
}
