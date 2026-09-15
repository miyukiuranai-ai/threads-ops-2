// 投稿1本ごとの切り替え。
//
// 本人の方針（9/14）: 次の1本の型は「前の1本の3時間後の判定」で決める。
//   悪い（300未満） → 超バズ特化か バズ特化（超バズを使わない名義はバズ特化）
//   普通（300〜1,000） → バズ特化
//   良い・バズ（1,000以上） → 属人。属人で1,000付いたらバズ扱いで属人を続ける
//
// 費用を増やさないため、15:30 に作った1日ぶんはそのままにし、各投稿の2時間前に上の表と見比べて
// 「型の段（超バズ／バズ／属人）が違うときだけ」その1本を作り直す。同じ段なら何もしない。
// 作り直した1本は承認待ちに入り、見なければ投稿時刻に自動で承認する（画像が要るのに無いものは出さない）。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { HISTORY_COLLECTION } from './scoring.mjs';
import { generateForAccount } from './pipeline.mjs';
import { POST_TYPES } from './generate.mjs';
import { stockSummary, pickStock, stockToMedia, markStockUsed } from './stock.mjs';
import { needsImage } from './image-need.mjs';
import { attachedMedia } from './storage.mjs';
import { VERDICT_LABEL } from './impressions.mjs';

/** 型の段。段が同じなら作り直さない（名乗り→素の属人、のような入れ替えはしない）。 */
const TIER = {
  image_buzz: 'super',
  buzz_engagement: 'buzz',
  reading_open: 'buzz',
  attract_intro: 'personal',
  personal_note: 'personal',
  shrine_visit: 'personal',
  travel_note: 'personal',
  exclusion_hook: 'personal',
};

/** 何分前に見比べるか。5分ごとの処理なので、この幅に入った最初の回で判断する。 */
const LOOKAHEAD_MINUTES = 125;
/** 直前の投稿として見るのは、これより新しいもの。 */
const PREV_MAX_AGE_HOURS = 24;

/** 直前の投稿の判定から、次に打つべき型を決める。 */
export function nextTypeFor(verdict, { noSuperBuzz = false, hasStock = true } = {}) {
  if (verdict === 'bad') return !noSuperBuzz && hasStock ? 'image_buzz' : 'buzz_engagement';
  if (verdict === 'normal') return 'buzz_engagement';
  if (verdict === 'good' || verdict === 'buzz') return 'attract_intro';
  return null;
}

/**
 * これから2時間以内に出る投稿を、直前の投稿の判定と見比べ、段が違えば作り直す。
 * 5分ごとに呼ぶ。
 */
export async function switchUpcomingPosts({ now = new Date(), log = () => {} } = {}) {
  const db = getDb();
  const nowIso = now.toISOString();
  const untilIso = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60000).toISOString();
  const results = { checked: 0, switched: 0, kept: 0, skipped: 0, errors: [] };

  const snap = await db.collection(COLLECTIONS.posts).where('scheduledAt', '>', nowIso).where('scheduledAt', '<=', untilIso).get();
  const upcoming = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => ['pending', 'approved'].includes(p.status) && !p.preSwitchCheckedAt);
  if (!upcoming.length) return results;

  const accounts = new Map((await db.collection(COLLECTIONS.accounts).get()).docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  const personaCache = new Map();
  const historyCache = new Map();

  for (const post of upcoming) {
    const mark = (extra = {}) => db.collection(COLLECTIONS.posts).doc(post.id).set({ preSwitchCheckedAt: nowIso, ...extra }, { merge: true });
    try {
      const account = accounts.get(post.accountId);
      if (!account || (account.status ?? 'active') !== 'active' || !account.personaId) {
        results.skipped += 1;
        await mark({ preSwitchNote: '停止中の名義' });
        continue;
      }
      if (!personaCache.has(account.personaId)) {
        const ps = await db.collection(COLLECTIONS.personas).doc(account.personaId).get();
        personaCache.set(account.personaId, ps.exists ? { id: ps.id, ...ps.data() } : null);
      }
      const persona = personaCache.get(account.personaId);
      if (!persona || persona.perPostSwitch === false) {
        results.skipped += 1;
        await mark({ preSwitchNote: 'この名義は切り替えない設定' });
        continue;
      }
      // 超バズ特化だけの名義（雅）は表を当てない
      if (Array.isArray(persona.dayMix) && persona.dayMix.length && persona.dayMix.every((t) => t === 'image_buzz')) {
        results.skipped += 1;
        await mark({ preSwitchNote: '超バズ特化だけの名義' });
        continue;
      }
      if (post.lockedType || post.switchedFrom) {
        results.skipped += 1;
        await mark({ preSwitchNote: post.switchedFrom ? '切り替え済み' : '型を固定した投稿' });
        continue;
      }

      results.checked += 1;
      if (!historyCache.has(account.id)) {
        const hs = await db.collection(HISTORY_COLLECTION).where('accountId', '==', account.id).get();
        historyCache.set(account.id, hs.docs.map((d) => d.data()));
      }
      const prev = historyCache
        .get(account.id)
        .filter((h) => h.timestamp && Date.parse(h.timestamp) < now.getTime() && now.getTime() - Date.parse(h.timestamp) <= PREV_MAX_AGE_HOURS * 3600000)
        .filter((h) => h.verdict3h || h.verdictEarly)
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0];
      if (!prev) {
        results.kept += 1;
        await mark({ preSwitchNote: '直前の投稿の判定がまだ無い' });
        continue;
      }
      const verdict = prev.verdict3h ?? prev.verdictEarly;
      const hasStock = (await stockSummary(account.id)).length > 0;
      const desired = nextTypeFor(verdict, { noSuperBuzz: persona.noSuperBuzz === true, hasStock });
      const prevHead = String(prev.text ?? '').split('\n')[0].slice(0, 20);
      const reason = `直前「${prevHead}」3時間後 ${prev.snap3h?.views ?? prev.snap1h?.views ?? '-'} → ${VERDICT_LABEL[verdict] ?? verdict}`;
      if (!desired || TIER[desired] === TIER[post.type]) {
        results.kept += 1;
        await mark({ preSwitchNote: `${reason}。${POST_TYPES[post.type]?.label ?? post.type} のまま` });
        continue;
      }

      // 段が違う → この1本だけ作り直す（時刻はそのまま）
      const jst = new Date(Date.parse(post.scheduledAt) + 9 * 3600000);
      const slot = post.slot ?? `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
      const r = await generateForAccount(account, {
        date: post.plannedDate ?? jst.toISOString().slice(0, 10),
        types: [desired],
        slots: [slot],
        instruction: `直前の投稿の結果（${reason}）を受けて、この1本は${POST_TYPES[desired]?.label ?? desired}で書く`,
      });
      const made = r.posts[0];
      if (!made?.id) throw new Error('作り直しの結果が空でした');
      // 作り直しは人が気づけないので、画像が要るのに無ければストックのどれかを付ける（本人 9/14「ストックから使ってくれると助かる」）
      const fix = {};
      if (made.status === 'held' && made.holdReason === '画像が未準備') {
        const kind = made.imageKind === 'single' ? 'single' : 'pair';
        const item = (await pickStock({ kind, accountId: account.id })) ?? (await pickStock({ kind: kind === 'pair' ? 'single' : 'pair', accountId: account.id }));
        if (item) {
          Object.assign(fix, { media: stockToMedia(item), stockId: item.id, imageKind: item.kind, imageGenre: item.genre ?? null, status: 'pending', holdReason: null, imageBrief: null });
          await markStockUsed(item.id, account.id, made.id);
        }
      }
      await db.collection(COLLECTIONS.posts).doc(made.id).set(
        {
          ...fix,
          scheduledAt: post.scheduledAt,
          slot: post.slot ?? slot,
          switchedFrom: post.id,
          switchReason: reason,
          autoApprove: true, // 見なければ投稿時刻に自動で承認する
          preSwitchCheckedAt: nowIso,
        },
        { merge: true }
      );
      await db.collection(COLLECTIONS.posts).doc(post.id).set(
        { status: 'rejected', rejectedAt: nowIso, rejectReason: `投稿ごとの切り替え: ${reason} → ${POST_TYPES[desired]?.label ?? desired} に作り直し`, preSwitchCheckedAt: nowIso },
        { merge: true }
      );
      results.switched += 1;
      log(`@${account.name} ${slot} ${POST_TYPES[post.type]?.label ?? post.type} → ${POST_TYPES[desired]?.label ?? desired}（${reason}）`);
    } catch (err) {
      results.errors.push({ post: post.id, error: err.message.split('\n')[0] });
      await mark({ preSwitchNote: `失敗: ${err.message.split('\n')[0]}` });
    }
  }
  return results;
}

/**
 * 作り直した投稿（autoApprove）が投稿時刻を迎えていて承認待ちのままなら、自動で承認する。
 * 画像が要るのに無いものは承認しない（そのまま残す）。5分ごと、投稿の直前に呼ぶ。
 */
export async function autoApproveSwitched({ now = new Date() } = {}) {
  const db = getDb();
  const dueIso = new Date(now.getTime() + 2 * 60000).toISOString();
  const fromIso = new Date(now.getTime() - 90 * 60000).toISOString(); // 遅れすぎたものは publish 側が見送る
  const snap = await db.collection(COLLECTIONS.posts).where('scheduledAt', '>=', fromIso).where('scheduledAt', '<=', dueIso).get();
  let approved = 0;
  let waiting = 0;
  for (const d of snap.docs) {
    const p = d.data();
    if (p.autoApprove !== true || p.status !== 'pending') continue;
    if (needsImage(p) && !attachedMedia(p).length) {
      waiting += 1;
      continue;
    }
    await d.ref.set({ status: 'approved', autoReviewed: true, autoReviewReason: '投稿ごとの切り替えで作り直した1本。確認がなかったので投稿時刻に自動で承認', approvedAt: now.toISOString() }, { merge: true });
    approved += 1;
  }
  return { approved, waiting };
}
