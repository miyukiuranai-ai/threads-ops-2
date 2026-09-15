// お客様の声（testimonials）。名義ごと、1 件 1 回。
import { listDocs, addDoc, updateDoc, deleteDoc } from './firebase.mjs';
import { nowIso } from './time.mjs';

export async function addTestimonial({ accountId, text, note = '', addedBy = null }) {
  const id = await addDoc('testimonials', { accountId, text: String(text).trim(), note, addedBy, usedAt: null, usedPostId: null, createdAt: nowIso() });
  return id;
}

export async function listTestimonials({ accountId, unusedOnly = false } = {}) {
  const where = [];
  if (accountId) where.push(['accountId', '==', accountId]);
  let list = await listDocs('testimonials', { where });
  if (unusedOnly) list = list.filter((t) => !t.usedAt);
  return list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

export async function pickUnusedTestimonial(accountId) {
  const list = await listTestimonials({ accountId, unusedOnly: true });
  return list[0] || null;
}

export async function markUsed(id, postId) {
  await updateDoc('testimonials', id, { usedAt: nowIso(), usedPostId: postId || null });
}

export async function deleteTestimonial(id) { await deleteDoc('testimonials', id); }
