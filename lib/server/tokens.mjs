// 長期アクセストークンの延長。
// Threads の長期トークンは60日で失効する。発行から24時間以上経過していれば延長でき、
// 延長すると再び60日になる。失効してしまうと再認可が必要なので、週次で回す。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { refreshLongLivedToken } from './threads.mjs';

/** 失効まで何日を切ったら警告するか（SPEC: 10日前）。 */
export const WARN_DAYS = 10;

/** 失効まで何日を切ったら延長を試みるか。 */
const REFRESH_DAYS = 30;

export function daysLeft(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}

/**
 * 期限が近い名義のトークンを延長する。
 * @param {object} opts
 * @param {boolean} [opts.all] 期限に関係なく全名義を延長する
 */
export async function refreshTokens({ all = false } = {}) {
  const db = getDb();
  const startedAt = new Date().toISOString();
  const snap = await db.collection(COLLECTIONS.accounts).get();
  const accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const results = [];

  for (const account of accounts) {
    const left = daysLeft(account.tokenExpiresAt);

    if (left !== null && left < 0) {
      results.push({ account: account.name, result: 'expired', reason: 'トークンが失効済み。再取得が必要です' });
      continue;
    }
    if (!all && left !== null && left > REFRESH_DAYS) {
      results.push({ account: account.name, result: 'skipped', daysLeft: left });
      continue;
    }

    try {
      const res = await refreshLongLivedToken({ accessToken: account.accessToken });
      const expiresAt = new Date(Date.now() + Number(res.expires_in ?? 0) * 1000).toISOString();
      await db.collection(COLLECTIONS.accounts).doc(account.id).set(
        {
          accessToken: res.access_token,
          tokenExpiresAt: expiresAt,
          tokenRefreshedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      results.push({ account: account.name, result: 'refreshed', daysLeft: daysLeft(expiresAt) });
    } catch (err) {
      results.push({ account: account.name, result: 'failed', reason: err.message.split('\n').pop().trim() });
    }
  }

  await db.collection(COLLECTIONS.runs).add({
    job: 'refresh-tokens',
    startedAt,
    finishedAt: new Date().toISOString(),
    status: results.some((r) => r.result === 'failed' || r.result === 'expired') ? 'failed' : 'ok',
    message: results
      .filter((r) => r.result === 'failed' || r.result === 'expired')
      .map((r) => `${r.account}: ${r.reason}`)
      .join(' / '),
    results,
  });

  return { startedAt, results };
}
