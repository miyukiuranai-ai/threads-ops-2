// 投稿ごとの「1時間後」「3時間後」の表示数を取り、良い・悪いを付ける。
//
// 本人の方針（9/14）:
//   - 大事なのはインプレッション（表示数）。いいねとコメントより先に見る。
//   - フォロワー数や名義ごとの平均・中央値は基準にしない。Threads は配信に乗ったかどうかで
//     表示が決まるので、全名義共通の絶対値で判定する。
//   - 3時間後で判定する（1日4本の名義でも次の1本の判断に間に合う）。1時間後に「バズ」の線を
//     超えていたら、その時点でバズと確定する。
//   - 「悪い」が3本続いたら、その名義は抑制中と見て本数を減らす。
//
// 線（既定。settings/impressions で変えられる）:
//   300未満 = 悪い（配信に乗っていない） / 300〜1,000 = 普通 / 1,000〜3,000 = 良い / 3,000以上 = バズ
import { getDb, COLLECTIONS } from './firebase.mjs';
import { HISTORY_COLLECTION } from './scoring.mjs';
import { getThreadInsights } from './threads.mjs';

export const DEFAULT_LINES = { bad: 300, good: 1000, buzz: 3000 };

/** 判定の見せ方。 */
export const VERDICT_LABEL = { bad: '悪い', normal: '普通', good: '良い', buzz: 'バズ' };

/** 1時間後・3時間後を取る目安（分）。取り逃しても、次の5分で「まだ取っていなければ取る」ので厳密でなくてよい。 */
const SNAP_MINUTES = { snap1h: 60, snap3h: 180 };
/** これより古い投稿は、もう「1時間後」「3時間後」とは言えないので取らない。 */
const MAX_AGE_MINUTES = 8 * 60;

let cachedLines = null;
let cachedAt = 0;

/** 判定の線を読む（5分だけ覚えておく）。 */
export async function loadLines() {
  if (cachedLines && Date.now() - cachedAt < 5 * 60000) return cachedLines;
  let lines = { ...DEFAULT_LINES };
  try {
    const snap = await getDb().collection('settings').doc('impressions').get();
    if (snap.exists) {
      const d = snap.data();
      for (const k of ['bad', 'good', 'buzz']) if (Number.isFinite(d[k]) && d[k] > 0) lines[k] = d[k];
    }
  } catch {
    // 読めなければ既定の線
  }
  cachedLines = lines;
  cachedAt = Date.now();
  return lines;
}

/** 判定の線を書く（運用者が変える）。 */
export async function saveLines({ bad, good, buzz }, by = 'admin') {
  const cur = await loadLines();
  const next = {
    bad: Number.isFinite(bad) ? bad : cur.bad,
    good: Number.isFinite(good) ? good : cur.good,
    buzz: Number.isFinite(buzz) ? buzz : cur.buzz,
  };
  if (!(next.bad < next.good && next.good < next.buzz)) throw new Error('線は 悪い < 良い < バズ の順にしてください。');
  await getDb().collection('settings').doc('impressions').set({ ...next, updatedAt: new Date().toISOString(), updatedBy: by }, { merge: true });
  cachedLines = next;
  cachedAt = Date.now();
  return next;
}

/** 表示数から判定を返す。 */
export function verdictFor(views, lines = DEFAULT_LINES) {
  const v = Number(views ?? 0);
  if (v >= lines.buzz) return 'buzz';
  if (v >= lines.good) return 'good';
  if (v >= lines.bad) return 'normal';
  return 'bad';
}

function flatten(res) {
  const out = {};
  for (const item of res?.data ?? []) {
    const value = item.values?.[0]?.value ?? item.total_value?.value ?? 0;
    out[item.name] = Number(value) || 0;
  }
  return out;
}

/**
 * 直近8時間の自投稿を見て、1時間後・3時間後の数字がまだ無いものを取る。
 * 5分ごとに呼ぶ。対象は history（毎朝の取り込み＋手投稿の発見＋ツール投稿）で、
 * ツールで出した投稿は posts 側にも同じ数字を書いて画面に出す。
 */
export async function takeSnapshots({ now = new Date(), log = () => {} } = {}) {
  const db = getDb();
  const lines = await loadLines();
  const sinceIso = new Date(now.getTime() - MAX_AGE_MINUTES * 60000).toISOString();

  const accounts = new Map(
    (await db.collection(COLLECTIONS.accounts).get()).docs.map((d) => [d.id, { id: d.id, ...d.data() }])
  );

  // 候補: 8時間以内の投稿（history）。ツールで出した直後の投稿は history にまだ無いので posts からも拾う
  const [histSnap, postsSnap] = await Promise.all([
    db.collection(HISTORY_COLLECTION).where('timestamp', '>=', sinceIso).get(),
    db.collection(COLLECTIONS.posts).where('postedAt', '>=', sinceIso).get(),
  ]);
  const candidates = new Map();
  for (const d of histSnap.docs) {
    const h = d.data();
    if (!h.threadId || !h.timestamp) continue;
    candidates.set(h.threadId, { threadId: h.threadId, accountId: h.accountId, postedAt: h.timestamp, hist: h, postId: null });
  }
  for (const d of postsSnap.docs) {
    const p = d.data();
    if (p.status !== 'posted' || !p.postedThreadId || !p.postedAt) continue;
    const c = candidates.get(p.postedThreadId) ?? { threadId: p.postedThreadId, accountId: p.accountId, postedAt: p.postedAt, hist: null };
    c.postId = d.id;
    c.post = p;
    candidates.set(p.postedThreadId, c);
  }

  const results = { checked: 0, taken: 0, errors: [] };
  for (const c of candidates.values()) {
    const account = accounts.get(c.accountId);
    if (!account?.accessToken) continue;
    const ageMin = (now.getTime() - Date.parse(c.postedAt)) / 60000;
    const have = { ...(c.hist ?? {}), ...(c.post ?? {}) };
    const due = [];
    for (const [key, min] of Object.entries(SNAP_MINUTES)) {
      if (ageMin >= min && ageMin <= MAX_AGE_MINUTES && !have[key]) due.push(key);
    }
    if (!due.length) continue;
    results.checked += 1;

    let metrics;
    try {
      metrics = flatten(await getThreadInsights({ accessToken: account.accessToken, threadId: c.threadId }));
    } catch (err) {
      // 数字が取れない投稿（リポストや引用など）は、5分ごとに叩き直さないように「取れなかった」と残す
      const failed = { views: null, error: err.message.split('\n')[0], at: now.toISOString() };
      const mark = Object.fromEntries(due.map((k) => [k, failed]));
      await db.collection(HISTORY_COLLECTION).doc(c.threadId).set({ ...mark, threadId: c.threadId, accountId: c.accountId, timestamp: c.postedAt }, { merge: true });
      if (c.postId) await db.collection(COLLECTIONS.posts).doc(c.postId).set(mark, { merge: true });
      results.errors.push({ account: account.name, threadId: c.threadId, error: failed.error });
      continue;
    }
    const snap = {
      views: metrics.views ?? 0,
      likes: metrics.likes ?? 0,
      replies: metrics.replies ?? 0,
      minutes: Math.round(ageMin),
      at: now.toISOString(),
    };
    const patch = {};
    for (const key of due) {
      patch[key] = snap;
      if (key === 'snap3h') patch.verdict3h = verdictFor(snap.views, lines);
      // 1時間でバズの線を超えたら、その時点でバズと確定
      if (key === 'snap1h' && snap.views >= lines.buzz) patch.verdict1h = 'buzz';
    }
    // 3時間後がまだで、1時間後がバズなら仮の判定として見せる
    if (!patch.verdict3h && !have.verdict3h && (patch.verdict1h || have.verdict1h)) patch.verdictEarly = 'buzz';

    const histRef = db.collection(HISTORY_COLLECTION).doc(c.threadId);
    await histRef.set(
      {
        ...patch,
        accountId: c.accountId,
        accountName: account.name,
        threadId: c.threadId,
        timestamp: c.postedAt,
        ...(c.hist ? {} : { text: c.post?.body ?? null, source: 'tool' }),
      },
      { merge: true }
    );
    if (c.postId) await db.collection(COLLECTIONS.posts).doc(c.postId).set(patch, { merge: true });
    results.taken += 1;
    log(`@${account.name} ${due.join('+')} 表示${snap.views}${patch.verdict3h ? ` → ${VERDICT_LABEL[patch.verdict3h]}` : ''}`);
  }
  return results;
}

/**
 * 名義の勢いを、3時間後の判定の並びで見る（平均や中央値は使わない）。
 * - 直近3本の3時間後が全部「悪い」なら落ち込み（抑制中）
 * - 3時間後の記録がまだ3本無いときは、fallback（従来の判定）を返す
 */
export function assessByLines(history, { fallback = null, now = new Date() } = {}) {
  const rows = history
    .filter((h) => h.timestamp && h.snap3h && Number.isFinite(h.snap3h.views))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .filter((h) => now.getTime() - Date.parse(h.timestamp) <= 5 * 86400000)
    .slice(0, 3);
  if (rows.length < 3) {
    return { ...(fallback ?? { state: 'unknown', baseline: 0, recent: 0, recentCount: rows.length }), method: fallback ? 'median' : 'none', verdicts: rows.map((r) => r.verdict3h) };
  }
  const verdicts = rows.map((r) => r.verdict3h ?? 'bad');
  const views = rows.map((r) => r.snap3h.views);
  const slump = verdicts.every((v) => v === 'bad');
  return {
    state: slump ? 'slump' : 'normal',
    method: 'lines',
    verdicts,
    recent: Math.max(...views),
    baseline: DEFAULT_LINES.bad,
    recentCount: rows.length,
  };
}

/** 生成やレポートに渡す「直前の投稿の成績」。新しい順に count 本。 */
export function recentVerdicts(history, count = 3) {
  return history
    .filter((h) => h.timestamp && (h.snap3h?.views != null || h.snap1h?.views != null))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, count)
    .map((h) => ({
      at: h.timestamp,
      head: String(h.text ?? '').split('\n')[0].slice(0, 24),
      views1h: h.snap1h?.views ?? null,
      views3h: h.snap3h?.views ?? null,
      verdict: h.verdict3h ?? h.verdictEarly ?? null,
    }));
}
