'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/server/firebase.mjs';
import { getCurrentUser, filterAccountsForUser } from '@/lib/server/auth.mjs';
import { listAccounts } from '@/lib/server/repo.mjs';
import { planUpload, getBucket, MEDIA_LIMITS } from '@/lib/server/storage.mjs';
import { STOCK_COLLECTION, STOCK_KINDS, looksPlaceSpecific } from '@/lib/server/stock.mjs';

/** ストック用の送り先 URL を作る。ファイル本体はブラウザから直接バケットへ。 */
export async function requestStockUpload(formData) {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: 'ログインしてください。' };
    const contentType = String(formData.get('contentType') ?? '');
    if (!MEDIA_LIMITS.image.types.includes(contentType)) return { error: '画像は JPEG か PNG にしてください。' };
    const plan = await planUpload({
      fingerprint: String(formData.get('fingerprint') ?? ''),
      contentType,
      bytes: Number(formData.get('bytes')),
      accountId: 'stock',
      accountName: 'stock',
    });
    return { ok: true, ...plan };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * 送り終わった画像をストックに登録する。
 * files は JSON 文字列: [{fingerprint, path, contentType, bytes}]（1枚なら1つ、くっつけなら左・右の順で2つ）
 */
export async function saveStockItem(formData) {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: 'ログインしてください。' };

    const kind = String(formData.get('kind') ?? 'single');
    if (!STOCK_KINDS[kind]) return { error: '種類が不正です。' };
    const genre = String(formData.get('genre') ?? '').trim();
    if (!genre) return { error: '系統（ジャンル）を入れてください。例: 朝日、龍、鳥居' };
    const note = String(formData.get('note') ?? '').trim() || null;
    const accountId = String(formData.get('accountId') ?? '').trim() || null;
    if (accountId) {
      const allowed = filterAccountsForUser(await listAccounts(), user);
      if (!allowed.some((a) => a.id === accountId)) return { error: 'その名義は扱えません。' };
    }
    // 場所が分かる画像は超バズ特化型だけに使う。画面で選ばれていなければ系統の語から推し量る
    const placeSpecific = formData.has('placeSpecific') ? formData.get('placeSpecific') === '1' : looksPlaceSpecific(genre, note ?? '');

    let files = [];
    try {
      files = JSON.parse(String(formData.get('files') ?? '[]'));
    } catch {
      return { error: 'ファイルの情報を読めませんでした。' };
    }
    if (files.length !== STOCK_KINDS[kind].count) {
      return { error: `${STOCK_KINDS[kind].label}は画像を${STOCK_KINDS[kind].count}枚にしてください。` };
    }
    for (const f of files) {
      const [exists] = await getBucket().file(String(f.path)).exists();
      if (!exists) return { error: 'アップロードが完了していません。もう一度お試しください。' };
    }

    const id = randomUUID();
    await getDb()
      .collection(STOCK_COLLECTION)
      .doc(id)
      .set({
        kind,
        genre,
        note,
        accountId, // null なら全名義で使える
        placeSpecific, // true なら超バズ特化型だけ。文章の型（バズ特化・属人）には添えない
        files: files.map((f) => ({
          fingerprint: String(f.fingerprint),
          path: String(f.path),
          contentType: String(f.contentType),
          bytes: Number(f.bytes),
        })),
        addedBy: user.name,
        usedBy: {},
        usedTotal: 0,
        createdAt: new Date().toISOString(),
      });

    revalidatePath('/stock');
    return { ok: `「${genre}」に${STOCK_KINDS[kind].label}を登録しました。` };
  } catch (err) {
    return { error: err.message };
  }
}

/** ストックから外す（ファイル自体は残す。投稿済みの画像が消えないように）。 */
export async function removeStockItem(formData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await getDb().collection(STOCK_COLLECTION).doc(id).delete();
  revalidatePath('/stock');
}

/** ストック1件の系統・メモ・使う名義を変える。 */
export async function updateStockItem(formData) {
  try {
    const user = await getCurrentUser();
    if (!user) return { error: 'ログインしてください。' };
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: '対象が分かりません。' };
    const genre = String(formData.get('genre') ?? '').trim();
    if (!genre) return { error: '系統を入れてください。' };
    const note = String(formData.get('note') ?? '').trim() || null;
    const accountId = String(formData.get('accountId') ?? '').trim() || null;
    if (accountId) {
      const allowed = filterAccountsForUser(await listAccounts(), user);
      if (!allowed.some((a) => a.id === accountId)) return { error: 'その名義は扱えません。' };
    }
    const placeSpecific = formData.get('placeSpecific') === '1';
    await getDb()
      .collection(STOCK_COLLECTION)
      .doc(id)
      .set({ genre, note, accountId, placeSpecific, updatedAt: new Date().toISOString(), updatedBy: user.name }, { merge: true });
    revalidatePath('/stock');
    return { ok: '保存しました。' };
  } catch (err) {
    return { error: err.message };
  }
}
