// 投稿の反応をスコア化する。
// 「表示されたうち、どれだけ人を動かせたか」を見る。表示数が多いだけの投稿を上位にしない。

/** 自分の過去投稿と実績を貯めるコレクション。 */
export const HISTORY_COLLECTION = 'history';

// 行動の重み。コストの高い行動ほど高く評価する。
const WEIGHTS = {
  likes: 1,
  replies: 3,
  reposts: 4,
  quotes: 4,
  shares: 2,
};

/** 表示数が少ない投稿の比率が暴れるのを抑える下駄。 */
const VIEW_FLOOR = 300;

/**
 * 投稿1件をスコア化する。
 * @returns {{score:number, engagements:number, engagementRate:number, ageHours:number|null}}
 */
export function scorePost({ metrics = {}, timestamp = null }) {
  const views = Number(metrics.views ?? 0);
  const engagements = Object.entries(WEIGHTS).reduce(
    (sum, [key, weight]) => sum + Number(metrics[key] ?? 0) * weight,
    0
  );

  // 反応率（重み付き）。表示が伸びていない投稿を過大評価しないよう下駄を履かせる
  const engagementRate = engagements / Math.max(views, VIEW_FLOOR);

  // 投稿からの経過時間。新しい投稿はまだ数字が伸びる途中なので、参考値として持つ
  const ageHours = timestamp
    ? Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 3600000)
    : null;

  // スコアは反応率を主軸に、規模の大きさを対数で少しだけ加味する
  const scale = Math.log10(Math.max(views, 1) + 1);
  const score = engagementRate * 100 * (1 + scale / 10);

  return {
    score: Number(score.toFixed(3)),
    engagements,
    engagementRate: Number(engagementRate.toFixed(5)),
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(1)),
  };
}
