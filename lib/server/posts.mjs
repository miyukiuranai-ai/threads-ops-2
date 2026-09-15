// 投稿（posts）の読み書き。
import { db, getDoc, listDocs, setDoc, updateDoc, addDoc, docToObj } from './firebase.mjs';
import { nowIso, jstDate, addDays, slotToIso, isoToSlot } from './time.mjs';
import { cleanBody, cleanKeyword } from './text-clean.mjs';

export const POST_STATUSES = ['pending', 'approved', 'held', 'rejected', 'posted', 'failed', 'missed', 'deleted'];
export const STATUS_JA = {
  pending: '承認待ち', approved: '承認済み', held: '保留', rejected: '却下', posted: '投稿済み', failed: '失敗', missed: '時刻切れ', deleted: '削除済み',
};

export async function getPost(id) { return getDoc('posts', id); }

export async function listPosts({ accountId, accountIds, status, statuses, plannedDate, from, to, limit = 500, orderBy = ['scheduledAt', 'asc'] } = {}) {
  // 複合インデックスを要らなくするため、問い合わせは等値だけ。範囲と並びはメモリで。
  const where = [];
  if (accountId) where.push(['accountId', '==', accountId]);
  if (status) where.push(['status', '==', status]);
  if (statuses?.length) where.push(['status', 'in', statuses.slice(0, 30)]);
  if (plannedDate) where.push(['plannedDate', '==', plannedDate]);
  let list;
  if (!where.length) {
    const w = [];
    if (from) w.push(['scheduledAt', '>=', from]);
    if (to) w.push(['scheduledAt', '<=', to]);
    list = await listDocs('posts', { where: w, orderBy: ['scheduledAt', orderBy?.[1] || 'asc'], limit: Math.max(limit, 500) });
  } else {
    list = await listDocs('posts', { where, limit: 3000 });
  }
  if (from) list = list.filter((p) => (p.scheduledAt || '') >= from);
  if (to) list = list.filter((p) => (p.scheduledAt || '') <= to);
  if (accountIds?.length) list = list.filter((p) => accountIds.includes(p.accountId));
  if (orderBy) {
    const [f, dir] = orderBy;
    list.sort((a, b) => ((a[f] || '') < (b[f] || '') ? -1 : (a[f] || '') > (b[f] || '') ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  return list.slice(0, limit);
}

/** 承認待ち＋保留などの数を名義ごとに */
export async function countByStatus(accountIds) {
  const since = addDays(jstDate(), -7);
  const list = await listDocs('posts', { where: [['plannedDate', '>=', since]] });
  const out = {};
  for (const p of list) {
    if (accountIds && !accountIds.includes(p.accountId)) continue;
    const o = (out[p.accountId] ||= { pending: 0, approved: 0, posted: 0, rejected: 0, held: 0, failed: 0, missed: 0 });
    if (o[p.status] != null) o[p.status] += 1;
  }
  return out;
}

export async function createPost(data) {
  const now = nowIso();
  const doc = {
    accountId: data.accountId,
    accountName: data.accountName,
    personaId: data.personaId || null,
    body: cleanBody(data.body),
    type: data.type,
    slot: data.slot,
    slotName: data.slotName || data.type,
    keyword: cleanKeyword(data.keyword),
    imageBrief: data.imageBrief || '',
    imageRequired: Boolean(data.imageRequired),
    imageKind: data.imageKind || null,
    imageGenre: data.imageGenre || null,
    imageNote: data.imageNote || null,
    imagePlace: data.imagePlace || null,
    stockId: data.stockId || null,
    media: data.media || [],
    intent: data.intent || '',
    status: data.status || 'pending',
    scheduledAt: data.scheduledAt || slotToIso(data.plannedDate, data.slot),
    plannedDate: data.plannedDate,
    dayPattern: data.dayPattern || null,
    testimonialId: data.testimonialId || null,
    postedThreadId: null,
    postedAt: null,
    holdReason: data.holdReason || null,
    rejectedReason: null,
    reviewedAt: null,
    editedBy: data.editedBy || null,
    flopChecked: false,
    flopResult: null,
    flopCounts: null,
    deletedAt: null,
    deletedBy: null,
    autoApprove: Boolean(data.autoApprove),
    switchedFrom: data.switchedFrom || null,
    switchReason: data.switchReason || null,
    lockedType: Boolean(data.lockedType),
    preSwitchCheckedAt: null,
    preSwitchNote: null,
    requeuedAt: null,
    snap1h: null, snap3h: null, verdict1h: null, verdict3h: null, verdictEarly: null,
    generatedBy: data.generatedBy || null,
    createdAt: now,
    updatedAt: now,
  };
  const id = await addDoc('posts', doc);
  return { id, ...doc };
}

export async function updatePost(id, patch) {
  await updateDoc('posts', id, { ...patch, updatedAt: nowIso() });
}

export async function setStatus(id, status, extra = {}) {
  await updatePost(id, { status, reviewedAt: nowIso(), ...extra });
}

export async function approvePost(id, by) { await setStatus(id, 'approved', { editedBy: by || null, holdReason: null }); }
export async function rejectPost(id, by, reason) { await setStatus(id, 'rejected', { editedBy: by || null, rejectedReason: reason || null }); }
export async function holdPost(id, by, reason) { await setStatus(id, 'held', { editedBy: by || null, holdReason: reason || null }); }

export async function editPost(id, { body, keyword, slot, plannedDate, imageBrief, intent }, by) {
  const post = await getPost(id);
  if (!post) throw new Error('投稿がありません');
  const patch = { editedBy: by || null };
  if (body != null) patch.body = cleanBody(body);
  if (keyword !== undefined) patch.keyword = cleanKeyword(keyword);
  if (imageBrief != null) patch.imageBrief = imageBrief;
  if (intent != null) patch.intent = intent;
  const date = plannedDate || post.plannedDate;
  if (slot) {
    patch.slot = slot;
    patch.plannedDate = date;
    patch.scheduledAt = slotToIso(date, slot);
  } else if (plannedDate && plannedDate !== post.plannedDate) {
    patch.plannedDate = plannedDate;
    patch.scheduledAt = slotToIso(plannedDate, post.slot);
  }
  await updatePost(id, patch);
  return { ...post, ...patch };
}

/** 直近の自投稿（投稿済み優先、無ければ生成済み）。プロンプト用 */
export async function recentPostsForPrompt(accountId, { limit = 8 } = {}) {
  const list = await listDocs('posts', { where: [['accountId', '==', accountId], ['status', 'in', ['posted', 'approved', 'pending', 'held']]], limit: 200 });
  list.sort((a, b) => (b.scheduledAt || '').localeCompare(a.scheduledAt || ''));
  return list.slice(0, limit).map((p) => ({ date: p.plannedDate, type: p.type, body: p.body, keyword: p.keyword, status: p.status }));
}

/** 使用済みの合言葉（直近 N 本） */
export async function usedKeywords(accountId, { limit = 12 } = {}) {
  const list = await listDocs('posts', { where: [['accountId', '==', accountId]], limit: 300 });
  list.sort((a, b) => (b.scheduledAt || '').localeCompare(a.scheduledAt || ''));
  return list.filter((p) => p.keyword && p.status !== 'rejected').slice(0, limit).map((p) => p.keyword);
}

/** その日にすでに投稿が作ってあるか（rejected 以外） */
export async function hasPostsForDate(accountId, plannedDate) {
  const list = await listDocs('posts', { where: [['accountId', '==', accountId], ['plannedDate', '==', plannedDate]] });
  return list.some((p) => p.status !== 'rejected' && p.status !== 'deleted');
}

/** その日の生成済みを却下する（作り直しの前） */
export async function rejectPendingForDate(accountId, plannedDate, reason) {
  const list = await listDocs('posts', { where: [['accountId', '==', accountId], ['plannedDate', '==', plannedDate]] });
  let n = 0;
  for (const p of list) {
    if (['pending', 'held', 'approved'].includes(p.status)) {
      await rejectPost(p.id, 'tool', reason);
      n++;
    }
  }
  return n;
}

/** 前日に合言葉を求めた本数（交互の判定） */
export async function askCountOn(accountId, plannedDate) {
  const list = await listDocs('posts', { where: [['accountId', '==', accountId], ['plannedDate', '==', plannedDate]] });
  return list.filter((p) => p.keyword && p.status !== 'rejected').length;
}

/** 直近 2 日の dayPattern */
export async function recentDayPatterns(accountId, plannedDate) {
  const out = [];
  for (let i = 1; i <= 2; i++) {
    const d = addDays(plannedDate, -i);
    const list = await listDocs('posts', { where: [['accountId', '==', accountId], ['plannedDate', '==', d]], limit: 10 });
    const p = list.find((x) => x.dayPattern);
    if (p) out.push(p.dayPattern);
  }
  return out;
}

export function postSlot(p) { return p.slot || isoToSlot(p.scheduledAt, p.plannedDate); }

export { docToObj, db };
