// 取り込んだ反応を集計する。
//
// 見る指標は「表示数の中央値」を主にする。
//   - 平均は1本のバズに引っ張られる
//   - 表示数はLINE登録との相関がいちばん高かった（r=0.81。コメント数は0.43）
// 母数が少ない区分は当てにならないので、件数も必ず並べて出す。
import { getDb } from './firebase.mjs';
import { HISTORY_COLLECTION } from './scoring.mjs';

/** 生活時間に沿った区切り。投稿枠の帯と同じ考え方。 */
export const BANDS = [
  { key: '00-05', label: '深夜 0-5時', from: 0, to: 5 },
  { key: '05-09', label: '朝 5-9時', from: 5, to: 9 },
  { key: '09-12', label: '午前 9-12時', from: 9, to: 12 },
  { key: '12-17', label: '昼 12-17時', from: 12, to: 17 },
  { key: '17-20', label: '夕 17-20時', from: 17, to: 20 },
  { key: '20-22', label: '宵 20-22時', from: 20, to: 22 },
  { key: '22-24', label: '夜 22-24時', from: 22, to: 24 },
];

/** この件数を下回る区分は「参考値」として扱う。 */
export const THIN_SAMPLE = 5;

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const jstHour = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).getUTCHours();

/** 1区分ぶんの数字をまとめる。 */
function summarize(rows) {
  const views = rows.map((r) => r.metrics?.views ?? 0);
  const likes = rows.map((r) => r.metrics?.likes ?? 0);
  const replies = rows.map((r) => r.metrics?.replies ?? 0);

  return {
    count: rows.length,
    medianViews: median(views),
    medianLikes: median(likes),
    medianReplies: median(replies),
    thin: rows.length < THIN_SAMPLE,
  };
}

/**
 * 分析の材料を読む。
 * @param {string[]|null} accountIds 見てよい名義。null なら全部（管理者）
 */
export async function loadHistory({ accountIds = null, days = 60 } = {}) {
  const snap = await getDb().collection(HISTORY_COLLECTION).limit(1000).get();
  const since = Date.now() - days * 86400000;

  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => r.timestamp && new Date(r.timestamp).getTime() >= since)
    .filter((r) => !accountIds || accountIds.includes(r.accountId));
}

/** 時間帯ごとの成績。投稿枠の出現率を決める材料になる。 */
export function byBand(rows) {
  return BANDS.map((band) => ({
    ...band,
    ...summarize(rows.filter((r) => {
      const h = jstHour(r.timestamp);
      return h >= band.from && h < band.to;
    })),
  }));
}

/** 名義ごとの成績。 */
export function byAccount(rows) {
  const names = [...new Set(rows.map((r) => r.accountName))].filter(Boolean);
  return names
    .map((name) => ({ name, ...summarize(rows.filter((r) => r.accountName === name)) }))
    .sort((a, b) => b.medianViews - a.medianViews);
}

/** 曜日ごとの成績。 */
export function byWeekday(rows) {
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  return labels.map((label, i) => ({
    label,
    ...summarize(
      rows.filter((r) => new Date(new Date(r.timestamp).getTime() + 9 * 3600000).getUTCDay() === i)
    ),
  }));
}

/** 伸びた投稿。スコアではなく表示数で並べる（集客に効くのは表示数のため）。 */
export function topPosts(rows, limit = 10) {
  return [...rows]
    .sort((a, b) => (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0))
    .slice(0, limit);
}

/**
 * 時間帯の成績から、投稿枠の出現率の案を作る。
 * いちばん良い帯を100%として、表示数の比で割り当てる。
 * 母数が少ない帯は下げすぎない（試す機会を残すため）。
 */
export function suggestChances(bands) {
  const usable = bands.filter((b) => b.count > 0);
  if (!usable.length) return [];

  const best = Math.max(...usable.map((b) => b.medianViews));
  if (best <= 0) return [];

  return bands.map((band) => {
    if (!band.count) return { ...band, chance: 50, reason: '実績なし。まず試す' };

    const ratio = band.medianViews / best;
    // 比をそのまま％にせず、25〜100% に収める。0にすると二度と試されない
    let chance = Math.round(25 + ratio * 75);
    if (band.thin) chance = Math.max(chance, 40);

    return {
      ...band,
      chance: Math.min(100, Math.max(25, Math.round(chance / 5) * 5)),
      reason: band.thin ? `母数${band.count}件。参考値` : `表示数の中央値 ${band.medianViews}`,
    };
  });
}

/** いちばん新しい取り込み時刻。 */
export function lastFetchedAt(rows) {
  const times = rows.map((r) => r.fetchedAt).filter(Boolean).sort();
  return times.length ? times[times.length - 1] : null;
}
