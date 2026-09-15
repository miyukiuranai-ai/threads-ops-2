// 監視リスト（watchlist）。ID はユーザー名。
import { listDocs, setDoc, getDoc, deleteDoc } from './firebase.mjs';
import { nowIso } from './time.mjs';

export const WATCH_STATUSES = { candidate: '候補', competitor: '競合', reference: '参考', irrelevant: '無関係' };

function key(username) { return String(username || '').replace(/^@/, '').replace(/[\/.]/g, '_').replace(/^__/, 'u___'); }

export async function addWatch({ username, note = '', status = 'candidate', addedBy = null, url = '' }) {
  const id = key(username);
  const existing = await getDoc('watchlist', id);
  const doc = { username: String(username).replace(/^@/, ''), url, note, status, analysis: existing?.analysis || '', addedBy, judgedAt: existing?.judgedAt || null, analyzedAt: existing?.analyzedAt || null, createdAt: existing?.createdAt || nowIso(), updatedAt: nowIso() };
  await setDoc('watchlist', id, doc);
  return { id, ...doc };
}

export async function judgeWatch(id, { status, note, analysis }) {
  const patch = { updatedAt: nowIso() };
  if (status) { patch.status = status; patch.judgedAt = nowIso(); }
  if (note != null) patch.note = note;
  if (analysis != null) { patch.analysis = analysis; patch.analyzedAt = nowIso(); }
  await setDoc('watchlist', id, patch);
}

export async function listWatch() {
  const list = await listDocs('watchlist');
  return list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function deleteWatch(id) { await deleteDoc('watchlist', id); }
