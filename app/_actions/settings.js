'use server';
import { revalidatePath } from 'next/cache';
import { requireSession, assertAccountVisible } from '../_lib/session';
import { upsertAccount, updateAccount, deleteAccountDeep, toBool, getAccount } from '@/lib/server/accounts.mjs';
import { getMe } from '@/lib/server/threads.mjs';
import { setBalance } from '@/lib/server/settings.mjs';

export async function addAccountAction(formData) {
  const session = await requireSession();
  const token = String(formData.get('accessToken') || '').trim();
  let name = String(formData.get('name') || '').trim().replace(/^@/, '');
  let userId = String(formData.get('threadsUserId') || '').trim();
  const group = session.role === 'admin' ? String(formData.get('group') || 'main').trim() || 'main' : session.group || 'main';
  const days = Number(formData.get('expiresDays') || 60);
  if (token && (!name || !userId)) {
    const me = await getMe(token);
    name = name || me.username;
    userId = userId || String(me.id);
  }
  if (!name) throw new Error('名義名が必要です');
  await upsertAccount({
    name, threadsUserId: userId || null, accessToken: token || null,
    tokenExpiresAt: token ? new Date(Date.now() + days * 86400000).toISOString() : null,
    group, personaId: String(formData.get('personaId') || '') || undefined,
  });
  revalidatePath('/settings');
  revalidatePath('/', 'layout');
}

export async function updateAccountFlagsAction(formData) {
  const session = await requireSession();
  const id = String(formData.get('id') || '');
  await assertAccountVisible(session, id);
  await updateAccount(id, {
    status: toBool(formData.get('active')) ? 'active' : 'paused',
    autoReply: toBool(formData.get('autoReply')),
    manualOnly: toBool(formData.get('manualOnly')),
    autoReviewExempt: toBool(formData.get('autoReviewExempt')),
  });
  revalidatePath('/settings');
  revalidatePath('/', 'layout');
}

export async function deleteAccountAction(formData) {
  const session = await requireSession();
  const id = String(formData.get('id') || '');
  const acc = await assertAccountVisible(session, id);
  const typed = String(formData.get('confirmName') || '').trim().replace(/^@/, '');
  if (typed !== acc.name) throw new Error('名前が一致しません');
  await deleteAccountDeep(id);
  revalidatePath('/settings');
  revalidatePath('/', 'layout');
}

export async function setBalanceAction(formData) {
  const session = await requireSession();
  if (session.role !== 'admin') throw new Error('管理者のみ');
  await setBalance({ usd: Number(formData.get('usd') || 0), by: session.user });
  revalidatePath('/settings');
  revalidatePath('/');
}

export async function importTokenAction(formData) {
  const session = await requireSession();
  const id = String(formData.get('id') || '');
  const acc = await assertAccountVisible(session, id);
  const token = String(formData.get('accessToken') || '').trim();
  if (!token) throw new Error('トークンが空です');
  const me = await getMe(token);
  await updateAccount(id, { accessToken: token, threadsUserId: String(me.id), tokenExpiresAt: new Date(Date.now() + 60 * 86400000).toISOString(), name: acc.name || me.username });
  revalidatePath('/settings');
}

export async function getAccountForSettings(id) { await requireSession(); return getAccount(id); }
