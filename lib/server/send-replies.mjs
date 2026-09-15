// 返信の送信。
// 投稿と同じく、送ってよいかの判定を一箇所に集約する。
//
// 送信の考え方:
//   - コメント受信から 5〜30分 遅らせる（即レスはボットに見える）
//   - 連続送信は 20〜60秒 のランダム間隔（一定間隔にしない）
//   - 深夜2〜6時は送らない。その時間に来たコメントには朝に「遅延謝罪」で返す
//   - 1回の実行で送るのは少数。5分ごとの実行に分散させる
import { getDb, COLLECTIONS } from './firebase.mjs';
import { createReply } from './threads.mjs';
import { loadTemplates, pickTemplate, fillName } from './reply-templates.mjs';
import { jstHour } from './replies.mjs';
import { loadReplyStats, pushReplySend, countWithin } from './reply-state.mjs';

/** 1回の実行で送る上限。5分ごとに実行される前提（20〜60秒あけて6件で最大5分弱）。 */
const PER_RUN = 6;

/**
 * 連続して返し続けないための休憩。
 * 直近 windowMinutes 分に count 件送っていたら、その回は送らずに休む。
 * 人が20件ほど返して一息つく、くらいの間隔になる。
 */
const BURST = { count: 20, windowMinutes: 20 };

/** 安全弁。通常運転では発動しない。 */
const LIMITS = { perDay: 300 };

/** 送信間隔（ミリ秒）。 */
const GAP = { min: 20_000, max: 60_000 };

/** コメント受信から返信までの遅延（分）。 */
const DELAY = { min: 5, max: 30 };

/** 深夜は送らない。 */
const QUIET_HOURS = { from: 2, to: 6 };

/** 取りかかった返信を他の実行が触らないようにする印。 */
const CLAIM_STATUS = 'sending';

/** 途中で落ちた印を、この時間が過ぎたら解放する。 */
const CLAIM_TIMEOUT_MS = 10 * 60_000;

/** この返信の担当権を取る。取れたら true。 */
async function claimReply(db, replyId) {
  const ref = db.collection(COLLECTIONS.replies).doc(replyId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;

      const reply = snap.data();
      if (reply.status === CLAIM_STATUS) {
        const age = Date.now() - new Date(reply.claimedAt ?? 0).getTime();
        if (age < CLAIM_TIMEOUT_MS) return false;
      } else if (reply.status !== 'queued') {
        return false;
      }

      tx.set(ref, { status: CLAIM_STATUS, claimedAt: new Date().toISOString() }, { merge: true });
      return true;
    });
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomBetween = (min, max) => min + Math.random() * (max - min);

/** 返信モード。live 以外は送信しない。 */
export function replyMode() {
  return process.env.REPLY_MODE === 'live' ? 'live' : 'dry_run';
}

/** いま送ってよい時間帯か。 */
export function isQuietNow(now = new Date()) {
  const h = jstHour(now.toISOString());
  return h >= QUIET_HOURS.from && h < QUIET_HOURS.to;
}

/** このコメントに返信してよい時刻（受信から5〜30分後）。 */
export function sendAfterFor(commentIso) {
  const base = new Date(commentIso).getTime();
  return new Date(base + randomBetween(DELAY.min, DELAY.max) * 60000).toISOString();
}

/**
 * 返信待ちのコメントに順次返信する。
 * @param {object} opts
 * @param {boolean} [opts.force] REPLY_MODE が dry_run でも実際に送る
 * @param {number} [opts.perRun] 1回の実行で送る件数
 */
export async function sendQueuedReplies({ force = false, perRun = PER_RUN } = {}) {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const mode = replyMode();
  const results = [];

  if (isQuietNow()) {
    return { startedAt, mode, skipped: '深夜のため送信しません（2:00-6:00 JST）', results };
  }

  const accounts = (await db.collection(COLLECTIONS.accounts).get()).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    // 「停止中」は投稿を止めるだけ。自動返信のスイッチは独立して効く
    .filter((a) => a.autoReply === true);

  if (!accounts.length) return { startedAt, mode, summary: {}, results };

  // 返信待ちは1回だけ問い合わせ、名義ごとの絞り込みは手元で行う
  const queuedSnap = await db
    .collection(COLLECTIONS.replies)
    .where('status', '==', 'queued')
    .limit(300)
    .get();
  const allQueued = queuedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  for (const account of accounts) {
    try {
      // 送信履歴は専用のドキュメントに持たせ、全件走査を避ける
      let state = await loadReplyStats(account.id);
      const sent = {
        burst: countWithin(state.sends, BURST.windowMinutes),
        day: countWithin(state.sends, 24 * 60),
      };
      if (sent.day >= LIMITS.perDay) {
        results.push({ account: account.name, result: 'skipped', reason: `1日の上限（${LIMITS.perDay}件）に達しています` });
        continue;
      }
      if (sent.burst >= BURST.count) {
        results.push({
          account: account.name,
          result: 'resting',
          reason: `${BURST.windowMinutes}分で${sent.burst}件返したため休憩中`,
        });
        continue;
      }

      const queued = allQueued
        .filter((r) => r.accountId === account.id)
        .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')));

      // 遅延時刻を未設定のものに割り当てる
      const now = new Date().toISOString();
      const due = [];
      for (const r of queued) {
        let after = r.sendAfter;
        if (!after) {
          after = sendAfterFor(r.timestamp ?? r.createdAt);
          await db.collection(COLLECTIONS.replies).doc(r.id).set({ sendAfter: after }, { merge: true });
        }
        if (after <= now) due.push({ ...r, sendAfter: after });
      }

      if (!due.length) continue;

      const templates = await loadTemplates(account.name);
      if (!templates.length) {
        results.push({ account: account.name, result: 'failed', reason: '返信テンプレートがありません' });
        continue;
      }

      // 直近で使ったテンプレートは避ける（送信履歴と一緒に持たせている）
      const recentIds = [...state.recentTemplateIds];

      const room = Math.max(0, BURST.count - sent.burst);
      const batch = due.slice(0, Math.min(perRun, room));

      let count = 0;
      for (const reply of batch) {
        // 同時に走った実行と取り合いにならないよう、先に担当権を取る
        if (!(await claimReply(db, reply.id))) continue;

        const template = pickTemplate({
          templates,
          night: reply.arrivedAtNight,
          recentIds,
          linkStyle: account.linkStyle ?? 'both',
        });
        const text = fillName(template.text, reply.displayName ?? null);

        if (mode !== 'live' && !force) {
          await db.collection(COLLECTIONS.replies).doc(reply.id).set(
            { status: 'sent', dryRun: true, templateId: template.templateId, generatedReply: text, sentAt: new Date().toISOString() },
            { merge: true }
          );
          state = await pushReplySend(account.id, state, new Date().toISOString(), template.templateId);
          results.push({ account: account.name, replyId: reply.replyId, result: 'dry_run', text });
        } else {
          try {
            const res = await createReply({
              accessToken: account.accessToken,
              userId: account.threadsUserId,
              text,
              replyToId: reply.replyId,
            });
            await db.collection(COLLECTIONS.replies).doc(reply.id).set(
              {
                status: 'sent',
                dryRun: false,
                templateId: template.templateId,
                generatedReply: text,
                sentThreadId: res.id,
                sentAt: new Date().toISOString(),
              },
              { merge: true }
            );
            state = await pushReplySend(account.id, state, new Date().toISOString(), template.templateId);
            results.push({ account: account.name, replyId: reply.replyId, result: 'sent', threadId: res.id });
          } catch (err) {
            await db.collection(COLLECTIONS.replies).doc(reply.id).set(
              { status: 'failed', error: err.message, failedAt: new Date().toISOString() },
              { merge: true }
            );
            results.push({ account: account.name, replyId: reply.replyId, result: 'failed', reason: err.message });
          }
        }

        recentIds.unshift(template.templateId);
        count += 1;
        if (count < batch.length) await sleep(randomBetween(GAP.min, GAP.max));
      }
    } catch (err) {
      results.push({ account: account.name, result: 'failed', reason: err.message });
    }
  }

  const summary = results.reduce((acc, r) => {
    acc[r.result] = (acc[r.result] ?? 0) + 1;
    return acc;
  }, {});

  // 何も起きなかった回はログを残さない（件数が増えすぎるため）
  if (!results.length) return { startedAt, mode, summary, results };

  await db.collection(COLLECTIONS.runs).add({
    job: 'reply',
    startedAt,
    finishedAt: new Date().toISOString(),
    mode,
    status: results.some((r) => r.result === 'failed') ? 'failed' : 'ok',
    summary,
    results,
  });

  return { startedAt, mode, summary, results };
}
