'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/server/firebase.mjs';
import { getCurrentUser } from '@/lib/server/auth.mjs';
import { SETTINGS_DOC } from '@/lib/server/cost.mjs';

/**
 * Anthropic の残高を記録する。
 * 残高を取れるAPIが無いため、コンソールで見た額を人が入れる。
 * ここを起点に、実行ログのトークン数から消費を積み上げる。
 */
export async function setAnthropicCredit(formData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: '管理者だけが変更できます。' };

  const credit = Number(String(formData.get('credit') ?? '').trim());
  if (!Number.isFinite(credit) || credit < 0) {
    return { error: '金額を数字で入力してください（例: 20）。' };
  }

  await getDb()
    .collection(SETTINGS_DOC.collection)
    .doc(SETTINGS_DOC.id)
    .set(
      { credit, setAt: new Date().toISOString(), setBy: user.name },
      { merge: true }
    );

  revalidatePath('/settings');
  revalidatePath('/');
  return { ok: `残高 $${credit.toFixed(2)} を記録しました。ここからの消費を数えます。` };
}
