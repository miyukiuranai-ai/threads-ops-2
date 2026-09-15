// 昨日の投稿の成績を読んで、続けること・やめることを出す日次レポート。
//
// 表示数だけを見て最適化すると、届く層が広がる方向（＝薄い層）へ進む。
// そこで LINE の追加数も一緒に渡し、「反響」ではなく「集客」で判断させる。
//
// 出したレポートは翌日の生成にも渡す。分析が投稿に効かないと意味がないため。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { generateText } from './claude.mjs';
import { HISTORY_COLLECTION } from './scoring.mjs';
import { loadSignups, joinDaily, jstDate } from './signups.mjs';
import { POST_TYPES } from './generate.mjs';
import { assessMomentum } from './slump.mjs';
import { assessByLines, loadLines, VERDICT_LABEL } from './impressions.mjs';
import { assessStage } from './stage.mjs';

export const REPORTS_COLLECTION = 'reports';

const SYSTEM = `あなたは Threads の占い・霊視アカウントを運用する担当者です。
昨日の投稿と、その反応、LINEの友だち追加数を読んで、短い報告を書きます。

表示数（インプレッション）の見方（運用者の決めごと。必ず従う）:
- 良い・悪いは、フォロワー数や名義の平均・中央値と比べて決めない。全名義共通の線で決める。
  3時間後の表示が 300未満=悪い（配信に乗っていない）/ 300〜1,000=普通 / 1,000〜3,000=良い / 3,000以上=バズ。1時間後に3,000を超えたらその時点でバズ。
- 各投稿に「1h」「3h」の数字と判定が付いていれば、それを使う。無い投稿は翌朝の表示数で同じ線を当てる。
- 「悪い」が3本続いた名義は抑制中と見る。内容の良し悪しではなく、本数を減らして間を空ける提案をする。

判断の軸:
- 最終目的は LINE の登録です。ただし、どの投稿が登録につながったかは切り分けられません。
- そこで代理の指標として「コメントが付いていて、いいねも一定ある投稿」を良しとします。
  コメントが付く投稿は、返信を重ねることで登録につながることが分かっています。
- いいねだけが多くコメントの付かない投稿は、登録につながりにくいことが分かっています。高く評価しないでください。
- 名義単位では、表示1万あたり何人登録したか（取れ高）で比べてください。
- 軸は「この人だからこそ頼りたい」と思わせているか。不安を示してから肯定で受け止められているか。
- 母数が少ないときは断定せず「まだ分からない」と書いてください。数字を作らないでください。
- 投稿の本文そのものを見て、何が効いたのかを言葉で説明してください。時間帯だけの話にしないでください。
- Threads は特性上、バズと落ち込みを繰り返します。「直近7日の推移」と「判定」を見て、1本あたりの表示が落ちているのに本数が増えている、
  本来やりたい型を無理に続けている、といった状態を拾ってください。落ち込んでいる名義に、いつもの型の続行を勧めないでください。
- 「いまの要望の構成」がある名義は、その構成で出した結果を見て、続けるか変えるかを提案してください（例: バズ型を挟んでも伸びなければ属人型を戻す、など）。
- 名義の段階（運用者の考え方）: 落ちて戻る気配がないときは超バズ特化型（画像）を挟む。表示が上がったら属人型を打つチャンスだが、超バズ特化で1回当たっただけでは属人型は打たない。
  超バズ特化を3日回してコンスタントに表示が取れたら「超バズ＋バズ特化」に切り替えて数日、かなり仕上がってから属人型を1本入れる。属人型の投稿は貴重。
  「段階の判定（機械）」に出ている判定と提案を、指摘（alerts）に必ず反映してください。判定に反する提案はしないでください。
- 提案（アナウンス）は出しますが、決めるのは運用者です。「落ちているのでバズ特化を混ぜますか？」「1本に減らしますか？」「今日は休みますか？」
  のように問いの形で書いてください。「落ちた→バズ特化→回復」はまだ検証できていないので、効くと断定しないでください。

書き方:
- 名義ごとに「続けること」「やめること」を挙げます。
- 根拠になる投稿の冒頭を短く引用してください。
- 憶測は憶測と書いてください。
- 変える理由がない名義には「変えない」と書いてください。無理に指摘を作らないでください。

次の JSON だけを返してください。前置きも説明も不要です。

{
  "overall": "全体の所感を3行以内で",
  "alerts": [
    {
      "account": "名義名",
      "level": "落ち込み | 注意 | 好調",
      "message": "何が起きているか（数字を1つ添えて1行）",
      "proposal": "問いの形の提案。無ければ空文字"
    }
  ],
  "accounts": [
    {
      "account": "名義名",
      "keep": ["続けること（1つずつ短く）"],
      "stop": ["やめること。無ければ空配列"],
      "note": "気づいたこと。無ければ空文字"
    }
  ]
}`;

/** レポートの材料を集める。 */
export async function collectReportData({ date = null } = {}) {
  const db = getDb();
  const target = date ?? jstDate(Date.now() - 86400000);

  const [histSnap, accSnap, personaSnap] = await Promise.all([
    db.collection(HISTORY_COLLECTION).limit(1000).get(),
    db.collection(COLLECTIONS.accounts).get(),
    db.collection(COLLECTIONS.personas).get(),
  ]);
  const personaOf = new Map(personaSnap.docs.map((d) => [d.id, d.data()]));

  const history = histSnap.docs.map((d) => d.data()).filter((r) => r.timestamp);
  const accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const signups = await loadSignups({ days: 14 });
  const daily = joinDaily(history, signups);

  // 対象日の投稿を名義ごとにまとめる
  const posts = history.filter((r) => jstDate(r.timestamp) === target);
  const byAccount = new Map();
  const median = (nums) => {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };

  for (const account of accounts) {
    const mine = posts
      .filter((p) => p.accountId === account.id)
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const ownHistory = history.filter((p) => p.accountId === account.id);
    // 直近7日（対象日を含む）の推移。本数と1本あたりの表示（中央値）を並べる
    const series = [];
    for (let back = 6; back >= 0; back -= 1) {
      const d = jstDate(Date.parse(`${target}T12:00:00+09:00`) - back * 86400000);
      const rows = ownHistory.filter((p) => jstDate(p.timestamp) === d);
      series.push({
        date: d,
        posts: rows.length,
        views: rows.reduce((s, p) => s + (p.metrics?.views ?? 0), 0),
        medianViews: median(rows.map((p) => p.metrics?.views ?? 0)),
      });
    }
    const recentlyActive = series.some((s) => s.posts > 0);
    if (!mine.length && !recentlyActive) continue;
    const momentum = assessByLines(ownHistory, { fallback: assessMomentum(ownHistory) });

    const day = daily.find((d) => d.accountId === account.id && d.date === target);

    // 直近7日（対象日を除く）の平均と比べられるようにする
    const past = daily
      .filter((d) => d.accountId === account.id && d.date < target)
      .slice(0, 7);
    const pastViews = past.length
      ? Math.round(past.reduce((s, d) => s + d.views, 0) / past.length)
      : null;
    const pastSignups = past.filter((d) => d.signups !== null);
    const pastRate = pastSignups.length
      ? pastSignups.reduce((s, d) => s + d.signups, 0) /
        Math.max(1, pastSignups.reduce((s, d) => s + d.views, 0))
      : null;

    byAccount.set(account.name, {
      account: account.name,
      posts: mine.map((p) => ({
        time: new Date(new Date(p.timestamp).getTime() + 9 * 3600000).toISOString().slice(11, 16),
        views: p.metrics?.views ?? 0,
        likes: p.metrics?.likes ?? 0,
        replies: p.metrics?.replies ?? 0,
        views1h: p.snap1h?.views ?? null,
        views3h: p.snap3h?.views ?? null,
        verdict: p.verdict3h ?? p.verdictEarly ?? null,
        text: p.text,
      })),
      series,
      momentum,
      dayMix: personaOf.get(account.personaId)?.dayMix ?? null,
      stage: assessStage({ series, dayMix: personaOf.get(account.personaId)?.dayMix ?? [], momentum, noSuperBuzz: personaOf.get(account.personaId)?.noSuperBuzz === true }),
      views: day?.views ?? 0,
      signups: day?.signups ?? null,
      per10k: day?.views ? Number(((day.signups ?? 0) / day.views * 10000).toFixed(1)) : null,
      pastViews,
      past10k: pastRate === null ? null : Number((pastRate * 10000).toFixed(1)),
    });
  }

  return { date: target, accounts: [...byAccount.values()] };
}

/** 材料をモデルに渡す形にする。 */
function buildPrompt({ date, accounts }) {
  const typeList = Object.entries(POST_TYPES)
    .map(([k, v]) => `${k}=${v.label}`)
    .join(' / ');

  const body = accounts
    .map((a) => {
      const head = [
        `## @${a.account}`,
        `表示 ${a.views.toLocaleString()}` +
          (a.pastViews !== null ? `（直近7日平均 ${a.pastViews.toLocaleString()}）` : ''),
        a.signups === null
          ? 'LINE追加数: 未入力'
          : `LINE追加 ${a.signups}人 / 1万表示あたり ${a.per10k}人` +
            (a.past10k !== null ? `（直近7日 ${a.past10k}人）` : ''),
      ].join('\n');

      const posts = a.posts.length
        ? a.posts
            .map(
              (p) =>
                `- ${p.time}  表示${p.views} いいね${p.likes} コメント${p.replies}${p.views1h !== null || p.views3h !== null ? `（1h ${p.views1h ?? '-'} / 3h ${p.views3h ?? '-'}${p.verdict ? ` → ${VERDICT_LABEL[p.verdict] ?? p.verdict}` : ''}）` : ''}\n  ${p.text.replace(/\n/g, ' / ').slice(0, 180)}`
            )
            .join('\n')
        : '- 投稿なし';

      const trend = (a.series ?? [])
        .map((s) => `${s.date.slice(5)} ${s.posts}本/1本あたり${s.medianViews}`)
        .join(' → ');
      const m = a.momentum ?? {};
      const judge =
        m.method === 'lines'
          ? m.state === 'slump'
            ? `落ち込み（直近3本の3時間後がすべて「悪い」: ${m.verdicts.map((v) => VERDICT_LABEL[v] ?? v).join('・')}。ツールは本数を絞る）`
            : `通常（直近3本の3時間後: ${m.verdicts.map((v) => VERDICT_LABEL[v] ?? v).join('・')}）`
          : m.state === 'slump'
            ? `落ち込み（3時間後の記録がまだ無いので従来の判定。直近の1本あたり ${Math.round(m.recent)} / 基準 ${Math.round(m.baseline)}）`
            : m.state === 'normal'
              ? `通常（3時間後の記録がまだ無いので従来の判定。直近の1本あたり ${Math.round(m.recent)} / 基準 ${Math.round(m.baseline)}）`
              : '判定できるだけの投稿がまだ無い';

      const mixLine = a.dayMix?.length
        ? `\nいまの要望の構成: ${a.dayMix.map((t) => POST_TYPES[t]?.label ?? t).join('＋')}（本人の指示。結果を見て見直しを提案してよい）`
        : '';
      const stageLine = a.stage ? `\n段階の判定（機械）: ${a.stage.stage}${a.stage.advice ? ` → 提案: ${a.stage.advice}` : ''}` : '';
      return `${head}\n直近7日の推移（本数/1本あたりの表示の中央値）: ${trend}\n判定: ${judge}${mixLine}${stageLine}\n${posts}`;
    })
    .join('\n\n');

  return `対象日: ${date}（日本時間）
投稿の型: ${typeList}

${body}`;
}

/**
 * 日次レポートを作って保存する。
 * @param {object} opts
 * @param {string} [opts.date] 対象日（既定は昨日）
 * @param {boolean} [opts.dry] 保存しない
 */
export async function generateDailyReport({ date = null, dry = false } = {}) {
  const data = await collectReportData({ date });
  if (!data.accounts.length) {
    return { date: data.date, skipped: '対象日の投稿がありません。' };
  }

  const { text, usage } = await generateText({
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(data) }],
    maxTokens: 8000, // 名義が増え、各投稿の指摘と提案も返すので長くなる
  });

  let parsed;
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const raw = text.slice(start, end + 1);
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 日本語の前に余分なバックスラッシュが混ざることがあるので、正当なエスケープ以外を落として読み直す
      parsed = JSON.parse(raw.replace(/\\(?!["\\/bfnrtu])/g, ''));
    }
  } catch (err) {
    throw new Error(`レポートを読み取れませんでした: ${err.message}`);
  }

  const record = {
    date: data.date,
    overall: parsed.overall ?? '',
    // モデルが「@名前」で返すことがあるので、記録は名前だけに揃える
    accounts: (parsed.accounts ?? []).map((a) => ({
      ...a,
      account: String(a.account ?? '').replace(/^@+/, ''),
    })),
    alerts: (parsed.alerts ?? []).map((a) => ({
      ...a,
      account: String(a.account ?? '').replace(/^@+/, ''),
    })),
    stats: data.accounts.map((a) => ({
      account: a.account,
      views: a.views,
      signups: a.signups,
      per10k: a.per10k,
      past10k: a.past10k,
      posts: a.posts.length,
      // 一気見用: 各投稿の表示数と、直近7日の推移
      postList: a.posts.map((p) => ({
        time: p.time,
        head: p.text.split('\n')[0].slice(0, 28),
        views: p.views,
        likes: p.likes,
        replies: p.replies,
        views1h: p.views1h ?? null,
        views3h: p.views3h ?? null,
        verdict: p.verdict ?? null,
      })),
      series: a.series,
      momentum: a.momentum ? { state: a.momentum.state, method: a.momentum.method ?? 'median', verdicts: a.momentum.verdicts ?? [], baseline: Math.round(a.momentum.baseline), recent: Math.round(a.momentum.recent) } : null,
      stage: a.stage ?? null,
    })),
    usage,
    createdAt: new Date().toISOString(),
  };

  if (!dry) {
    await getDb().collection(REPORTS_COLLECTION).doc(data.date).set(record);
  }

  return record;
}

/** 直近のレポートを読む。 */
export async function loadReports({ limit = 7 } = {}) {
  const snap = await getDb()
    .collection(REPORTS_COLLECTION)
    .orderBy('date', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** その名義について、直近のレポートで言われたことを取り出す（生成に渡す用）。 */
export async function latestGuidance(accountName, { days = 3 } = {}) {
  const reports = await loadReports({ limit: days });
  const keep = [];
  const stop = [];

  for (const r of reports) {
    const mine = (r.accounts ?? []).find((a) => a.account === accountName);
    if (!mine) continue;
    keep.push(...(mine.keep ?? []));
    stop.push(...(mine.stop ?? []));
  }

  return {
    keep: [...new Set(keep)].slice(0, 6),
    stop: [...new Set(stop)].slice(0, 6),
  };
}
