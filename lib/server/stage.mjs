// 名義の「段階」の判定。レポートの指摘に使う。
//
// 本人の考え方（2026-09-12）:
//   - 落ちて戻る気配がないときに超バズ特化型を挟む
//   - 表示が上がったら属人型を打つチャンス。ただし超バズ特化で1回当たっただけでは属人は打たない
//   - 超バズ特化を3日回してコンスタントに表示が取れたら、超バズ＋バズ特化に切り替えて数日
//   - かなり仕上がってきたら属人型を入れる。属人型の投稿は貴重
//
// ここでは「戻る気配」「コンスタント」「1回当たっただけ」を数で決め、提案は問いの形で返す。決めるのは運用者。

const STEADY_MIN_VIEWS = 300; // 1本あたりの表示がこれ以上なら「取れている」
const STEADY_DAYS = 3; // 何日続けば「コンスタント」か
const SPIKE_RATIO = 5; // 最大が最小の5倍以上なら「1回当たっただけ」

function tail(series, n) {
  return (series ?? []).filter((d) => d.posts > 0).slice(-n);
}

/**
 * @param {object} p
 * @param {Array<{date:string,posts:number,medianViews:number}>} p.series 直近7日の推移（古い順）
 * @param {string[]} p.dayMix いまの要望の構成（無ければ []）
 * @param {{state:string,baseline:number,recent:number}} p.momentum 落ち込み判定
 * @returns {{stage:string, advice:string|null, level:'落ち込み'|'注意'|'好調'|null}}
 */
export function assessStage({ series = [], dayMix = [], momentum = null, noSuperBuzz = false }) {
  const has = (t) => dayMix.includes(t);
  const hasSuper = has('image_buzz');
  const hasBuzz = has('buzz_engagement') || has('reading_open');
  // 要望の構成が無い名義は、帯の設定どおり（除外フックと属人型）で回っているとみなす
  const hasIntro = dayMix.length ? has('attract_intro') || has('travel_note') || has('shrine_visit') || has('personal_note') : true;

  const last3 = tail(series, STEADY_DAYS);
  const vals = last3.map((d) => d.medianViews);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 0;
  const steady = vals.length >= STEADY_DAYS && min >= STEADY_MIN_VIEWS && max / Math.max(1, min) < SPIKE_RATIO;
  const spike = vals.length >= 2 && max >= 1000 && min < STEADY_MIN_VIEWS;

  // 戻る気配: 直近3日の平均が、その前の3日の平均を上回っているか
  const prev3 = (series ?? []).filter((d) => d.posts > 0).slice(-6, -3);
  const avg = (rows) => (rows.length ? rows.reduce((s, d) => s + d.medianViews, 0) / rows.length : 0);
  const recovering = prev3.length >= 2 && last3.length >= 2 && avg(last3) > avg(prev3) * 1.3;

  const slump = momentum?.state === 'slump';

  if (slump && !hasSuper && !recovering) {
    return {
      stage: '落ち込み・戻る気配なし',
      // 一度上がった名義（うた・星蘭）は超バズ特化まではしない。バズ特化で立て直す
      advice: noSuperBuzz
        ? 'バズ特化型だけで立て直しますか？（この名義は超バズ特化型を使わない方針。属人型はいったん減らす）'
        : '超バズ特化型を挟みますか？（構成に「超バズ」を足す。属人型はいったん止める）',
      level: '落ち込み',
    };
  }
  if (slump && !hasSuper && recovering) {
    return { stage: '落ち込み・戻りかけ', advice: 'バズ特化型で立て直し中。属人型はまだ。3日安定したら属人を1本', level: '注意' };
  }
  if (hasSuper && !hasBuzz) {
    if (steady) {
      return { stage: '超バズで安定', advice: `超バズ特化で${STEADY_DAYS}日コンスタントに取れています。次は超バズ＋バズ特化に切り替えますか？`, level: '好調' };
    }
    if (spike) {
      return { stage: '超バズで1回当たり', advice: '1回当たっただけです。属人型は打たず、超バズ特化を続けて様子を見る', level: '注意' };
    }
    return { stage: '超バズ運用中', advice: null, level: null };
  }
  if (hasSuper && hasBuzz && !hasIntro) {
    if (steady) {
      return { stage: '超バズ＋バズ特化で安定', advice: 'かなり仕上がってきました。属人型を1本入れますか？（属人型は貴重。1本から）', level: '好調' };
    }
    if (spike) {
      return { stage: '超バズ＋バズ特化・当たりは単発', advice: '単発の当たりなので属人型はまだ。数日続ける', level: '注意' };
    }
    return { stage: '超バズ＋バズ特化で運用中', advice: null, level: null };
  }
  if (hasIntro && hasSuper) {
    return { stage: '超バズと属人を併用', advice: steady ? null : '表示が安定していません。属人型を止めて超バズ＋バズ特化に戻しますか？', level: steady ? null : '注意' };
  }
  if (hasIntro && !slump) {
    return { stage: '属人型で集客中', advice: null, level: null };
  }
  return { stage: '判定材料が足りない', advice: null, level: null };
}
