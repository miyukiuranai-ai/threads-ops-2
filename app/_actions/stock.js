'use server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../_lib/session';
import { addStock, updateStock, deleteStock, guessPlaceSpecific } from '@/lib/server/stock.mjs';
import { recordMedia } from '@/lib/server/storage.mjs';
import { toBool } from '@/lib/server/accounts.mjs';

/** まとめて登録。items: [{kind, genre, note, accountId, files:[{fingerprint,path,contentType,bytes}]}] */
export async function addStockItemsAction(items) {
  const session = await requireSession();
  const out = [];
  for (const it of items || []) {
    if (!it.files?.length) continue;
    for (const f of it.files) await recordMedia({ fingerprint: f.fingerprint, path: f.path, kind: 'image', contentType: f.contentType, bytes: f.bytes, accountId: 'stock', accountName: 'stock' });
    const s = await addStock({ kind: it.kind, genre: it.genre, note: it.note, accountId: it.accountId || null, placeSpecific: it.placeSpecific, files: it.files, addedBy: session.user });
    out.push(s.id);
  }
  revalidatePath('/stock');
  return { ok: true, ids: out };
}

export async function updateStockAction(formData) {
  await requireSession();
  const id = String(formData.get('id') || '');
  const genre = String(formData.get('genre') || '').trim();
  const note = String(formData.get('note') || '').trim();
  await updateStock(id, { genre, note, accountId: String(formData.get('accountId') || '') || null, placeSpecific: formData.has('placeSpecific') ? toBool(formData.get('placeSpecific')) : guessPlaceSpecific(genre, note) });
  revalidatePath('/stock');
}

export async function deleteStockAction(formData) {
  await requireSession();
  await deleteStock(String(formData.get('id') || ''));
  revalidatePath('/stock');
}
