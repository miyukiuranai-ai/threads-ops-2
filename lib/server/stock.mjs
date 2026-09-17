// 画像ストック。
// バズ型の「2本の指でくっつけてみて」（2枚）や「いいねと🍀で運氣が上がります」（1枚）のように、
// 画像が主役の投稿を毎回手で付けるのは大変なので、系統（ジャンル）ごとに貯めておき、生成のときに自動で添える。
//
// 1件 = 1枚（single）か、左右2枚の組（pair）。系統は自由な語（朝日、龍、鳥居、海、花 など）。
// 使い回しは構わないが、同じ名義で同じ画像が続かないように、その名義でいちばん使っていないものから選ぶ。
//
// 超バズ特化型（image_buzz）以外の枠（バズ特化型・属人型）にも添えてよいが、かなり絞る（本人 9/12）:
// - 場所が分かる画像（鳥居、富士山、寺社など）は超バズ特化型だけ。花や開運系のように場所を特定できないものだけ。
// - 基本は全名義で使える（共通）。名義専用に保存したものがあればそれを先に使う。在庫が無ければ添えない。
import { getDb } from './firebase.mjs';

import { looksPlaceSpecific } from '../shared/place-words.mjs';
export { looksPlaceSpecific };

/** 文章の型（バズ特化型・属人型）に添えられるか。場所が分かる画像と2枚組は不可。ownOnly は名義専用に限るとき。 */
export function usableForText(item, accountId, { ownOnly = false } = {}) {
  if (item.placeSpecific) return false;
  if (item.kind !== 'single') return false; // くっつけの2枚は超バズ特化型の仕掛けなので文章の型には付けない
  if (item.accountId) return item.accountId === accountId;
  return !ownOnly;
}

export const STOCK_COLLECTION = 'image_stock';
export const STOCK_KINDS = {
  single: { label: '1枚', count: 1 },
  pair: { label: '2枚（くっつけ）', count: 2 },
};

/** ストックを全部読む（新しい順）。 */
export async function listStock() {
  const snap = await getDb().collection(STOCK_COLLECTION).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

/** 系統ごとの在庫（生成に渡す。名義向けと共通の両方を数える）。 */
export async function stockSummary(accountId = null) {
  const items = (await listStock()).filter((s) => !s.accountId || s.accountId === accountId);
  const map = new Map();
  for (const s of items) {
    const g = s.genre || 'その他';
    const cur = map.get(g) ?? { genre: g, single: 0, pair: 0, own: 0, notes: [] };
    cur[s.kind === 'pair' ? 'pair' : 'single'] += 1;
    if (s.accountId) cur.own += 1;
    // 説明（漢字の系統なら「福」「縁」のような字そのもの）。本文を画像に合わせて書けるように AI へ渡す
    const note = String(s.note ?? '').trim();
    if (note && note !== g && !cur.notes.includes(note) && cur.notes.length < 30) cur.notes.push(note);
    map.set(g, cur);
  }
  return [...map.values()].sort((a, b) => b.single + b.pair - (a.single + a.pair));
}

/**
 * 文章の型（バズ特化型・属人型）に添えてよい在庫を系統ごとに数える。
 * 場所が分かる画像と2枚組は除く。共通（全名義）と名義専用の両方を数える。
 */
export async function textStockSummary(accountId, { ownOnly = false } = {}) {
  const items = (await listStock()).filter((s) => usableForText(s, accountId, { ownOnly }));
  const map = new Map();
  for (const s of items) {
    const g = s.genre || 'その他';
    const cur = map.get(g) ?? { genre: g, count: 0, own: 0 };
    cur.count += 1;
    if (s.accountId) cur.own += 1;
    map.set(g, cur);
  }
  return [...map.values()].sort((a, b) => b.own - a.own || b.count - a.count);
}

/**
 * 条件に合う1件を選ぶ。系統が合うものを優先し、無ければ同じ種類（1枚／2枚）から。
 * その名義で使った回数が少なく、最後に使ったのが古いものを選ぶ。
 */
export async function pickStock({ kind, genre = null, note = null, accountId, forText = false, ownOnly = false, strictGenre = false }) {
  let items = (await listStock()).filter((s) => s.kind === kind && (!s.accountId || s.accountId === accountId));
  // 文章の型に添えるときは、場所が分かる画像と（属人型なら）共通のものを外す
  if (forText) items = items.filter((s) => usableForText(s, accountId, { ownOnly }));
  if (!items.length) return null;
  let sameGenre = genre ? items.filter((s) => (s.genre || '') === genre) : [];
  // 文章の型では系統が合わなければ付けない（合わない画像を無理に添えない）
  if ((forText || strictGenre) && genre && !sameGenre.length) return null;
  // 説明（漢字なら字）が指定されていて、それに合うものがあればそれだけに絞る（本文がその字に触れているため）
  if (note && sameGenre.length) {
    const sameNote = sameGenre.filter((s) => String(s.note ?? '').trim() === String(note).trim());
    if (sameNote.length) sameGenre = sameNote;
  }
  const pool = sameGenre.length ? sameGenre : items;
  const score = (s) => {
    const uses = s.usedBy?.[accountId] ?? { count: 0, at: '' };
    return [uses.count ?? 0, uses.at ?? ''];
  };
  pool.sort((a, b) => {
    // 名義専用のものを先に（本人: 基本は名義ごとに保存したところから使う）
    const own = Number(Boolean(b.accountId)) - Number(Boolean(a.accountId));
    if (own) return own;
    const [ac, aa] = score(a);
    const [bc, ba] = score(b);
    return ac - bc || String(aa).localeCompare(String(ba));
  });
  return pool[0];
}

/** 使った記録を付ける。 */
export async function markStockUsed(stockId, accountId, postId) {
  const ref = getDb().collection(STOCK_COLLECTION).doc(stockId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const usedBy = { ...(snap.data().usedBy ?? {}) };
  const prev = usedBy[accountId] ?? { count: 0 };
  usedBy[accountId] = { count: (prev.count ?? 0) + 1, at: new Date().toISOString(), lastPostId: postId ?? null };
  await ref.set({ usedBy, usedTotal: (snap.data().usedTotal ?? 0) + 1 }, { merge: true });
}

/** ストックの画像を、投稿の media の形に直す（publish がそのまま使える）。 */
export function stockToMedia(item) {
  return (item.files ?? []).map((f) => ({
    fingerprint: f.fingerprint,
    path: f.path,
    kind: 'image',
    contentType: f.contentType,
    bytes: f.bytes,
    fromStock: item.id,
  }));
}

/** 系統やメモに出てきても土地の名前としては数えない語。 */
const GENERIC_WORDS = new Set(['鳥居', '神社', '神宮', '大社', '寺', '石段', '参道', '本殿', '拝殿', '境内', '朝', '昼', '夕方', '夜', '縦構図', '横構図', '写真', '画像', '風景', '景色', '空', '雲', '山', '海', '川', '花']);

/** 系統とメモから土地の名前らしい語を取り出す（2文字以上。「大阪府」は「大阪」でも合うようにする）。 */
export function placeTokens(item) {
  const raw = `${item.genre ?? ''} ${item.note ?? ''}`.split(/[\s、,，。・/／()（）]+/).filter(Boolean);
  const out = new Set();
  // 「住吉大社の太鼓橋」のように「の」でつながった語は、前後それぞれも土地の名前として数える
  const parts = raw.flatMap((t) => [t, ...t.split('の')]);
  for (const t of parts) {
    if (t.length < 2 || GENERIC_WORDS.has(t)) continue;
    out.add(t);
    const short = t.replace(/[都道府県市]$/, '');
    if (short.length >= 2 && !GENERIC_WORDS.has(short)) out.add(short);
  }
  return [...out];
}

/** 土地移動型・寺社訪問型に渡す、場所が分かる画像の一覧 [{genre, note}]（その名義で使えるもの）。 */
export async function placeStockSummary(accountId) {
  const items = (await listStock()).filter((s) => s.placeSpecific && s.kind === 'single' && (!s.accountId || s.accountId === accountId));
  // 同じ系統・同じ説明は1行にまとめる（AI に渡す一覧を短く）
  const seen = new Set();
  return items
    .map((s) => ({ genre: s.genre ?? '', note: s.note ?? '' }))
    .filter((g) => {
      const key = `${g.genre}|${g.note}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * 本文と地名（imagePlace）に合う土地の画像を選ぶ。
 * 寺社名のような長い語が合うものを先に、同じなら名義専用、使った回数が少ないもの。合うものが無ければ null。
 */
export async function pickPlaceStock({ placeText, accountId }) {
  const text = String(placeText ?? '');
  if (!text.trim()) return null;
  const items = (await listStock()).filter((s) => s.placeSpecific && s.kind === 'single' && (!s.accountId || s.accountId === accountId));
  const scored = [];
  for (const s of items) {
    const hit = placeTokens(s).filter((t) => text.includes(t));
    if (!hit.length) continue;
    const best = Math.max(...hit.map((t) => t.length));
    const uses = s.usedBy?.[accountId] ?? { count: 0, at: '' };
    scored.push({ s, best, own: s.accountId ? 1 : 0, count: uses.count ?? 0, at: uses.at ?? '' });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.best - a.best || b.own - a.own || a.count - b.count || String(a.at).localeCompare(String(b.at)));
  return scored[0].s;
}

/**
 * 「画像が必要」と判定された投稿に、型や名義を問わずストックから 1 枚を選ぶ（threads-ops2 で追加。本人 9/17「画像が必要なものは名義がだれであれストックから自動で追加」）。
 * 選ぶ順:
 *   1) 土地移動型・寺社訪問型なら、土地の名前が合う「場所が分かる画像」
 *   2) AI が選んだ系統（漢字なら字も）に合う 1 枚
 *   3) 本文や合図の被写体（⛩️→鳥居 など）に合う系統。呼び出し側が hintedGenres を渡す
 *   4) 縁起物（系統「開運」「縁起」）
 *   5) 場所が分からない 1 枚なら何でも（その名義でいちばん使っていないもの）
 *   6) それも無ければ、どの 1 枚でも／2 枚組でも
 * @returns {Promise<{item: object, how: string} | null>}
 */
export async function pickStockForRequired({ accountId, genre = null, note = null, hintGenres = [], placeText = '', preferPlace = false }) {
  if (preferPlace && placeText) {
    const item = await pickPlaceStock({ placeText, accountId });
    if (item) return { item, how: '土地の合う画像' };
  }
  if (genre) {
    const item = await pickStock({ kind: 'single', genre, note, accountId, strictGenre: true });
    if (item) return { item, how: `系統「${item.genre}」` };
  }
  for (const g of hintGenres) {
    const item = await pickStock({ kind: 'single', genre: g, accountId, strictGenre: true });
    if (item) return { item, how: `本文に合う系統「${item.genre}」` };
  }
  const all = (await listStock()).filter((s) => !s.accountId || s.accountId === accountId);
  const luckyGenres = [...new Set(all.map((s) => s.genre || '').filter((g) => /開運|縁起/.test(g)))];
  for (const g of luckyGenres) {
    const item = await pickStock({ kind: 'single', genre: g, accountId, strictGenre: true });
    if (item) return { item, how: `縁起物「${item.genre}」` };
  }
  const generic = await pickStock({ kind: 'single', accountId, forText: true });
  if (generic) return { item: generic, how: `場所の分からない 1 枚「${generic.genre}」` };
  const anySingle = await pickStock({ kind: 'single', accountId });
  if (anySingle) return { item: anySingle, how: `在庫の 1 枚「${anySingle.genre}」` };
  const anyPair = await pickStock({ kind: 'pair', accountId });
  if (anyPair) return { item: anyPair, how: `在庫の 2 枚組「${anyPair.genre}」` };
  return null;
}
