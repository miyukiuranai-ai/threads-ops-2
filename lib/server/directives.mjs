// その日の指示（directives）。ID accountId_date、全名義共通は _all_。
import { getDoc, listDocs, setDoc, deleteDoc } from './firebase.mjs';
import { nowIso } from './time.mjs';
import { normalizeType } from './post-types.mjs';

export const ACTIONS = ['rest', 'one', 'one_buzz', 'two', 'keep', 'mix', 'note'];
export const ACTION_JA = { rest: '休む', one: '1本', one_buzz: '1本バズ', two: '2本', keep: 'そのまま', mix: '構成を指定', note: '指示だけ' };

export function directiveId(accountId, date) { return `${accountId || '_all_'}_${date}`; }

export async function setDirective({ accountId, date, action = 'note', types = [], instruction = '', setBy = null }) {
  const id = directiveId(accountId, date);
  const doc = {
    accountId: accountId || '_all_',
    date,
    action: ACTIONS.includes(action) ? action : 'note',
    types: (types || []).map(normalizeType).filter(Boolean),
    instruction: String(instruction || '').trim(),
    setBy,
    updatedAt: nowIso(),
  };
  await setDoc('directives', id, doc);
  return { id, ...doc };
}

export async function getDirective(accountId, date) { return getDoc('directives', directiveId(accountId, date)); }

/** 名義の指示と共通の指示を両方返す */
export async function directivesFor(accountId, date) {
  const [own, all] = await Promise.all([getDirective(accountId, date), getDirective(null, date)]);
  return { own, all };
}

export async function listDirectives({ date, from } = {}) {
  const where = [];
  if (date) where.push(['date', '==', date]);
  if (from) where.push(['date', '>=', from]);
  return listDocs('directives', { where });
}

export async function deleteDirective(accountId, date) { await deleteDoc('directives', directiveId(accountId, date)); }

/** 「バズ2、属人2」のような自由記述を型の並びに */
export function parseMixText(text) {
  const map = [
    [/超バズ|画像バズ|image/i, 'image_buzz'],
    [/霊視|reading/i, 'reading_open'],
    [/バズ|buzz/i, 'buzz_engagement'],
    [/名乗り|由来|intro/i, 'attract_intro'],
    [/寺社|神社|shrine/i, 'shrine_visit'],
    [/土地|移動|travel/i, 'travel_note'],
    [/不安|煽り|弾く|hook/i, 'exclusion_hook'],
    [/素|属人|note/i, 'personal_note'],
  ];
  const out = [];
  for (const part of String(text || '').split(/[、,\s]+/)) {
    if (!part) continue;
    const m = part.match(/(\d+)/);
    const n = m ? Number(m[1]) : 1;
    const hit = map.find(([re]) => re.test(part));
    if (hit) for (let i = 0; i < n; i++) out.push(hit[1]);
  }
  return out;
}
