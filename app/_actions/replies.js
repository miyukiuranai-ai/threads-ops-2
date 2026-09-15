'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../_lib/session';
import { updateDoc } from '@/lib/server/firebase.mjs';
import { addTemplate, deleteTemplate } from '@/lib/server/replies.mjs';
import { nowIso } from '@/lib/server/time.mjs';

export async function setReplyStatusAction(formData) {
  await requireSession();
  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || '');
  if (!['queued', 'skipped'].includes(status)) throw new Error('不正な状態');
  await updateDoc('replies', id, { status, skipReason: status === 'skipped' ? '手動' : null, classifiedAt: nowIso() });
  revalidatePath('/replies');
}

export async function addTemplateAction(formData) {
  await requireSession();
  const accountName = String(formData.get('accountName') || '').trim() || null;
  await addTemplate({ accountName, category: String(formData.get('category') || '通常誘導'), text: String(formData.get('text') || ''), linkStyle: String(formData.get('linkStyle') || 'profile') });
  revalidatePath('/replies');
}

export async function deleteTemplateAction(formData) {
  await requireSession();
  await deleteTemplate(String(formData.get('id') || ''));
  revalidatePath('/replies');
}
