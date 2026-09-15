// 落ち込みの判定。
// Threads は特性上、バズと落ち込みを繰り返す。落ち込んでいる間は本数を1本に減らし、
// 休む日があってもよい（本人の方針）。良い感じでも本数は増やさない。
const median = (nums) => {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * 直近の表示数を、その前の期間の表示数と比べる。
 * - 基準: 2〜21日前の投稿の表示数の中央値（4本以上あるときだけ判定する）
 * - 直近: 16時間以上たった投稿のうち新しい3本の中央値
 * - 直近が基準の15%未満なら「落ち込み」
 * @returns {{state:'slump'|'normal'|'unknown', baseline:number, recent:number, recentCount:number}}
 */
export function assessMomentum(history, now = new Date()) {
  const t = now.getTime();
  const rows = history
    .filter((h) => h.timestamp && Number.isFinite(h.metrics?.views))
    .map((h) => ({ views: h.metrics.views, ageH: (t - Date.parse(h.timestamp)) / 3600000 }))
    .sort((a, b) => a.ageH - b.ageH);

  const base = rows.filter((r) => r.ageH >= 48 && r.ageH <= 21 * 24).map((r) => r.views);
  const recentRows = rows.filter((r) => r.ageH >= 16 && r.ageH <= 5 * 24).slice(0, 3);
  const recent = recentRows.map((r) => r.views);

  if (base.length < 4 || recent.length < 2) {
    return { state: 'unknown', baseline: median(base), recent: median(recent), recentCount: recent.length };
  }
  const baseline = median(base);
  const recentMedian = median(recent);
  const slump = baseline >= 300 && recentMedian < baseline * 0.15;
  return { state: slump ? 'slump' : 'normal', baseline, recent: recentMedian, recentCount: recent.length };
}
