'use server';
import { revalidatePath } from 'next/cache';
import { requireSession, assertAccountVisible } from '../_lib/session';
import { setDirective, parseMixText } from '@/lib/server/directives.mjs';
import { setSignups } from '@/lib/server/signups.mjs';
import { addWatch, judgeWatch, deleteWatch } from '@/lib/server/watchlist.mjs';
import { addTestimonial, deleteTestimonial } from '@/lib/server/testimonials.mjs';
import { addReference, deleteReference } from '@/lib/server/references.mjs';

export async function setDirectiveAction(formData) {
  const session = await requireSession();
  const accountId = String(formData.get('accountId') || '');
  if (accountId) await assertAccountVisible(session, accountId);
  const date = String(formData.get('date') || '');
  const action = String(formData.get('action') || 'note');
  let types = String(formData.get('types') || '').split(/[,\s、]+/).filter(Boolean);
  const mixText = String(formData.get('mixText') || '').trim();
  if (!types.length && mixText) types = parseMixText(mixText);
  await setDirective({ accountId: accountId || null, date, action: types.length && action === 'note' ? 'mix' : action, types, instruction: String(formData.get('instruction') || ''), setBy: session.user });
  revalidatePath('/research');
}

export async function setSignupsAction(formData) {
  const session = await requireSession();
  const accountId = String(formData.get('accountId') || '');
  const acc = await assertAccountVisible(session, accountId);
  await setSignups({ accountId, accountName: acc.name, date: String(formData.get('date') || ''), count: Number(formData.get('count') || 0), enteredBy: session.user });
  revalidatePath('/research');
}

export async function addWatchAction(formData) {
  const session = await requireSession();
  const url = String(formData.get('url') || '').trim();
  let username = String(formData.get('username') || '').trim();
  if (!username && url) username = (url.match(/threads\.(?:net|com)\/@?([^/?#]+)/) || [])[1] || '';
  if (!username) throw new Error('ユーザー名が要ります');
  await addWatch({ username, url, note: String(formData.get('note') || ''), status: String(formData.get('status') || 'candidate'), addedBy: session.user });
  revalidatePath('/research');
}

export async function judgeWatchAction(formData) {
  await requireSession();
  await judgeWatch(String(formData.get('id') || ''), { status: String(formData.get('status') || '') || undefined, note: formData.get('note') != null ? String(formData.get('note')) : undefined, analysis: formData.get('analysis') != null ? String(formData.get('analysis')) : undefined });
  revalidatePath('/research');
}

export async function deleteWatchAction(formData) {
  await requireSession();
  await deleteWatch(String(formData.get('id') || ''));
  revalidatePath('/research');
}

export async function addTestimonialAction(formData) {
  const session = await requireSession();
  const accountId = String(formData.get('accountId') || '');
  await assertAccountVisible(session, accountId);
  await addTestimonial({ accountId, text: String(formData.get('text') || ''), note: String(formData.get('note') || ''), addedBy: session.user });
  revalidatePath('/research');
}

export async function deleteTestimonialAction(formData) {
  await requireSession();
  await deleteTestimonial(String(formData.get('id') || ''));
  revalidatePath('/research');
}

export async function addReferenceAction(formData) {
  const session = await requireSession();
  await addReference({ text: String(formData.get('text') || ''), category: String(formData.get('category') || ''), usage: String(formData.get('usage') || ''), strength: String(formData.get('strength') || ''), weakness: String(formData.get('weakness') || ''), source: String(formData.get('source') || ''), addedBy: session.user });
  revalidatePath('/research');
}

export async function deleteReferenceAction(formData) {
  await requireSession();
  await deleteReference(String(formData.get('id') || ''));
  revalidatePath('/research');
}
