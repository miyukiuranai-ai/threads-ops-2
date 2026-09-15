// 画像ストック（image_stock）。超バズ特化型は必ずここから付ける。
import { getDoc, listDocs, setDoc, addDoc, updateDoc, deleteDoc } from './firebase.mjs';
import { nowIso } from './time.mjs';

const PLACE_WORDS = /鳥居|神社|寺|富士|山|城|海|川|滝|湖|境内|参道|大社|宮|院|堂|塔|橋|街|駅|県|市|都|府/;

export function guessPlaceSpecific(genre, note) {
  return PLACE_WORDS.test(`${genre || ''} ${note || ''}`);
}

export async function addStock({ kind = 'single', genre, note = '', accountId = null, placeSpecific, files = [], addedBy = null }) {
  const doc = {
    kind: kind === 'pair' ? 'pair' : 'single',
    genre: String(genre || '').trim() || '未分類',
    note: String(note || '').trim(),
    accountId: accountId || null,
    placeSpecific: placeSpecific == null ? guessPlaceSpecific(genre, note) : Boolean(placeSpecific),
    files,
    usedBy: {},
    usedTotal: 0,
    addedBy,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const id = await addDoc('image_stock', doc);
  return { id, ...doc };
}

export async function updateStock(id, patch) {
  await updateDoc('image_stock', id, { ...patch, updatedAt: nowIso() });
}

export async function deleteStock(id) { await deleteDoc('image_stock', id); }
export async function getStock(id) { return getDoc('image_stock', id); }

export async function listStock({ accountId, kind, genre } = {}) {
  const list = await listDocs('image_stock');
  return list.filter((s) => (!kind || s.kind === kind) && (!genre || s.genre === genre) && (accountId === undefined || s.accountId == null || s.accountId === accountId))
    .sort((a, b) => (a.kind || '').localeCompare(b.kind || '') || String(a.accountId || '').localeCompare(String(b.accountId || '')) || (a.genre || '').localeCompare(b.genre || ''));
}

/** この名義で使える在庫（共通＋名義専用） */
export async function usableStock(accountId) {
  const list = await listDocs('image_stock');
  return list.filter((s) => s.files?.length && (s.accountId == null || s.accountId === accountId));
}

/** プロンプト用の要約: 系統ごとの中身 */
export function summarizeGenres(stock, { kind } = {}) {
  const map = {};
  for (const s of stock) {
    if (kind && s.kind !== kind) continue;
    const key = `${s.genre}|${s.kind}`;
    const g = (map[key] ||= { genre: s.genre, kind: s.kind, notes: [], count: 0, placeSpecific: s.placeSpecific });
    if (s.note && !g.notes.includes(s.note)) g.notes.push(s.note);
    g.count += 1;
  }
  return Object.values(map);
}

function usedCount(s, accountId) { return s.usedBy?.[accountId]?.count || 0; }

/**
 * 系統に合う在庫から、その名義でいちばん使っていないものを選ぶ。
 * 名義専用があれば共通より先。無ければ null（fallbackAny なら何でも）。
 */
export async function pickStock({ accountId, kind, genre, note, placeSpecific, fallbackAny = false }) {
  const all = await usableStock(accountId);
  let cands = all.filter((s) => (!kind || s.kind === kind) && (placeSpecific === undefined || Boolean(s.placeSpecific) === placeSpecific));
  const byGenre = genre ? cands.filter((s) => s.genre === genre || s.genre.includes(genre) || genre.includes(s.genre)) : [];
  let pool = byGenre;
  if (note && pool.length) {
    const byNote = pool.filter((s) => s.note === note || s.note.includes(note));
    if (byNote.length) pool = byNote;
  }
  if (!pool.length && fallbackAny) pool = cands;
  if (!pool.length) return null;
  pool.sort((a, b) => {
    const own = (a.accountId === accountId ? 0 : 1) - (b.accountId === accountId ? 0 : 1);
    if (own) return own;
    return usedCount(a, accountId) - usedCount(b, accountId) || (a.usedTotal || 0) - (b.usedTotal || 0);
  });
  return pool[0];
}

/** 土地名の合う画像（案内に添える） */
export async function findPlaceStock(accountId, placeText) {
  const all = await usableStock(accountId);
  const words = String(placeText || '').split(/[\s、,]+/).filter((w) => w.length >= 2);
  return all.filter((s) => s.placeSpecific && words.some((w) => (s.note || '').includes(w) || (s.genre || '').includes(w)));
}

export async function markStockUsed(stockId, accountId, postId) {
  const s = await getStock(stockId);
  if (!s) return;
  const usedBy = { ...(s.usedBy || {}) };
  const cur = usedBy[accountId] || { count: 0 };
  usedBy[accountId] = { count: (cur.count || 0) + 1, at: nowIso(), lastPostId: postId || null };
  await updateStock(stockId, { usedBy, usedTotal: (s.usedTotal || 0) + 1 });
}

/** 人が投稿に付けた画像を、その名義のストックに残す */
export async function rememberAttached({ accountId, files, genre, note, placeSpecific, addedBy }) {
  if (!files?.length) return null;
  const existing = await listDocs('image_stock', { where: [['accountId', '==', accountId]] });
  const fp = files[0].fingerprint;
  if (existing.some((s) => (s.files || []).some((f) => f.fingerprint === fp))) return null;
  return addStock({ kind: files.length >= 2 ? 'pair' : 'single', genre: genre || '手付け', note: note || '', accountId, placeSpecific, files, addedBy });
}

/** posts.media の形に変換 */
export function stockToMedia(s) {
  return (s.files || []).map((f) => ({ fingerprint: f.fingerprint, path: f.path, contentType: f.contentType, bytes: f.bytes, kind: String(f.contentType || '').startsWith('video/') ? 'video' : 'image', stockId: s.id }));
}
