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

/**
 * 生成した投稿案を自動で承認するかどうかを切り替える（threads-ops2 で追加。本人 9/19）。
 * ON にすると、15:30 の生成でできた投稿案がそのまま承認済みになり、予定時刻が来れば投稿される。
 */
export async function setAutoApprove(formData) {
  const user = await getCurrentUser();
  if (user.role !== 'admin') return { error: '管理者だけが変更できます。' };

  const on = String(formData.get('autoApprove') ?? '') === 'on';
  const { saveAutoApprove } = await import('@/lib/server/auto-approve.mjs');
  await saveAutoApprove(on, user.name);

  revalidatePath('/settings');
  revalidatePath('/posts');
  return {
    ok: on
      ? '自動承認を ON にしました。次の生成から、投稿案は承認済みで作られます。'
      : '自動承認を OFF にしました。これからは「投稿予定」で承認してください。',
  };
}
