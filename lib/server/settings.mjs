// settings/anthropic: 残高の入力値と更新日。消費は runs の usage から見積もる。
import { getDoc, setDoc } from './firebase.mjs';
import { nowIso } from './time.mjs';
import { usageSince } from './runs.mjs';

export async function getBalance() { return getDoc('settings', 'anthropic'); }

export async function setBalance({ usd, by }) {
  const doc = { balanceUsd: Number(usd) || 0, updatedAt: nowIso(), updatedBy: by || null };
  await setDoc('settings', 'anthropic', doc);
  return doc;
}

/** 残高の警告。7 日で警告、3 日で危険 */
export async function balanceStatus() {
  const b = await getBalance();
  const u = await usageSince(7);
  const perDay = u.usd / 7;
  if (!b?.balanceUsd) return { level: 'unknown', perDay, message: '残高が未入力' };
  const spentSince = perDay * Math.max(0, (Date.now() - new Date(b.updatedAt).getTime()) / 86400000);
  const remain = Math.max(0, b.balanceUsd - spentSince);
  const daysLeft = perDay > 0 ? remain / perDay : Infinity;
  const level = daysLeft <= 3 ? 'danger' : daysLeft <= 7 ? 'warn' : 'ok';
  return { level, perDay, remain, daysLeft, balanceUsd: b.balanceUsd, updatedAt: b.updatedAt, message: daysLeft === Infinity ? '消費なし' : `残り約 ${Math.floor(daysLeft)} 日（1日約 $${perDay.toFixed(2)}）` };
}
