// 名義（accounts）と Persona（personas）の読み書き。
import { db, getDoc, listDocs, setDoc, updateDoc, deleteDoc, deleteWhere, docToObj } from './firebase.mjs';
import { nowIso } from './time.mjs';

export const PERSONA_DEFAULTS = {
  name: '',
  characterDoc: '',
  styleRules: [],
  ngWords: [],
  postsPerDay: '2-5',
  bands: ['00:00-06:00 personal 40%', '06:00-10:00 buzz_engagement 70%', '10:00-16:00 buzz_engagement 60%', '16:00-21:00 personal 70%', '21:00-24:00 reading_open 80%'],
  minGap: '180-300',
  activeWindow: '00:00-23:59',
  nightAnchor: '',
  nightType: '',
  dayTypes: [],
  postingSlots: [],
  imagePolicy: 'rarely',
  model: 'claude-opus-5',
  askPerDay: '2-3',
  reuseWinners: false,
  winnersFrom: '',
  winnersTo: '',
  useDayPatterns: true,
  buzzTrial: false,
  buzzTone: 'normal',
  slumpBuzz: true,
  slumpPosts: 1,
  slumpType: 'buzz_engagement',
  autoDeleteFlops: true,
  dayMix: [],
  lineUrl: '',
  hasAudience: false,
  superBuzzAfterDays: 2,
  superBuzzOnlyAfterDays: 3,
  perPostSwitch: true,
  noSuperBuzz: false,
};

export async function listAccounts({ group, status } = {}) {
  const where = [];
  if (group) where.push(['group', '==', group]);
  if (status) where.push(['status', '==', status]);
  const list = await listDocs('accounts', { where });
  return list.sort((a, b) => (a.group || 'main').localeCompare(b.group || 'main') || (a.name || '').localeCompare(b.name || ''));
}

export async function getAccount(id) { return getDoc('accounts', id); }

export async function findAccountByName(name) {
  const n = String(name || '').replace(/^@/, '');
  const list = await listDocs('accounts', { where: [['name', '==', n]], limit: 1 });
  return list[0] || null;
}

/** ID か @名前 で探す */
export async function resolveAccount(idOrName) {
  if (!idOrName) return null;
  return (await getAccount(idOrName)) || (await findAccountByName(idOrName));
}

export async function upsertAccount(data) {
  const now = nowIso();
  const name = String(data.name || '').replace(/^@/, '');
  const existing = data.id ? await getAccount(data.id) : await findAccountByName(name);
  const id = existing?.id || data.id || name.replace(/[^A-Za-z0-9_.-]/g, '_');
  const doc = {
    name,
    threadsUserId: data.threadsUserId ?? existing?.threadsUserId ?? null,
    accessToken: data.accessToken ?? existing?.accessToken ?? null,
    tokenExpiresAt: data.tokenExpiresAt ?? existing?.tokenExpiresAt ?? null,
    personaId: data.personaId ?? existing?.personaId ?? id,
    group: data.group ?? existing?.group ?? 'main',
    status: data.status ?? existing?.status ?? 'active',
    autoReply: data.autoReply ?? existing?.autoReply ?? false,
    manualOnly: data.manualOnly ?? existing?.manualOnly ?? false,
    autoReviewExempt: data.autoReviewExempt ?? existing?.autoReviewExempt ?? false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await setDoc('accounts', id, doc);
  return { id, ...doc };
}

export async function updateAccount(id, patch) {
  await updateDoc('accounts', id, { ...patch, updatedAt: nowIso() });
}

/** 名義の削除。投稿・返信・履歴・カーソル・集計・孤立した Persona を消す */
export async function deleteAccountDeep(id) {
  const acc = await getAccount(id);
  if (!acc) throw new Error('名義がありません');
  const counts = {};
  for (const col of ['posts', 'replies', 'history', 'signups', 'testimonials', 'media']) {
    counts[col] = await deleteWhere(col, [['accountId', '==', id]]);
  }
  counts.cursors = await deleteWhere('cursors', [['accountId', '==', id]]);
  counts.directives = await deleteWhere('directives', [['accountId', '==', id]]);
  // 集計（commenters）からこの名義を外す
  const commenters = await listDocs('commenters', { where: [['accounts', 'array-contains', id]] });
  for (const c of commenters) {
    const accounts = (c.accounts || []).filter((a) => a !== id);
    if (accounts.length) await updateDoc('commenters', c.id, { accounts });
    else await deleteDoc('commenters', c.id);
  }
  counts.commenters = commenters.length;
  // 孤立した Persona
  if (acc.personaId) {
    const others = await listDocs('accounts', { where: [['personaId', '==', acc.personaId]] });
    if (others.every((o) => o.id === id)) { await deleteDoc('personas', acc.personaId); counts.persona = 1; }
  }
  await deleteDoc('accounts', id);
  return counts;
}

export async function tokenDaysLeft(acc) {
  if (!acc?.tokenExpiresAt) return null;
  return Math.floor((new Date(acc.tokenExpiresAt).getTime() - Date.now()) / 86400000);
}

// ---- personas ----
export async function listPersonas() {
  const list = await listDocs('personas');
  return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function getPersona(id) {
  const p = await getDoc('personas', id);
  return p ? { ...PERSONA_DEFAULTS, ...p } : null;
}

export async function getPersonaForAccount(acc) {
  if (!acc) return { ...PERSONA_DEFAULTS };
  const p = acc.personaId ? await getPersona(acc.personaId) : null;
  return p || { ...PERSONA_DEFAULTS, id: acc.personaId || acc.id, name: acc.name };
}

export async function savePersona(id, data) {
  const now = nowIso();
  const existing = id ? await getDoc('personas', id) : null;
  const pid = id || (data.name || 'persona').replace(/[^A-Za-z0-9_.\-ぁ-んァ-ン一-龥]/g, '_') + '_' + Date.now().toString(36);
  const doc = { ...PERSONA_DEFAULTS, ...(existing || {}), ...data, updatedAt: now, createdAt: existing?.createdAt || now };
  delete doc.id;
  await setDoc('personas', pid, doc, { merge: false });
  return { id: pid, ...doc };
}

export async function updatePersona(id, patch) {
  await setDoc('personas', id, { ...patch, updatedAt: nowIso() });
}

export async function deletePersona(id) { await deleteDoc('personas', id); }

/** 配列の項目をテキストエリアの行から作る */
export function linesToArray(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/** 文字列で入れられた真偽値 */
export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === 'true' || s === 'on' || s === '1' || s === 'yes';
}

export async function listAccountsForSession(session) {
  const all = await listAccounts();
  if (!session) return [];
  if (session.role === 'admin') return all;
  return all.filter((a) => (a.group || 'main') === (session.group || 'main'));
}

export { docToObj, db };
