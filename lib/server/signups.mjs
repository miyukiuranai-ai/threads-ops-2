// LINE 追加数（signups）。ID accountId_YYYY-MM-DD。
import { getDoc, listDocs, setDoc } from './firebase.mjs';
import { nowIso, addDays } from './time.mjs';

export function signupId(accountId, date) { return `${accountId}_${date}`; }

export async function setSignups({ accountId, accountName, date, count, enteredBy = null, source = 'manual' }) {
  const id = signupId(accountId, date);
  const doc = { accountId, accountName: accountName || null, date, count: Number(count) || 0, signups: Number(count) || 0, enteredBy, source, updatedAt: nowIso() };
  await setDoc('signups', id, doc);
  return { id, ...doc };
}

export async function getSignups(accountId, date) {
  const d = await getDoc('signups', signupId(accountId, date));
  return d ? (d.count ?? d.signups ?? 0) : null;
}

export async function listSignups({ accountId, from, to } = {}) {
  const where = [];
  if (accountId) where.push(['accountId', '==', accountId]);
  if (from) where.push(['date', '>=', from]);
  if (to) where.push(['date', '<=', to]);
  return listDocs('signups', { where });
}

/** 直近 N 日の合計 */
export async function signupsSince(accountId, days = 30, today) {
  const from = addDays(today, -days);
  const list = await listSignups({ accountId, from });
  return list.reduce((s, x) => s + (x.count ?? x.signups ?? 0), 0);
}
