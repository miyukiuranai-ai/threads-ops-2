import 'server-only';
import { cookies } from 'next/headers';
import { verifySession, COOKIE_NAME, canSeeAccount } from '@/lib/server/auth.mjs';
import { listAccountsForSession, getAccount } from '@/lib/server/accounts.mjs';

export async function getSession() {
  const store = await cookies();
  return verifySession(store.get(COOKIE_NAME)?.value);
}

export async function requireSession() {
  const s = await getSession();
  if (!s) throw new Error('ログインが必要です');
  return s;
}

/** 画面共通: セッションと見える名義、?account= で選ばれた名義 */
export async function pageContext(searchParams) {
  const session = await requireSession();
  const accounts = await listAccountsForSession(session);
  const sp = (await searchParams) || {};
  const accountId = typeof sp.account === 'string' ? sp.account : null;
  const selected = accountId ? accounts.find((a) => a.id === accountId) || null : null;
  return { session, accounts, selected, accountIds: selected ? [selected.id] : accounts.map((a) => a.id), sp };
}

export async function assertAccountVisible(session, accountId) {
  const acc = await getAccount(accountId);
  if (!acc || !canSeeAccount(session, acc)) throw new Error('この名義は操作できません');
  return acc;
}
