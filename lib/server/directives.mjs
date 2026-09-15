// レポートの提案への返事（その日だけの指示）。
// 「休む」「1本」「1本バズ」「2本」「そのまま」を名義×日付で保存し、生成のときに自動判定より優先する。
import { getDb } from './firebase.mjs';

export const DIRECTIVES_COLLECTION = 'directives';

export const DIRECTIVE_ACTIONS = {
  rest: { label: '休む', limit: 0 },
  one: { label: '1本', limit: 1 },
  one_buzz: { label: '1本バズ', limit: 1, buzz: true },
  two: { label: '2本', limit: 2 },
  keep: { label: 'そのまま', limit: null }, // 落ち込みの自動調整をせず、名義の設定どおり
  mix: { label: '構成を指定', limit: null }, // types で本数と型を指定（例: バズ2本＋属人1本）
  note: { label: '指示メモ', limit: null }, // 本数や型は変えず、文章の指示だけ渡す
};

/** 「全名義に共通」の指示に使う名義 ID。 */
export const ALL_ACCOUNTS = '_all_';

export function directiveId(accountId, date) {
  return `${accountId}_${date}`;
}

export async function saveDirective({ accountId, date, action, setBy, types = null, instruction = null }) {
  if (!DIRECTIVE_ACTIONS[action]) throw new Error('指示の種類が不正です。');
  if (action === 'mix' && !(Array.isArray(types) && types.length)) throw new Error('構成を指定するときは types が要ります。');
  await getDb()
    .collection(DIRECTIVES_COLLECTION)
    .doc(directiveId(accountId, date))
    .set({
      accountId,
      date,
      action,
      types: action === 'mix' ? types : null,
      instruction: instruction ? String(instruction).trim() : null,
      setBy: setBy ?? null,
      createdAt: new Date().toISOString(),
    });
}

export async function loadDirective(accountId, date) {
  const snap = await getDb().collection(DIRECTIVES_COLLECTION).doc(directiveId(accountId, date)).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** 日付ぶんの指示をまとめて読む（画面表示用）。 */
export async function loadDirectivesFor(date) {
  const snap = await getDb().collection(DIRECTIVES_COLLECTION).where('date', '==', date).get();
  return new Map(snap.docs.map((d) => [d.data().accountId, { id: d.id, ...d.data() }]));
}
