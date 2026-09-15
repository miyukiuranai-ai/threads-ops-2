// 自分の投稿の反応（表示数・いいね・コメント）を取り込む。
// 読み取りだけで、投稿は一切しない。
//
// コマンド（npm run analyze:fetch）と、毎日の自動取り込みの両方から使う。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { listMyThreads, getThreadInsights } from './threads.mjs';
import { scorePost, HISTORY_COLLECTION } from './scoring.mjs';
import { jstClock } from './post-time.mjs';

/** 毎日の自動取り込みを回す時刻（日本時間）。投稿の少ない時間帯に置く。 */
export const COLLECT_AT = process.env.INSIGHTS_COLLECT_AT ?? '03:20';

/** 自動取り込みで見る日数。古いぶんは既に貯まっているので短くてよい。 */
const AUTO_DAYS = 4;

const WINDOW_MINUTES = 40;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** いまが取り込みの時間帯か。投稿実行（5分おき）から呼ばれる。 */
export function shouldCollectNow(now = new Date()) {
  const at = toMin(COLLECT_AT);
  const cur = toMin(jstClock(now));
  if (at === null || cur === null) return false;
  return cur >= at && cur < at + WINDOW_MINUTES;
}

/** インサイトのレスポンスを {views, likes, ...} の形にほぐす。 */
function flattenInsights(payload) {
  const metrics = {};
  for (const m of payload.data ?? []) {
    metrics[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
  }
  return metrics;
}

/** ページングしながら期間内の自分の投稿を集める。 */
async function fetchThreads({ accessToken, userId, since, maxPages = 20 }) {
  const all = [];
  let after;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await listMyThreads({ accessToken, userId, limit: 100, since, after });
    all.push(...(res.data ?? []));
    after = res.paging?.cursors?.after;
    if (!after || !res.data?.length) break;
    await sleep(200);
  }
  return all;
}

/**
 * 反応を取り込む。1名義の失敗が他名義を止めない。
 * @param {object} opts
 * @param {number} [opts.days] 何日ぶんを見るか
 * @param {string} [opts.accountName] 1名義だけ対象にする
 */
export async function collectInsights({ days = AUTO_DAYS, accountName = null, log = () => {} } = {}) {
  const db = getDb();
  const startedAt = new Date().toISOString();

  let accounts = (await db.collection(COLLECTIONS.accounts).get()).docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));

  if (accountName) {
    const needle = accountName.replace(/^@/, '').toLowerCase();
    accounts = accounts.filter((a) => (a.name ?? '').toLowerCase() === needle);
    if (!accounts.length) throw new Error(`名義 "${accountName}" が見つかりません。`);
  }

  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const results = [];

  for (const account of accounts) {
    try {
      const threads = await fetchThreads({
        accessToken: account.accessToken,
        userId: account.threadsUserId,
        since,
      });

      // リプライとして出したものは分析から外す（本文投稿だけを見る）
      const posts = threads.filter((t) => t.text && !t.replied_to);
      log(`@${account.name}: 投稿 ${posts.length}件`);

      let saved = 0;
      let failed = 0;

      for (const post of posts) {
        let metrics = {};
        try {
          metrics = flattenInsights(
            await getThreadInsights({ accessToken: account.accessToken, threadId: post.id })
          );
        } catch {
          failed += 1;
        }

        await db
          .collection(HISTORY_COLLECTION)
          .doc(post.id)
          .set(
            {
              accountId: account.id,
              accountName: account.name,
              threadId: post.id,
              text: post.text,
              permalink: post.permalink ?? null,
              timestamp: post.timestamp ?? null,
              mediaType: post.media_type ?? null,
              metrics,
              ...scorePost({ metrics, timestamp: post.timestamp }),
              fetchedAt: new Date().toISOString(),
            },
            { merge: true }
          );

        saved += 1;
        await sleep(120);
      }

      results.push({ account: account.name, result: 'ok', saved, failed });
    } catch (err) {
      results.push({ account: account.name, result: 'failed', reason: err.message });
      log(`@${account.name}: 取得失敗 ${err.message.split('\n').pop().trim()}`);
    }
  }

  const summary = results.reduce((acc, r) => {
    acc[r.result] = (acc[r.result] ?? 0) + 1;
    return acc;
  }, {});

  await db.collection(COLLECTIONS.runs).add({
    job: 'insights',
    startedAt,
    finishedAt: new Date().toISOString(),
    status: results.some((r) => r.result === 'failed') ? 'failed' : 'ok',
    summary,
    message: `反応の取り込み: ${results.reduce((n, r) => n + (r.saved ?? 0), 0)}件`,
    results,
  });

  return { startedAt, summary, results };
}
