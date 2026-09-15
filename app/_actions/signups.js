'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts } from '@/lib/server/repo.mjs';
import { SIGNUPS_COLLECTION, signupId, jstDate } from '@/lib/server/signups.mjs';

/**
 * LINE の友だち追加数を記録する。
 * その日ぶんを名義まとめて受け取る。空欄の名義は触らない
 * （うっかり0で上書きしてしまうのを防ぐため）。
 */
export async function saveSignups(formData) {
  const user = await getCurrentUser();
  const date = String(formData.get('date') ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: '日付を選んでください。' };
  if (date > jstDate()) return { error: '未来の日付は入れられません。' };

  const accounts = filterAccountsForUser(await listAccounts(), user);
  const db = getDb();

  const saved = [];
  const invalid = [];

  for (const account of accounts) {
    const raw = String(formData.get(`count_${account.id}`) ?? '').trim();
    if (!raw) continue; // 空欄は変更しない

    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0) {
      invalid.push(account.name);
      continue;
    }

    await db
      .collection(SIGNUPS_COLLECTION)
      .doc(signupId(account.id, date))
      .set(
        {
          accountId: account.id,
          accountName: account.name,
          date,
          count,
          enteredBy: user.name,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

    saved.push(`@${account.name} ${count}人`);
  }

  if (invalid.length) {
    return { error: `数字で入れてください: ${invalid.map((n) => `@${n}`).join(' / ')}` };
  }
  if (!saved.length) {
    return { error: '人数がひとつも入っていません。' };
  }

  revalidatePath('/research');
  return { ok: `${date} を記録しました（${saved.join(' / ')}）` };
}
