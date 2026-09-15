// お手本（references）。ID は本文の sha1 先頭 16 桁。
import { createHash } from 'node:crypto';
import { getDoc, listDocs, setDoc, deleteDoc } from './firebase.mjs';
import { nowIso } from './time.mjs';
import { charCount, lineCount } from './text-clean.mjs';
import { normalizeType } from './post-types.mjs';

export function refId(text) {
  return createHash('sha1').update(String(text).trim()).digest('hex').slice(0, 16);
}

export async function addReference({ text, category, usage = '', strength = '', weakness = '', source = '', addedBy = null }) {
  const t = String(text || '').trim();
  if (!t) throw new Error('本文が空です');
  const id = refId(t);
  const doc = {
    text: t,
    category: normalizeType(category) || category || 'personal_note',
    usage, strength, weakness, source,
    charCount: charCount(t),
    lineCount: lineCount(t),
    addedBy,
    createdAt: (await getDoc('references', id))?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await setDoc('references', id, doc);
  return { id, ...doc };
}

export async function listReferences({ category } = {}) {
  const where = category ? [['category', '==', category]] : [];
  const list = await listDocs('references', { where });
  return list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export async function deleteReference(id) { await deleteDoc('references', id); }

/**
 * 型ごとに 3 本ずつ、日替わりで入れ替えて渡す。
 * 登録順に並べ、日付から決めた位置から 3 本。上限 8 本。
 */
export async function pickReferencesForDay(typeKeys, dateStr, { perType = 3, max = 8 } = {}) {
  const all = await listReferences();
  const byType = {};
  for (const r of all) (byType[r.category] ||= []).push(r);
  const daySeed = Number(dateStr.replace(/-/g, '')) || 0;
  const out = {};
  let total = 0;
  for (const k of typeKeys) {
    const list = byType[k] || [];
    if (!list.length) continue;
    const start = list.length ? daySeed % list.length : 0;
    const picked = [];
    for (let i = 0; i < Math.min(perType, list.length) && total < max; i++) {
      picked.push(list[(start + i) % list.length]);
      total++;
    }
    out[k] = picked.map((r) => ({ text: r.text, usage: r.usage || '' }));
  }
  // 型が全部無ければ全部から日替わりで
  if (!total && all.length) {
    const start = daySeed % all.length;
    const picked = [];
    for (let i = 0; i < Math.min(max, all.length); i++) picked.push(all[(start + i) % all.length]);
    out._any = picked.map((r) => ({ text: r.text, usage: r.usage || '' }));
  }
  return out;
}

/** usage が「求めない」で始まるお手本（型に関わらず） */
export async function noAskReferences({ limit = 3 } = {}) {
  const all = await listReferences();
  return all.filter((r) => String(r.usage || '').startsWith('求めない')).slice(0, limit).map((r) => ({ text: r.text, usage: r.usage }));
}

export async function countByCategory() {
  const all = await listReferences();
  const out = {};
  for (const r of all) out[r.category] = (out[r.category] || 0) + 1;
  return out;
}
