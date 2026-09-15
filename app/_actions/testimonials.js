'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/server/firebase.mjs';
import { getCurrentUser } from '@/lib/server/auth.mjs';
import { TESTIMONIALS_COLLECTION } from '@/lib/server/testimonials.mjs';

/** 空行2つ以上で区切って複数の声に分ける。 */
function splitVoices(raw) {
  return String(raw ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** お客様の声を登録する。 */
export async function addTestimonials(formData) {
  const user = await getCurrentUser();
  if (!user) return { error: 'ログインしてください。' };

  const accountId = String(formData.get('accountId') ?? '').trim();
  if (!accountId) return { error: '名義を選んでください。' };

  const voices = splitVoices(formData.get('text'));
  if (!voices.length) return { error: '声の本文を貼り付けてください。2つ以上入れるときは空行を2つで区切ります。' };
  if (voices.length > 20) return { error: '一度に登録できるのは20件までです。' };

  const note = String(formData.get('note') ?? '').trim() || null;
  const db = getDb();
  const now = new Date().toISOString();

  for (const text of voices) {
    await db.collection(TESTIMONIALS_COLLECTION).doc(randomUUID()).set({
      accountId,
      text,
      note,
      addedBy: user.name,
      usedAt: null,
      usedPostId: null,
      createdAt: now,
    });
  }

  revalidatePath('/research');
  return { ok: `${voices.length}件の声を登録しました。使うときは1件ずつ、たまに混ぜます。` };
}

/** 声を消す。 */
export async function removeTestimonial(formData) {
  await getDb().collection(TESTIMONIALS_COLLECTION).doc(String(formData.get('id'))).delete();
  revalidatePath('/research');
}
