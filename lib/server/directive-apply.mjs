// レポートの提案への返事（休む／1本／1本バズ／2本／そのまま）を適用し、その日ぶんの下書きを作り直す。
// 画面のボタン（/api/directive）と、相談のチャットの両方から使う。
import { getDb, COLLECTIONS } from './firebase.mjs';
import { generateForAccount, tomorrowJst } from './pipeline.mjs';
import { saveDirective, DIRECTIVE_ACTIONS } from './directives.mjs';

const jstOf = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);

/** その日ぶんの承認待ち・承認済みを却下する。戻り値は却下した本数。 */
export async function rejectDraftsFor(accountId, date, reason) {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.posts).where('accountId', '==', accountId).get();
  let rejected = 0;
  for (const d of snap.docs) {
    const p = d.data();
    if (!['pending', 'approved'].includes(p.status)) continue;
    if ((p.plannedDate ?? jstOf(p.scheduledAt)) !== date) continue;
    await d.ref.set({ status: 'rejected', rejectedReason: reason, updatedAt: new Date().toISOString() }, { merge: true });
    rejected += 1;
  }
  return rejected;
}

/**
 * 指示を保存し、必要ならその日ぶんを作り直す。
 * @param {object} p
 * @param {object} p.account   名義（id, name, personaId, ...）
 * @param {string} p.action    rest | one | one_buzz | two | keep
 * @param {string} [p.date]    YYYY-MM-DD（既定は明日）
 * @param {string} [p.setBy]
 * @param {boolean} [p.regenerate=true]
 */
export async function applyDirective({ account, action, date = null, setBy = null, regenerate = true, types = null, instruction = null }) {
  const def = DIRECTIVE_ACTIONS[action];
  if (!def) throw new Error('指示の種類が不正です。');
  const target = date ?? tomorrowJst();
  await saveDirective({ accountId: account.id, date: target, action, setBy, types, instruction });

  if (!regenerate) return { date: target, action: def.label, rejected: 0, count: null, note: '指示だけ保存（次の生成で反映）' };

  const rejected = await rejectDraftsFor(account.id, target, `返事「${def.label}」で作り直し`);
  const result = await generateForAccount(account, { date: target });
  return { date: target, action: action === 'mix' ? `構成を指定（${types.join('＋')}）` : def.label, rejected, count: result.posts.length, note: result.note ?? null };
}
